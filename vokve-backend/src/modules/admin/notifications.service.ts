import { z } from 'zod';
import { notificationTopicSchema } from '../../contracts/index.js';
import { Errors } from '../../lib/errors.js';
import { UserModel } from '../identity/models.js';
import { NotificationPreferencesModel } from '../identity/models.js';
import { NotificationModel } from '../notifications/models.js';
import { PREFERENCE_SWITCHES, preferencesInUse } from '../notifications/service.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * What the app has actually told everybody (ARCHITECTURE §5.7).
 *
 * Sending was already here — `broadcast.service.ts` for a segment,
 * `member.service.ts` for one member. What was missing is the other
 * direction: reading back what went out, which is the only way to answer
 * the three questions that come after a send.
 *
 *   - **Did it arrive?** A feed row is written always; the push follows the
 *     member's consent. So every row carries which of the two happened, and
 *     a count of each is on the list rather than something to work out.
 *   - **Did anybody read it?** `read` on the row. Across a broadcast's
 *     `dedupeKey` that becomes an open rate, which is the only honest
 *     measure of a message nobody was pushed.
 *   - **Can it be taken back?** Partly, and the honesty is the point:
 *     `retractBroadcast` deletes the rows nobody has opened yet and reports
 *     how many it could not touch. A push that has already rung cannot be
 *     unrung.
 *
 * Nothing here sends anything. Consent lives in `notify()` and there is no
 * path around it, including from this file.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The three groups the member's own filter offers, as the contract groups them. */
const CATEGORY_OF: Record<string, 'activity' | 'reward' | 'system'> = {
  steps: 'activity',
  workout: 'activity',
  streak: 'activity',
  hydration: 'activity',
  health: 'activity',
  coins: 'reward',
  challenge: 'reward',
  reward: 'reward',
  system: 'system',
};

// ─── What everybody has agreed to hear (RULES P14) ─────────────────────────

/**
 * The defaults every account is created with, read off the schema itself so
 * this cannot drift from what a new member actually gets. Everything on
 * except health, which is the member's body rather than the app's news.
 */
function defaultSwitches(): Record<string, boolean> {
  const doc = new NotificationPreferencesModel({ _id: 'default' }).toObject() as {
    categories: Record<string, boolean>;
  };
  return doc.categories;
}

/**
 * Consent across the whole base, switch by switch.
 *
 * The member's own switches were already readable one account at a time, on
 * their Config & messages tab. What had no answer was the question an
 * operator asks before a send — *how many people will this reach?* — and its
 * follow-up, *who turned it off?* The segment count on the broadcast form
 * answers neither, because it counts accounts and not consent.
 *
 * Three figures per switch. `on` and `off` are the reach; `chosen` is how
 * many members moved that switch away from the value they were created with,
 * which is what tells a deliberate refusal from a default nobody has
 * touched. A preferences row is written at sign-up, so "has a row" says
 * nothing — comparing against the default is the only way to know.
 *
 * `governs` is the honesty. It lists the topics actually sent on a switch,
 * and a switch with none is one no message reaches the member through unless
 * a caller names it: `offers` is the live example, which is why a broadcast
 * can now name it. Without this, "412 members have offers off" reads as lost
 * reach that was never there.
 *
 * Counted with one `$sum` per switch rather than by gathering the rows:
 * every member has a document here, and a pipeline that pushed them into one
 * group would walk into the 16MB limit on a base of any size.
 */
