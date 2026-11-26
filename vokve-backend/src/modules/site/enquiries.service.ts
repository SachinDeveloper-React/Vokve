import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { env } from '../../config/env.js';
import { SITE_ENQUIRY_STATUSES, type SiteEnquiryBody } from '../../contracts/site.js';
import { getKV } from '../../db/redis.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { isEmailConfigured, sendEnquiryReply } from '../../lib/mail.js';
import { alertMailFailure, warnIfNearMailLimit } from '../../lib/mailHealth.js';
import { UserModel } from '../identity/models.js';
import { AuditLogModel } from '../platform/models.js';
import { SiteEnquiryModel } from './models.js';

/**
 * The website's contact form (RULES P22).
 *
 * Messages are written to `site_enquiries` and read on the panel's
 * Enquiries page — not mailed to the team, because the support mailbox
 * shares the OTP sender's daily allowance (RULES P20) and a burst of spam
 * must never cost a member their sign-in code. Nothing automatic goes back
 * to the sender either, for the same reason; the team replies from the
 * panel, which sends one email per answer.
 */

// ─── Who is asking ─────────────────────────────────────────────────────────

/**
 * The form is posted by the website's own server, so `req.ip` is the
 * website — every visitor would share one limit. The site says who the
 * visitor is in `x-vokve-visitor-ip`, and is believed only when it also
 * proves it is the site with the secret the two already share for
 * refreshing (`SITE_REVALIDATE_SECRET`). Anyone else is limited by their
 * own address.
 */
export function visitorIp(req: Request): string {
  const secret = env.SITE_REVALIDATE_SECRET;
  const given = req.get('x-vokve-site-key');
  const claimed = req.get('x-vokve-visitor-ip')?.trim();
  if (secret && given && claimed && /^[0-9a-fA-F:.]{3,45}$/.test(claimed)) {
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return claimed;
  }
  return req.ip ?? 'unknown';
}

/** Per visitor: a few an hour, a handful a day. Per address and overall: a ceiling no bot gets past. */
const LIMITS = [
  { key: (ip: string) => `rl:site-contact-hour:${ip}`, max: 5, seconds: 60 * 60 },
  { key: (ip: string) => `rl:site-contact-day:${ip}`, max: 15, seconds: 24 * 60 * 60 },
] as const;
const PER_EMAIL_PER_DAY = 5;
const ALL_PER_DAY = 500;

async function overLimit(ip: string, email: string): Promise<number | null> {
  const kv = getKV();
  for (const limit of LIMITS) {
    if ((await kv.incrWithTtl(limit.key(ip), limit.seconds)) > limit.max) return limit.seconds;
  }
  if ((await kv.incrWithTtl(`rl:site-contact-email:${email.toLowerCase()}`, 24 * 60 * 60)) > PER_EMAIL_PER_DAY) return 24 * 60 * 60;
  if ((await kv.incrWithTtl(`rl:site-contact-all:${new Date().toISOString().slice(0, 10)}`, 26 * 60 * 60)) > ALL_PER_DAY) {
    logger.warn({ ceiling: ALL_PER_DAY }, 'site.contact_daily_ceiling');
    return 60 * 60;
  }
  return null;
}

/**
 * Takes a message from the website. A filled honeypot is answered exactly
 * like a real send and dropped, so a bot learns nothing from the answer.
 */
export async function receiveEnquiry(body: SiteEnquiryBody, ip: string) {
  if (body.website && body.website.trim() !== '') {
    logger.info('site.contact_honeypot');
    return { received: true };
  }
  const wait = await overLimit(ip, body.email);
  if (wait) throw Errors.rateLimited(wait);

  const member = await UserModel.findOne({ email: body.email }, { _id: 1 })
    .collation({ locale: 'en', strength: 2 })
    .lean();

  await SiteEnquiryModel.create({
    _id: newId('enq'),
    name: body.name,
    email: body.email.toLowerCase(),
    phone: body.phone ?? null,
    topic: body.topic ?? null,
    message: body.message,
    page: body.page ?? null,
    userId: member ? String(member._id) : null,
  });
  return { received: true };
}

// ─── The panel's inbox ─────────────────────────────────────────────────────

