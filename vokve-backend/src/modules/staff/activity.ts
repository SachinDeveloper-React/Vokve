import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import type { StaffPrincipal } from '../../middleware/context.js';
import { StaffActivityModel, StaffModel } from './models.js';

/**
 * The activity log (RULES Z9): every request on the admin surface, by whom.
 *
 * Written *before* the answer goes out — `res.json` is wrapped, and the
 * response waits for the row. On a serverless host the instance can be
 * frozen the moment a response is sent, and a log written after it is a log
 * that sometimes is not written; for this log, "sometimes" is not good
 * enough. A row that cannot be written is logged and the answer still goes
 * out: the operator's action has already happened by then.
 */

const DAY = 86_400_000;
const KEEP_READS_MS = 180 * DAY;
const KEEP_OTHER_MS = 730 * DAY;

/** Values never written to the log, whatever they are nested under. */
const SECRET_KEY = /pass(word)?|secret|token|^key$|apikey|^code$|otp|authorization|cookie/i;
const MAX_BODY_CHARS = 4_000;

export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '…';
  if (Array.isArray(value)) return value.slice(0, 50).map(item => scrubValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : scrubValue(inner, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

function bounded(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  const scrubbed = scrubValue(value);
  const text = JSON.stringify(scrubbed);
  if (text === undefined) return null;
  return text.length > MAX_BODY_CHARS ? { truncated: true, preview: text.slice(0, MAX_BODY_CHARS) } : scrubbed;
}

/**
 * The person's own address and browser. Panel requests reach this server
 * from the panel, so without these every row would carry the panel's
 * address and "node" as the browser. Reported by the panel and so only as
 * good as whoever sent it: kept beside the address the server itself saw,
 * never instead of it, and never used for a limit.
 */
export function operatorOf(req: Request): { clientIp: string | null; userAgent: string | null } {
  const reported = req.header('x-vokve-operator-ip');
  const clientIp = reported && /^[0-9A-Fa-f:.]{3,45}$/.test(reported) ? reported : null;
  const agent = req.header('x-vokve-operator-agent') ?? req.header('user-agent');
  return { clientIp, userAgent: agent ? agent.slice(0, 300) : null };
}

function actorOf(who: StaffPrincipal | undefined) {
  if (!who) return { kind: 'unknown', id: null, role: null, name: null, email: null, managerId: null };
  return { kind: who.kind, id: who.id, role: who.role, name: who.name, email: who.email, managerId: who.managerId };
}

/**
 * Reads of one's own account — "who am I", the permission catalogue, my
 * sessions — are how the panel draws itself, several per page. They are
 * not actions, and recording them buried every real row under them. A
 * refused one is still recorded, and every write is.
 */
const SELF_READS = new Set(['/admin/staff/me', '/admin/staff/permissions', '/admin/staff/me/sessions', '/admin/staff/me/activity']);

async function write(req: Request, res: Response, started: number): Promise<void> {
  const who = req.ctx.staff;
  const method = req.method.toUpperCase();
  const kind = method === 'GET' || method === 'HEAD' ? 'read' : 'write';
  const routePath = (req.route as { path?: string } | undefined)?.path;
  if (kind === 'read' && routePath && SELF_READS.has(routePath) && res.statusCode < 400) return;
  const route = (req.route as { path?: string } | undefined)?.path ?? null;
  const params = req.params && Object.keys(req.params).length > 0 ? { ...req.params } : null;
  const status = res.statusCode;
  const at = new Date();
  await StaffActivityModel.create({
    _id: newId('act'),
    at,
    expireAt: new Date(at.getTime() + (kind === 'read' ? KEEP_READS_MS : KEEP_OTHER_MS)),
    actor: actorOf(who),
    kind,
    method,
    route,
    path: (req.originalUrl ?? req.url).split('?')[0] ?? null,
    params,
    query: kind === 'read' ? bounded(req.query && Object.keys(req.query).length ? req.query : null) : null,
    body: kind === 'write' ? bounded(req.body) : null,
    permission: req.ctx.permission ?? null,
    status,
    errorCode: (res.locals.errorCode as string | undefined) ?? null,
    ok: status < 400,
    targetStaffId: typeof params?.staffId === 'string' ? params.staffId : null,
    ip: req.ip ?? null,
    ...operatorOf(req),
    requestId: req.ctx.requestId,
    durationMs: Date.now() - started,
  });
  if (who?.kind === 'staff' && status < 400) {
    // A cheap "last seen" for the team list, without a second write per request.
    await StaffModel.updateOne(
      { _id: who.id, $or: [{ lastActiveAt: null }, { lastActiveAt: { $lt: new Date(at.getTime() - 60_000) } }] },
      { $set: { lastActiveAt: at } },
    ).catch(() => {});
  }
}

/** Mounted on `/admin`, after the gate: by then `req.ctx.staff` says who is asking. */
export const recordStaffActivity: RequestHandler = (req, res, next) => {
  const started = Date.now();
  let recorded = false;
  const record = () => {
    if (recorded) return Promise.resolve();
    recorded = true;
    return write(req, res, started).catch(error => logger.error({ err: error, path: req.path }, 'staff.activity_write_failed'));
  };
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    void record().finally(() => json(body));
    return res;
  };
  // Anything not answered with JSON (a 204, a stream) is still recorded.
  res.on('finish', () => void record());
  next();
};

/** Sign-ins, sign-outs and the rest — the events that are not one request to one route. */
export async function recordAuthEvent(
  req: Request,
  event: string,
  actor: { kind: 'staff' | 'unknown'; id: string | null; role: string | null; name: string | null; email: string | null; managerId: string | null },
  ok: boolean,
  errorCode: string | null = null,
): Promise<void> {
  const at = new Date();
  try {
    await StaffActivityModel.create({
      _id: newId('act'),
      at,
      expireAt: new Date(at.getTime() + KEEP_OTHER_MS),
      actor,
      kind: 'auth',
      event,
      method: req.method,
      route: (req.route as { path?: string } | undefined)?.path ?? null,
      path: (req.originalUrl ?? req.url).split('?')[0] ?? null,
      ok,
      errorCode,
      status: null,
      ip: req.ip ?? null,
      ...operatorOf(req),
      requestId: req.ctx.requestId,
    });
  } catch (error) {
    logger.error({ err: error, event }, 'staff.activity_write_failed');
  }
}

// ─── Reading it back ─────────────────────────────────────────────────────────

export const activityQuery = z.object({
  staffId: z.string().max(80).optional(),
  role: z.enum(['root', 'admin', 'manager', 'agent']).optional(),
  kind: z.enum(['read', 'write', 'auth']).optional(),
  /** Only refusals: permission denied, failed sign-ins and other 4xx/5xx. */
  failed: z.enum(['1', 'true']).optional(),
  permission: z.string().max(60).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ActivityQuery = z.infer<typeof activityQuery>;

/**
 * Who may read whose rows: an admin (or the key) everybody's; a manager
 * their own and their agents'; anybody their own.
 */
export async function scopeFilter(who: StaffPrincipal): Promise<Record<string, unknown>> {
  if (who.kind === 'root' || who.role === 'admin') return {};
  if (who.role === 'manager') {
    const agents = await StaffModel.find({ managerId: who.id }, { _id: 1 }).lean();
    const ids = [who.id, ...agents.map(a => a._id)];
    return { $or: [{ 'actor.id': { $in: ids } }, { 'actor.managerId': who.id }, { targetStaffId: { $in: ids } }] };
  }
  return { 'actor.id': who.id };
}

export async function listActivity(who: StaffPrincipal, query: ActivityQuery, onlySelf = false) {
  const scope = onlySelf ? { 'actor.id': who.id } : await scopeFilter(who);
  const filter: Record<string, unknown> = { ...scope };
  const and: Record<string, unknown>[] = [];
  if (query.staffId) and.push({ $or: [{ 'actor.id': query.staffId }, { targetStaffId: query.staffId }] });
  if (query.role) filter['actor.role'] = query.role;
  if (query.kind) filter.kind = query.kind;
  if (query.failed) filter.ok = false;
  if (query.permission) filter.permission = query.permission;
  if (query.from || query.to) {
    filter.at = {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      ...(query.to ? { $lt: new Date(new Date(query.to).getTime() + (query.to.length === 10 ? DAY : 0)) } : {}),
    };
  }
  if (and.length) filter.$and = and;

  const [rows, total] = await Promise.all([
    StaffActivityModel.find(filter).sort({ at: -1 }).skip(query.offset).limit(query.limit).lean(),
    StaffActivityModel.countDocuments(filter),
  ]);
  return {
    data: rows.map(row => ({
      id: row._id,
      at: row.at.toISOString(),
      actor: row.actor,
      kind: row.kind,
      event: row.event,
      method: row.method,
      route: row.route,
      path: row.path,
      params: row.params,
      query: row.query,
      body: row.body,
      permission: row.permission,
      status: row.status,
      errorCode: row.errorCode,
      ok: row.ok,
      targetStaffId: row.targetStaffId,
      ip: row.clientIp ?? row.ip,
      via: row.clientIp ? row.ip : null,
      userAgent: row.userAgent,
      durationMs: row.durationMs,
    })),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}