export async function notificationConsent() {
  const defaults = defaultSwitches();
  const governs = preferencesInUse();

  const sumOf = (field: string, value: boolean) => ({
    $sum: { $cond: [{ $eq: [`$${field}`, value] }, 1, 0] },
  });

  const [members, rows] = await Promise.all([
    UserModel.countDocuments({ deletedAt: null }),
    NotificationPreferencesModel.aggregate<Record<string, number>>([
      {
        $group: {
          _id: null,
          withRow: { $sum: 1 },
          quietOn: sumOf('quietHours.enabled', true),
          smsOn: sumOf('sms', true),
          emailOn: sumOf('email', true),
          ...Object.fromEntries(
            PREFERENCE_SWITCHES.flatMap(key => [
              [`${key}_on`, sumOf(`categories.${key}`, true)],
              // Explicitly false, not "not true": a row written before a
              // switch existed has no field for it, and the server reads the
              // schema default there rather than a refusal.
              [`${key}_off`, sumOf(`categories.${key}`, false)],
            ]),
          ),
        },
      },
    ]),
  ]);

  const tally = rows[0] ?? {};
  const withRow = tally.withRow ?? 0;
  /** Accounts with no preferences row at all: on every default, by omission. */
  const noRow = Math.max(0, members - withRow);

  return {
    members,
    noRow,
    quietHours: {
      on: (tally.quietOn ?? 0) + noRow,
      off: withRow - (tally.quietOn ?? 0),
    },
    channels: {
      sms: { on: (tally.smsOn ?? 0) + noRow, off: withRow - (tally.smsOn ?? 0) },
      email: { on: tally.emailOn ?? 0, off: withRow - (tally.emailOn ?? 0) + noRow },
    },
    switches: PREFERENCE_SWITCHES.map(key => {
      const defaultOn = defaults[key] ?? true;
      const on = (tally[`${key}_on`] ?? 0) + (defaultOn ? noRow : 0);
      const off = (tally[`${key}_off`] ?? 0) + (defaultOn ? 0 : noRow);
      return {
        key,
        defaultOn,
        /** Everybody a push on this switch can reach today. */
        on,
        off,
        /** Members who moved it away from the value they were created with. */
        chosen: defaultOn ? off : on,
        /** The topics sent on it; empty means only a caller naming it. */
        governs: governs[key] ?? [],
      };
    }),
  };
}

export const notificationQuery = z.object({
  /** Words in the title or the message, or a member's id, email or name. */
  q: z.string().max(160).default(''),
  topic: notificationTopicSchema.optional(),
  userId: z.string().max(80).optional(),
  /**
   * Where it stands. `deferred` is a push quiet hours are still holding —
   * the one state with something left to happen in it.
   */
  state: z.enum(['any', 'read', 'unread', 'pushed', 'deferred', 'not_pushed']).default('any'),
  /** A send is a moment; the window is how far back to look at them. */
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});
export type NotificationQuery = z.infer<typeof notificationQuery>;

const DAY_MS = 86_400_000;

/**
 * Every notification in the window, with what became of it.
 *
 * The summary is taken across the filter rather than the page, because "how
 * many of these were read" is a figure about the filter — a page of
 * twenty-five says nothing.
 */