const iso = (at: Date | null | undefined) => at?.toISOString() ?? null;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const enquiryQuery = z.object({
  status: z.enum(['waiting', 'any', ...SITE_ENQUIRY_STATUSES]).default('waiting'),
  q: z.string().max(160).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

type EnquiryRow = {
  _id: string;
  name: string;
  email: string;
  phone?: string | null;
  topic?: string | null;
  message: string;
  page?: string | null;
  status: string;
  userId?: string | null;
  note?: string | null;
  replies?: Array<{ id: string; body: string; by: string; via: string; at: Date }>;
  handledBy?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

function view(row: EnquiryRow) {
  return {
    id: row._id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? null,
    topic: row.topic ?? null,
    message: row.message,
    page: row.page ?? null,
    status: row.status,
    userId: row.userId ?? null,
    note: row.note ?? null,
    replies: (row.replies ?? []).map(reply => ({ id: reply.id, body: reply.body, by: reply.by, via: reply.via, at: iso(reply.at) })),
    handledBy: row.handledBy ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function listEnquiries(query: z.infer<typeof enquiryQuery>) {
  const filter: Record<string, unknown> = {};
  if (query.status === 'waiting') filter.status = { $in: ['new', 'open'] };
  else if (query.status !== 'any') filter.status = query.status;
  const words = query.q.trim();
  if (words) {
    const like = new RegExp(escape(words), 'i');
    filter.$or = [{ name: like }, { email: like }, { message: like }, { topic: like }, { _id: like }];
  }
  const [rows, total, byStatus] = await Promise.all([
    SiteEnquiryModel.find(filter).sort({ createdAt: -1 }).skip(query.offset).limit(query.limit).lean(),
    SiteEnquiryModel.countDocuments(filter),
    SiteEnquiryModel.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  return {
    total,
    offset: query.offset,
    limit: query.limit,
    counts: Object.fromEntries(SITE_ENQUIRY_STATUSES.map(status => [status, byStatus.find(row => row._id === status)?.count ?? 0])),
    emailConfigured: isEmailConfigured(),
    data: (rows as unknown as EnquiryRow[]).map(view),
  };
}

async function requireEnquiry(id: string) {
  const row = await SiteEnquiryModel.findById(id).lean();
  if (!row) throw Errors.notFound('That message');
  return row as unknown as EnquiryRow;
}

export async function getEnquiry(id: string) {
  const row = await requireEnquiry(id);
  const earlier = await SiteEnquiryModel.find({ email: row.email, _id: { $ne: row._id } })
    .select('topic status createdAt')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  return {
    ...view(row),
    emailConfigured: isEmailConfigured(),
    /** Other messages from the same address, newest first. */
    earlier: earlier.map(other => ({ id: String(other._id), topic: other.topic ?? null, status: other.status, createdAt: iso((other as { createdAt?: Date }).createdAt) })),
  };
}

export const enquiryPatch = z
  .object({
    status: z.enum(SITE_ENQUIRY_STATUSES).optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export async function updateEnquiry(actor: string, id: string, body: z.infer<typeof enquiryPatch>) {
  const before = await requireEnquiry(id);
  const set: Record<string, unknown> = { handledBy: actor };
  if (body.status) set.status = body.status;
  if (body.note !== undefined) set.note = body.note || null;
  await SiteEnquiryModel.updateOne({ _id: id }, { $set: set });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'site.enquiry_updated',
    subjectType: 'site_enquiry',
    subjectId: id,
    before: { status: before.status },
    after: { status: body.status ?? before.status, noteChanged: body.note !== undefined },
  });
  return getEnquiry(id);
}

export const enquiryReplyBody = z
  .object({
    message: z.string().trim().min(2).max(8000),
    /** `true` emails it from the server; `false` only writes down an answer given elsewhere (a call, the mailbox). */
    send: z.boolean(),
    subject: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export async function replyToEnquiry(actor: string, id: string, body: z.infer<typeof enquiryReplyBody>) {
  const enquiry = await requireEnquiry(id);
  if (enquiry.status === 'spam') throw Errors.conflict('ENQUIRY_IS_SPAM', 'This message is marked as spam. Mark it as open first if it is real.');

  if (body.send) {
    if (!isEmailConfigured()) {
      throw new ApiError(
        503,
        'EMAIL_UNAVAILABLE',
        'Email is not set up on the server, so the reply cannot be sent from here. Answer from the support mailbox and log it here instead.',
      );
    }
    const { support } = await getConfig();
    const subject = body.subject ?? `Re: your message to ${support.company}${enquiry.topic ? ` — ${enquiry.topic}` : ''}`;
    const quoted = enquiry.message
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n');
    const text = `Hi ${enquiry.name},\n\n${body.message}\n\n— ${support.company}\n${support.email}\n\nYou wrote:\n${quoted}`;
    try {
      const sentToday = await sendEnquiryReply(enquiry.email, subject, text, support.email);
      await warnIfNearMailLimit(sentToday);
    } catch (error) {
      await alertMailFailure(error, 'enquiry_reply');
      throw new ApiError(502, 'EMAIL_FAILED', 'The email could not be sent. Nothing was saved — try again, or answer from the support mailbox and log it here.');
    }
  }

  await SiteEnquiryModel.updateOne(
    { _id: id },
    {
      $push: { replies: { id: newId('erep'), body: body.message, by: actor, via: body.send ? 'sent' : 'logged', at: new Date() } },
      $set: { status: 'replied', handledBy: actor },
    },
  );
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: body.send ? 'site.enquiry_replied' : 'site.enquiry_reply_logged',
    subjectType: 'site_enquiry',
    subjectId: id,
    before: { status: enquiry.status },
    after: { status: 'replied', length: body.message.length },
  });
  return getEnquiry(id);
}

/** A real delete: the sender's words leave with it (spam, or a request to forget them). */
export async function deleteEnquiry(actor: string, id: string) {
  const before = await requireEnquiry(id);
  await SiteEnquiryModel.deleteOne({ _id: id });
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'site.enquiry_deleted',
    subjectType: 'site_enquiry',
    subjectId: id,
    before: { status: before.status, topic: before.topic ?? null },
    after: { deleted: true },
  });
  return { deleted: true, id };
}
