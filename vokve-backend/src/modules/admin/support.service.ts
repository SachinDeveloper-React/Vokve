import { z } from 'zod';
import { supportCategorySchema, supportTicketStatusSchema } from '../../contracts/index.js';
import { Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { SupportTicketModel } from '../account/models.js';
import { UserModel } from '../identity/models.js';
import { notify } from '../notifications/service.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * The other side of a support ticket (RULES P12).
 *
 * The member's half was built: they open a ticket, the phone's own details
 * ride along, they can reply, and they read the thread. Nobody could answer
 * them. A ticket sat in `support_tickets` with `status: 'open'` and the only
 * way to reply was to insert a message into the array by hand.
 *
 * Three things shape what is here:
 *
 *   - **The queue is "who is waiting", not "what is open".** A ticket whose
 *     last message is the member's is waiting for us; one where we answered
 *     last is waiting for them. `waitingOnUs` is that distinction, and it is
 *     what the default sort is by — oldest wait first, because the oldest
 *     unanswered question is the one doing damage.
 *   - **A reply tells them.** It goes through `notify()` like everything
 *     else, so a member who switched the system category off gets the feed
 *     row and no push. There is no bypass here either.
 *   - **Closing is the end, and it is one-way for the member.** Their own
 *     reply route refuses a closed ticket (`TICKET_CLOSED`) and tells them
 *     to open a new one, so closing is a decision rather than a tidy-up. A
 *     reply from here reopens a `resolved` ticket the same way theirs does.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const STATUSES = supportTicketStatusSchema.options;

type TicketRow = {
  _id: string;
  userId: string;
  reference: string;
  subject: string;
  category: string;
  status: string;
  messages: { id: string; from: string; body: string; createdAt: Date }[];
  context?: { appVersion?: string; platform?: string; osVersion?: string; deviceId?: string };
  createdAt: Date;
  updatedAt: Date;
};

/** Whose turn it is, and how long it has been their turn. */
function waiting(row: TicketRow): { onUs: boolean; since: Date; hours: number } {
  const last = row.messages[row.messages.length - 1];
  const since = last?.createdAt ?? row.createdAt;
  return {
    onUs: (last?.from ?? 'user') === 'user' && row.status !== 'closed' && row.status !== 'resolved',
    since,
    hours: Math.round(((Date.now() - since.getTime()) / 3_600_000) * 10) / 10,
  };
}

export const ticketQuery = z.object({
  /** A reference read out on a call, words in the subject, or the member. */
  q: z.string().max(160).default(''),
  status: z.enum(['any', ...STATUSES]).default('any'),
  category: supportCategorySchema.optional(),
  /** Only the ones whose last word was the member's. */
  waiting: z.enum(['any', 'us', 'them']).default('any'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(['waiting', 'newest', 'oldest', 'updated']).default('waiting'),
});
export type TicketQuery = z.infer<typeof ticketQuery>;

/**
 * The queue.
 *
 * `waiting` is computed from the thread rather than stored, so it cannot
 * drift from what the thread actually says — which means the `us`/`them`
 * filter and the `waiting` sort are applied after the page is read. The
 * counts beside them are over the whole filter and come from the database.
 */
export async function listTickets(query: TicketQuery) {
  const filter: Record<string, unknown> = {};
  const trimmed = query.q.trim();
  if (trimmed) {
    const like = new RegExp(escape(trimmed), 'i');
    const members = await UserModel.find(
      { $or: [{ _id: trimmed }, { email: like }, { phone: like }, { name: like }] },
      { _id: 1 },
    )
      .limit(200)
      .lean();
    filter.$or = [
      { _id: trimmed },
      { reference: new RegExp(`^${escape(trimmed)}$`, 'i') },
      { subject: like },
      { 'messages.body': like },
      ...(members.length > 0 ? [{ userId: { $in: members.map(member => member._id) } }] : []),
    ];
  }
  if (query.status !== 'any') filter.status = query.status;
  if (query.category) filter.category = query.category;

  const order: Record<string, 1 | -1> =
    query.sort === 'newest' ? { createdAt: -1 } : query.sort === 'oldest' ? { createdAt: 1 } : { updatedAt: -1 };

  // The `waiting` filter and sort are about the last message, so the page is
  // read wider than asked for and narrowed here. A hard cap keeps that
  // honest rather than unbounded; the status filters are the way to a
  // smaller set.
  const WIDE = 500;
  const [rows, total, byStatus, byCategory] = await Promise.all([
    SupportTicketModel.find(filter)
      .sort(order)
      .limit(query.waiting === 'any' && query.sort !== 'waiting' ? query.offset + query.limit : WIDE)
      .lean(),
    SupportTicketModel.countDocuments(filter),
    SupportTicketModel.aggregate<{ _id: string; tickets: number }>([
      { $group: { _id: '$status', tickets: { $sum: 1 } } },
      { $sort: { tickets: -1 } },
    ]),
    SupportTicketModel.aggregate<{ _id: string; tickets: number }>([
      { $match: { status: { $in: ['open', 'in_progress'] } } },
      { $group: { _id: '$category', tickets: { $sum: 1 } } },
      { $sort: { tickets: -1 } },
    ]),
  ]);

  const measured = (rows as unknown as TicketRow[]).map(row => ({ row, wait: waiting(row) }));
  const narrowed = measured.filter(entry =>
    query.waiting === 'us' ? entry.wait.onUs : query.waiting === 'them' ? !entry.wait.onUs : true,
  );
  if (query.sort === 'waiting') {
    // Oldest wait first, and the ones waiting on us above the ones that are
    // not: the queue's whole purpose is the question nobody has answered.
    narrowed.sort((a, b) => {
      if (a.wait.onUs !== b.wait.onUs) return a.wait.onUs ? -1 : 1;
      return a.wait.since.getTime() - b.wait.since.getTime();
    });
  }
  const page = narrowed.slice(query.offset, query.offset + query.limit);

  const members = await UserModel.find({ _id: { $in: page.map(entry => entry.row.userId) } }, { name: 1, email: 1, phone: 1 }).lean();
  const memberOf = new Map(members.map(member => [member._id, member]));

  const onUs = measured.filter(entry => entry.wait.onUs);
  const oldest = onUs.reduce<{ wait: number; reference: string } | null>(
    (worst, entry) => (!worst || entry.wait.hours > worst.wait ? { wait: entry.wait.hours, reference: entry.row.reference } : worst),
    null,
  );

  return {
    /** Every ticket the filter matched, before the waiting narrowing. */
    total: query.waiting === 'any' ? total : narrowed.length,
    offset: query.offset,
    limit: query.limit,
    totals: {
      tickets: total,
      /** Across the rows read: the queue's own backlog. */
      waitingOnUs: onUs.length,
      oldestWaitHours: oldest?.wait ?? 0,
      oldestWaitReference: oldest?.reference ?? null,
    },
    byStatus: byStatus.map(row => ({ status: row._id, tickets: row.tickets })),
    /** Open and in-progress only: a closed ticket is not a subject needing help. */
    byCategory: byCategory.map(row => ({ category: row._id, tickets: row.tickets })),
    data: page.map(({ row, wait }) => {
      const member = memberOf.get(row.userId);
      const last = row.messages[row.messages.length - 1];
      return {
        id: row._id,
        reference: row.reference,
        subject: row.subject,
        category: row.category,
        status: row.status,
        member: {
          id: row.userId,
          name: member?.name ?? '',
          email: member?.email ?? null,
          phone: member?.phone ?? null,
        },
        messages: row.messages.length,
        /** Who spoke last, and what they said — enough to triage from the list. */
        lastFrom: last?.from ?? 'user',
        lastMessage: last?.body ?? '',
        lastAt: iso(last?.createdAt ?? row.createdAt),
        waitingOnUs: wait.onUs,
        waitingHours: wait.hours,
        platform: row.context?.platform ?? null,
        appVersion: row.context?.appVersion ?? null,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      };
    }),
    nextCursor: null,
  };
}

/** One ticket, its whole thread, and the member it belongs to. */
export async function getTicket(id: string) {
  const found = await SupportTicketModel.findById(id).lean();
  if (!found) throw Errors.notFound('That ticket');
  const row = found as unknown as TicketRow;

  const [member, others] = await Promise.all([
    UserModel.findById(row.userId, { name: 1, email: 1, phone: 1, createdAt: 1, 'trust.tier': 1 }).lean(),
    SupportTicketModel.find({ userId: row.userId, _id: { $ne: id } }, { reference: 1, subject: 1, status: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);
  const wait = waiting(row);

  return {
    ticket: {
      id: row._id,
      reference: row.reference,
      subject: row.subject,
      category: row.category,
      status: row.status,
      messages: row.messages.map(message => ({
        id: message.id,
        from: message.from as 'user' | 'support',
        body: message.body,
        createdAt: iso(message.createdAt),
      })),
      /**
       * What the phone was running when it was opened. The first thing
       * support asks, and the member never has to be asked for it.
       */
      context: {
        appVersion: row.context?.appVersion ?? null,
        platform: row.context?.platform ?? null,
        osVersion: row.context?.osVersion ?? null,
        deviceId: row.context?.deviceId ?? null,
      },
      waitingOnUs: wait.onUs,
      waitingHours: wait.hours,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    },
    member: {
      id: row.userId,
      name: member?.name ?? '',
      email: member?.email ?? null,
      phone: member?.phone ?? null,
      tier: (member as { trust?: { tier?: string } } | null)?.trust?.tier ?? null,
      since: iso((member as { createdAt?: Date } | null)?.createdAt),
    },
    /** Their other tickets: the same question twice is a different problem. */
    otherTickets: others.map(other => ({
      id: other._id,
      reference: other.reference,
      subject: other.subject,
      status: other.status,
      createdAt: iso(other.createdAt as Date),
    })),
  };
}

export const replyBody = z
  .object({
    message: z.string().trim().min(2, 'Write a reply').max(2000),
    /** Set it as you answer: the usual move is a reply that resolves. */
    status: z.enum(STATUSES).optional(),
    /**
     * Whether to tell them. On by default — a reply nobody is told about is
     * a reply nobody reads — and off for the case where somebody is already
     * on the phone to them.
     */
    notifyMember: z.boolean().default(true),
  })
  .strict();
export type ReplyBody = z.infer<typeof replyBody>;

/**
 * Answers a member, as support.
 *
 * The notification is part of the reply rather than a separate step: a
 * thread the member is never told about is a thread they will not come back
 * to. It goes through `notify()`, so their own consent decides the push —
 * and `status` moves in the same write, because "reply and resolve" is one
 * action in anybody's head.
 */
export async function replyToTicket(actor: string, id: string, body: ReplyBody) {
  const ticket = await SupportTicketModel.findById(id);
  if (!ticket) throw Errors.notFound('That ticket');
  if (ticket.status === 'closed') {
    throw Errors.conflict(
      'TICKET_CLOSED',
      'This ticket is closed, and the member cannot reply to a closed one. Reopen it first if the conversation is still going.',
      { status: 'closed' },
    );
  }

  const before = ticket.status;
  ticket.messages.push({ id: newId('msg'), from: 'support', body: body.message, createdAt: new Date() });
  // Answering an open ticket means somebody has it; saying otherwise would
  // leave the queue claiming nobody has looked.
  ticket.status = body.status ?? (before === 'open' ? 'in_progress' : before);
  await ticket.save();

  let told: Awaited<ReturnType<typeof notify>> | null = null;
  if (body.notifyMember) {
    told = await notify({
      userId: ticket.userId,
      topic: 'system',
      title: `Support replied · ${ticket.reference}`,
      message: body.message.length > 160 ? `${body.message.slice(0, 157)}…` : body.message,
      dedupeKey: `support_reply:${ticket.messages[ticket.messages.length - 1]!.id}`,
    });
  }

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'support.replied',
    subjectType: 'ticket',
    subjectId: id,
    before: { status: before, messages: ticket.messages.length - 1 },
    after: { status: ticket.status, message: body.message, notified: told?.status ?? 'not_sent', push: told?.push ?? null },
  });

  return { ...(await getTicket(id)), notified: told ? { status: told.status, push: told.push } : null };
}

export const ticketStatusBody = z
  .object({
    status: z.enum(STATUSES),
    note: z.string().trim().max(300).optional(),
    /** Tell them it moved. Off by default: a status change is not news on its own. */
    notifyMember: z.boolean().default(false),
  })
  .strict();
export type TicketStatusBody = z.infer<typeof ticketStatusBody>;

/** Moves a ticket's state without saying anything in the thread. */
export async function setTicketStatus(actor: string, id: string, body: TicketStatusBody) {
  const ticket = await SupportTicketModel.findById(id);
  if (!ticket) throw Errors.notFound('That ticket');
  const before = ticket.status;
  if (before === body.status) return getTicket(id);

  ticket.status = body.status;
  await ticket.save();

  if (body.notifyMember) {
    await notify({
      userId: ticket.userId,
      topic: 'system',
      title: `Your ticket ${ticket.reference} is ${body.status.replace(/_/g, ' ')}`,
      message:
        body.status === 'closed'
          ? 'This conversation is closed. Open a new ticket if you need us again and we will pick it up there.'
          : 'You can read the whole conversation in Help & Support.',
      dedupeKey: `support_status:${id}:${body.status}`,
    });
  }

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'support.status',
    subjectType: 'ticket',
    subjectId: id,
    before: { status: before },
    after: { status: body.status, note: body.note ?? null },
  });

  return getTicket(id);
}

export const deleteTicketBody = z
  .object({ reason: z.string().trim().min(3).max(300), confirm: z.literal(true) })
  .strict();

/**
 * Deletes a ticket — spam, or a duplicate of the one next to it.
 *
 * Not the way to end a conversation: closing is, and it keeps the thread
 * where the member can still read it. This is for a row that should never
 * have been a ticket, so it refuses one support has already answered —
 * deleting a thread we took part in would remove the member's copy of what
 * we told them.
 */
export async function deleteTicket(actor: string, id: string, reason: string) {
  const ticket = await SupportTicketModel.findById(id).lean();
  if (!ticket) throw Errors.notFound('That ticket');

  const answered = (ticket.messages ?? []).some(message => message.from === 'support');
  if (answered) {
    throw Errors.validation({
      id: 'Support has already replied to this one, so deleting it would take away the member’s copy of what we told them. Close it instead.',
    });
  }

  await SupportTicketModel.deleteOne({ _id: id });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'support.ticket_deleted',
    subjectType: 'ticket',
    subjectId: id,
    before: { userId: ticket.userId, reference: ticket.reference, subject: ticket.subject, messages: (ticket.messages ?? []).length },
    after: { deleted: true, reason },
  });

  return { deleted: true, id, reference: ticket.reference };
}