export async function listNotifications(query: NotificationQuery) {
  const since = new Date(Date.now() - query.days * DAY_MS);
  const filter: Record<string, unknown> = { createdAt: { $gte: since } };

  const trimmed = query.q.trim();
  if (trimmed) {
    const like = new RegExp(escape(trimmed), 'i');
    // A search that is plainly an account is one, rather than a title match
    // nobody wrote: ids are long and unmistakable.
    const members = await UserModel.find({ $or: [{ _id: trimmed }, { email: like }, { name: like }] }, { _id: 1 })
      .limit(200)
      .lean();
    filter.$or = [
      { title: like },
      { message: like },
      ...(members.length > 0 ? [{ userId: { $in: members.map(member => member._id) } }] : []),
    ];
  }
  if (query.userId) filter.userId = query.userId;
  if (query.topic) filter.topic = query.topic;
  if (query.state === 'read') filter.read = true;
  if (query.state === 'unread') filter.read = false;
  if (query.state === 'pushed') filter.pushedAt = { $ne: null };
  if (query.state === 'deferred') filter.pushDeferredUntil = { $ne: null };
  if (query.state === 'not_pushed') {
    filter.pushedAt = null;
    filter.pushDeferredUntil = null;
  }

  const [rows, total, summary, byTopic, byDay] = await Promise.all([
    NotificationModel.find(filter)
      .sort({ createdAt: query.sort === 'oldest' ? 1 : -1 })
      .skip(query.offset)
      .limit(query.limit)
      .lean(),
    NotificationModel.countDocuments(filter),
    NotificationModel.aggregate<{ _id: null; read: number; pushed: number; deferred: number }>([
      { $match: filter },
      {
        $group: {
          _id: null,
          read: { $sum: { $cond: ['$read', 1, 0] } },
          pushed: { $sum: { $cond: [{ $ne: ['$pushedAt', null] }, 1, 0] } },
          deferred: { $sum: { $cond: [{ $ne: ['$pushDeferredUntil', null] }, 1, 0] } },
        },
      },
    ]),
    NotificationModel.aggregate<{ _id: string; sent: number; read: number }>([
      { $match: filter },
      { $group: { _id: '$topic', sent: { $sum: 1 }, read: { $sum: { $cond: ['$read', 1, 0] } } } },
      { $sort: { sent: -1 } },
    ]),
    NotificationModel.aggregate<{ _id: string; sent: number }>([
      { $match: filter },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, sent: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const members = await UserModel.find({ _id: { $in: rows.map(row => row.userId) } }, { name: 1, email: 1 }).lean();
  const memberOf = new Map(members.map(member => [member._id, member]));
  const totals = summary[0];
  const now = Date.now();

  return {
    total,
    offset: query.offset,
    limit: query.limit,
    window: { days: query.days, from: iso(since) },
    /** Across the filter, not the page. */
    totals: {
      sent: total,
      read: totals?.read ?? 0,
      unread: total - (totals?.read ?? 0),
      pushed: totals?.pushed ?? 0,
      /** Still held by quiet hours: the hourly tick will send these. */
      deferred: totals?.deferred ?? 0,
      /** A feed row with no push at all — the category was off, or no phone could show it. */
      notPushed: total - (totals?.pushed ?? 0) - (totals?.deferred ?? 0),
    },
    byTopic: byTopic.map(row => ({
      topic: row._id,
      category: CATEGORY_OF[row._id] ?? 'system',
      sent: row.sent,
      read: row.read,
    })),
    byDay: byDay.map(row => ({ day: row._id, sent: row.sent })),
    data: rows.map(row => {
      const member = memberOf.get(row.userId);
      const deferredUntil = row.pushDeferredUntil ?? null;
      return {
        id: row._id,
        member: { id: row.userId, name: member?.name ?? '', email: member?.email ?? null },
        topic: row.topic,
        category: CATEGORY_OF[row.topic] ?? 'system',
        title: row.title,
        message: row.message,
        read: row.read ?? false,
        readAt: iso(row.readAt),
        pushedAt: iso(row.pushedAt),
        pushDeferredUntil: iso(deferredUntil),
        /** A push still waiting for the quiet window to end. */
        pushPending: Boolean(deferredUntil && deferredUntil.getTime() > now),
        /**
         * The producers' idempotency key. A broadcast stamps one key on
         * every row it writes, which is what makes a send readable as a
         * send rather than as ten thousand unrelated rows.
         */
        dedupeKey: row.dedupeKey ?? null,
        createdAt: iso(row.createdAt),
      };
    }),
    nextCursor: null,
  };
}

/**
 * Every broadcast, from the audit log, with what has become of it since.
 *
 * The audit row is the record of the send — who, to which segment, with the
 * tally the send itself reported — and the notifications carrying its
 * `dedupeKey` are the live state. Joining them is the only way to answer
 * "did anybody read it", which the tally at send time cannot know.
 */
export async function broadcastHistory(limit = 25) {
  const sends = await AuditLogModel.find({ action: 'notifications.broadcast' })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const keys = sends.map(send => String(send.subjectId));
  const live = await NotificationModel.aggregate<{ _id: string; rows: number; read: number; pushed: number; pending: number }>([
    { $match: { dedupeKey: { $in: keys } } },
    {
      $group: {
        _id: '$dedupeKey',
        rows: { $sum: 1 },
        read: { $sum: { $cond: ['$read', 1, 0] } },
        pushed: { $sum: { $cond: [{ $ne: ['$pushedAt', null] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $ne: ['$pushDeferredUntil', null] }, 1, 0] } },
      },
    },
  ]);
  const liveOf = new Map(live.map(row => [row._id, row]));

  return {
    data: sends.map(send => {
      const after = (send.after ?? {}) as Record<string, unknown>;
      const now = liveOf.get(String(send.subjectId));
      const rows = now?.rows ?? 0;
      return {
        id: String(send.subjectId),
        at: iso((send as { createdAt?: Date }).createdAt),
        actorId: send.actorId ?? null,
        topic: String(after.topic ?? ''),
        title: String(after.title ?? ''),
        message: String(after.message ?? ''),
        segment: (after.segment ?? {}) as Record<string, unknown>,
        reason: (after.reason as string | undefined) ?? null,
        /** What the send itself reported, at the time. */
        sent: {
          recipients: Number(after.recipients ?? 0),
          created: Number(after.created ?? 0),
          duplicate: Number(after.duplicate ?? 0),
          suppressed: Number(after.suppressed ?? 0),
          pushed: Number(after.pushed ?? 0),
          deferred: Number(after.deferred ?? 0),
          notPushed: Number(after.notPushed ?? 0),
        },
        /** And what is true now: rows still in feeds, and how many were opened. */
        live: {
          rows,
          read: now?.read ?? 0,
          pushed: now?.pushed ?? 0,
          pending: now?.pending ?? 0,
          openRate: rows === 0 ? 0 : Math.round(((now?.read ?? 0) / rows) * 1000) / 1000,
        },
        /** Rows nobody has opened — what a retraction could still remove. */
        retractable: rows - (now?.read ?? 0),
      };
    }),
    nextCursor: null,
  };
}

export const deleteNotificationBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

/**
 * Takes one notification out of one member's feed.
 *
 * Which also cancels a push quiet hours were still holding: the hourly tick
 * reads the row, and a row that has gone sends nothing. A push that has
 * already been delivered is on the phone and is not ours to take back — the
 * answer says which of the two this was.
 */
export async function deleteNotification(actor: string, id: string, reason: string) {
  const before = await NotificationModel.findById(id).lean();
  if (!before) throw Errors.notFound('That notification');

  await NotificationModel.deleteOne({ _id: id });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'notifications.deleted',
    subjectType: 'notification',
    subjectId: id,
    before: { userId: before.userId, topic: before.topic, title: before.title, read: before.read ?? false, pushedAt: iso(before.pushedAt) },
    after: { deleted: true, reason },
  });

  return {
    deleted: true,
    id,
    userId: before.userId,
    /** It had already been read, so removing it is tidying rather than unsending. */
    wasRead: before.read ?? false,
    /** The push had already gone out: that part cannot be taken back. */
    wasPushed: before.pushedAt !== null && before.pushedAt !== undefined,
    /** A held push that will now never be sent. */
    cancelledPush: Boolean(before.pushDeferredUntil),
  };
}

export const retractBody = z
  .object({
    reason: z.string().trim().min(3).max(300),
    /** Required, like the send's own: a retraction is a fleet-wide write. */
    confirm: z.literal(true),
  })
  .strict();

/**
 * Takes back as much of a broadcast as can be taken back.
 *
 * The rows nobody has opened are deleted, which also cancels any push still
 * held by quiet hours. The rows somebody has already read are **left
 * alone** — deleting a message out of a feed after it has been read would
 * make a member who asks about it look mistaken, and the push that rang
 * cannot be unrung either. Both counts come back, because "it was retracted"
 * and "it was retracted from the people who had not looked yet" are
 * different sentences and only one of them is true.
 */
export async function retractBroadcast(actor: string, dedupeKey: string, reason: string) {
  const held = await NotificationModel.countDocuments({ dedupeKey });
  if (held === 0) throw Errors.notFound('Any notification from that broadcast');

  const [read, pushed] = await Promise.all([
    NotificationModel.countDocuments({ dedupeKey, read: true }),
    NotificationModel.countDocuments({ dedupeKey, pushedAt: { $ne: null } }),
  ]);
  const gone = await NotificationModel.deleteMany({ dedupeKey, read: false });

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'notifications.retracted',
    subjectType: 'broadcast',
    subjectId: dedupeKey,
    before: { rows: held, read, pushed },
    after: { removed: gone.deletedCount ?? 0, leftBecauseRead: read, reason },
  });

  return {
    retracted: true,
    dedupeKey,
    removed: gone.deletedCount ?? 0,
    /** Still in those members' feeds, because they had already opened them. */
    leftBecauseRead: read,
    /** Already delivered to a phone before this: not ours to take back. */
    alreadyPushed: pushed,
  };
}
