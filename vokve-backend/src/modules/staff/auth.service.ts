import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request } from 'express';
import { z } from 'zod';
import { getKV } from '../../db/redis.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { newTotpSecret, totpUri, verifyTotp } from '../../lib/totp.js';
import type { StaffPrincipal } from '../../middleware/context.js';
import { operatorOf, recordAuthEvent } from './activity.js';
import { open, seal } from './crypto.js';
import { StaffModel, StaffSessionModel, type StaffDoc } from './models.js';
import { effectivePermissions, type StaffRole } from './permissions.js';

/**
 * Staff sign-in (RULES Z9): email, password and — once enrolled, which the
 * first sign-in forces — the authenticator's six digits.
 *
 * Sessions are rows, not signed tokens: the browser holds a random token,
 * the server keeps its hash, and every request looks it up. That is what
 * lets a suspension, a password reset or "sign out everywhere" land on the
 * next click instead of whenever a token would have expired.
 */

export const SESSION_HOURS = 12;
const IDLE_MINUTES = 120;
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
/** Same cost as members' passwords, and the same dummy so a missing account takes as long. */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5aKq3wHjJ7a1pQd9dfZKQv0Xw1ZbUeq';

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(72, 'Passwords cannot be longer than 72 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

export const loginBody = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(256),
    code: z.string().trim().regex(/^\d{6}$/, 'Six digits').optional(),
  })
  .strict();

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Fourteen characters a person can read off a screen and type: no 0/O, 1/l/I. */
export function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(14);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  // Guarantee the policy's letter and digit, whatever the bytes said.
  return `${out.slice(0, 12)}7k`;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

type Actor = { kind: 'staff' | 'unknown'; id: string | null; role: string | null; name: string | null; email: string | null; managerId: string | null };
const actorFor = (staff: StaffDoc): Actor => ({ kind: 'staff', id: staff._id, role: staff.role, name: staff.name, email: staff.email, managerId: staff.managerId ?? null });

/**
 * Whether this person may use the panel at all right now, beyond their own
 * row: an agent whose manager is switched off is switched off with them.
 */
async function hierarchyBlock(staff: StaffDoc): Promise<{ blocked: ApiError | null; manager: StaffDoc | null }> {
  if (staff.role !== 'agent') return { blocked: null, manager: null };
  const manager = staff.managerId ? ((await StaffModel.findById(staff.managerId).lean()) as StaffDoc | null) : null;
  if (!manager || manager.status !== 'active' || manager.role !== 'manager') {
    return {
      blocked: new ApiError(403, 'STAFF_MANAGER_INACTIVE', 'Your manager’s account is switched off, so yours is too. Ask an admin to move you to another manager.'),
      manager,
    };
  }
  return { blocked: null, manager };
}

function needsSetup(staff: StaffDoc) {
  return { changePassword: Boolean(staff.mustChangePassword), enrollTotp: !staff.totp?.enabledAt };
}

export async function login(req: Request, body: z.infer<typeof loginBody>) {
  const refused = () => new ApiError(401, 'STAFF_LOGIN_FAILED', 'That email and password do not match a staff account.');
  const staff = (await StaffModel.findOne({ email: body.email }).lean()) as StaffDoc | null;

  if (!staff || staff.status === 'deleted') {
    await bcrypt.compare(body.password, DUMMY_HASH);
    await recordAuthEvent(req, 'login_failed', { kind: 'unknown', id: null, role: null, name: null, email: body.email, managerId: null }, false, 'STAFF_LOGIN_FAILED');
    throw refused();
  }
  const actor = actorFor(staff);

  if (staff.lockedUntil && staff.lockedUntil > new Date()) {
    const wait = Math.ceil((staff.lockedUntil.getTime() - Date.now()) / 1000);
    await recordAuthEvent(req, 'login_locked', actor, false, 'STAFF_LOCKED');
    throw new ApiError(429, 'STAFF_LOCKED', `Too many wrong attempts. Try again in ${Math.ceil(wait / 60)} minutes.`, { retryAfterSeconds: wait });
  }

  const failed = async (code: string, error: ApiError) => {
    const failures = (staff.failedLogins ?? 0) + 1;
    const lock = failures >= LOCK_AFTER;
    await StaffModel.updateOne(
      { _id: staff._id },
      { $set: lock ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: failures } },
    );
    await recordAuthEvent(req, lock ? 'locked' : 'login_failed', actor, false, code);
    throw error;
  };

  if (!(await bcrypt.compare(body.password, staff.passwordHash))) {
    return failed('STAFF_LOGIN_FAILED', refused());
  }
  // Only now — with the password proven — does the answer say anything
  // about the account's state.
  if (staff.status === 'suspended') {
    await recordAuthEvent(req, 'login_failed', actor, false, 'STAFF_SUSPENDED');
    throw new ApiError(403, 'STAFF_SUSPENDED', 'This account is suspended. Ask whoever manages you.');
  }
  const { blocked } = await hierarchyBlock(staff);
  if (blocked) {
    await recordAuthEvent(req, 'login_failed', actor, false, blocked.code);
    throw blocked;
  }

  let mfa = false;
  if (staff.totp?.enabledAt && staff.totp.secret) {
    if (!body.code) throw new ApiError(401, 'STAFF_MFA_REQUIRED', 'Enter the six-digit code from your authenticator app.');
    const opened = open(staff.totp.secret);
    if (!opened) throw new ApiError(500, 'STAFF_MFA_UNREADABLE', 'Your authenticator could not be read. Ask for it to be reset.');
    const step = verifyTotp(opened.plain, body.code);
    if (step === null || (staff.totp.lastStep != null && step <= staff.totp.lastStep)) {
      return failed('STAFF_MFA_INVALID', new ApiError(401, 'STAFF_MFA_INVALID', 'That code is not right, or it was already used. Use the one on screen now.'));
    }
    await StaffModel.updateOne(
      { _id: staff._id },
      { $set: { 'totp.lastStep': step, ...(opened.needsReseal ? { 'totp.secret': seal(opened.plain) } : {}) } },
    );
    mfa = true;
  }

  const setup = needsSetup(staff);
  const session = await openSession(staff, req, mfa, setup.changePassword || setup.enrollTotp);
  await StaffModel.updateOne(
    { _id: staff._id },
    { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: req.ip ?? null } },
  );
  await recordAuthEvent(req, 'login', actor, true);
  return { token: session.token, expiresAt: session.expiresAt.getTime(), setup };
}

async function openSession(staff: StaffDoc, req: Request, mfa: boolean, restricted: boolean) {
  const token = `sts_${crypto.randomBytes(32).toString('base64url')}`;
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_HOURS * 3_600_000);
  await StaffSessionModel.create({
    _id: newId('ses'),
    staffId: staff._id,
    tokenHash: hashToken(token),
    expiresAt,
    idleUntil: new Date(Math.min(expiresAt.getTime(), now + IDLE_MINUTES * 60_000)),
    lastSeenAt: new Date(now),
    ip: req.ip ?? null,
    ...operatorOf(req),
    mfa,
    restricted,
  });
  return { token, expiresAt };
}

/**
 * The person behind a session token, as of this request — or the refusal.
 * Checks, in order: the session, the account, the hierarchy above it.
 */
export async function resolveSession(token: string): Promise<{ principal: StaffPrincipal } | { error: ApiError; guess: boolean }> {
  const invalid = { error: new ApiError(401, 'STAFF_SESSION_INVALID', 'Your session has ended. Sign in again.'), guess: true };
  if (!/^sts_[\w-]{20,80}$/.test(token)) return invalid;
  const now = new Date();
  const session = await StaffSessionModel.findOne({ tokenHash: hashToken(token) }).lean();
  if (!session) return invalid;
  if (session.revokedAt || session.expiresAt <= now || session.idleUntil <= now) return { ...invalid, guess: false };

  const staff = (await StaffModel.findById(session.staffId).lean()) as StaffDoc | null;
  if (!staff || staff.status !== 'active') {
    return { error: new ApiError(401, 'STAFF_SUSPENDED', 'This account is no longer active.'), guess: false };
  }
  const { blocked, manager } = await hierarchyBlock(staff);
  if (blocked) return { error: blocked, guess: false };

  if (!session.lastSeenAt || now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await StaffSessionModel.updateOne(
      { _id: session._id },
      { $set: { lastSeenAt: now, idleUntil: new Date(Math.min(session.expiresAt.getTime(), now.getTime() + IDLE_MINUTES * 60_000)) } },
    );
  }
  const setup = needsSetup(staff);
  return {
    principal: {
      kind: 'staff',
      id: staff._id,
      role: staff.role as StaffRole,
      name: staff.name,
      email: staff.email,
      managerId: staff.managerId ?? null,
      permissions: effectivePermissions({ role: staff.role as StaffRole, permissions: staff.permissions }, manager ? { role: manager.role as StaffRole, permissions: manager.permissions } : null),
      sessionId: session._id,
      restricted: session.restricted || setup.changePassword || setup.enrollTotp,
    },
  };
}

export async function revokeSessions(staffId: string, reason: string, except?: string | null): Promise<number> {
  const result = await StaffSessionModel.updateMany(
    { staffId, revokedAt: null, ...(except ? { _id: { $ne: except } } : {}) },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  return result.modifiedCount;
}

// ─── One's own account ───────────────────────────────────────────────────────

function requireStaff(who: StaffPrincipal): void {
  if (who.kind !== 'staff') throw new ApiError(400, 'NOT_A_STAFF_ACCOUNT', 'The admin key has no account to change. Sign in as a person.');
}

async function loadSelf(who: StaffPrincipal): Promise<StaffDoc> {
  requireStaff(who);
  const staff = (await StaffModel.findById(who.id).lean()) as StaffDoc | null;
  if (!staff) throw Errors.unauthorized();
  return staff;
}

/** After the last setup step, the session that took it is let out of setup. */
async function releaseIfReady(who: StaffPrincipal): Promise<void> {
  const fresh = (await StaffModel.findById(who.id).lean()) as StaffDoc | null;
  if (fresh && !needsSetup(fresh).changePassword && !needsSetup(fresh).enrollTotp && who.sessionId) {
    await StaffSessionModel.updateOne({ _id: who.sessionId }, { $set: { restricted: false } });
  }
}

export const changePasswordBody = z
  .object({ currentPassword: z.string().min(1).max(256), newPassword: passwordSchema })
  .strict();

export async function changeOwnPassword(req: Request, who: StaffPrincipal, body: z.infer<typeof changePasswordBody>) {
  const staff = await loadSelf(who);
  if (!(await bcrypt.compare(body.currentPassword, staff.passwordHash))) {
    throw Errors.validation({ currentPassword: 'That is not your current password.' });
  }
  if (await bcrypt.compare(body.newPassword, staff.passwordHash)) {
    throw Errors.validation({ newPassword: 'Choose a password different from the current one.' });
  }
  await StaffModel.updateOne(
    { _id: staff._id },
    { $set: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false, passwordChangedAt: new Date() } },
  );
  // Everywhere else is signed out: whoever knew the old password is not
  // still in on a session it opened.
  const signedOut = await revokeSessions(staff._id, 'password_changed', who.sessionId);
  await releaseIfReady(who);
  await recordAuthEvent(req, 'password_changed', actorFor(staff), true);
  return { ok: true, otherSessionsSignedOut: signedOut };
}

/** Starts enrolment: a fresh secret, held pending until a code from it is typed back. */
export async function startTotp(who: StaffPrincipal) {
  const staff = await loadSelf(who);
  if (staff.totp?.enabledAt) {
    throw Errors.conflict('TOTP_ALREADY_ENROLLED', 'Your authenticator is already set up. To move it to a new phone, ask whoever manages you to reset it.');
  }
  const secret = newTotpSecret();
  await StaffModel.updateOne({ _id: staff._id }, { $set: { 'totp.pendingSecret': seal(secret), 'totp.pendingAt': new Date() } });
  return { secret, uri: totpUri(secret, staff.email, 'VOKVE Staff') };
}

export async function confirmTotp(req: Request, who: StaffPrincipal, code: string) {
  const staff = await loadSelf(who);
  if (staff.totp?.enabledAt) throw Errors.conflict('TOTP_ALREADY_ENROLLED', 'Your authenticator is already set up.');
  const pending = staff.totp?.pendingSecret ? open(staff.totp.pendingSecret) : null;
  if (!pending || !staff.totp?.pendingAt || Date.now() - staff.totp.pendingAt.getTime() > 30 * 60_000) {
    throw Errors.conflict('TOTP_SETUP_EXPIRED', 'Start the authenticator setup again — the last one has expired.');
  }
  const step = verifyTotp(pending.plain, code);
  if (step === null) throw Errors.validation({ code: 'That code does not match. Check the app shows VOKVE Staff and try the current code.' });
  await StaffModel.updateOne(
    { _id: staff._id },
    { $set: { 'totp.secret': seal(pending.plain), 'totp.enabledAt': new Date(), 'totp.lastStep': step, 'totp.pendingSecret': null, 'totp.pendingAt': null } },
  );
  if (who.sessionId) await StaffSessionModel.updateOne({ _id: who.sessionId }, { $set: { mfa: true } });
  await releaseIfReady(who);
  await recordAuthEvent(req, 'totp_enrolled', actorFor(staff), true);
  return { ok: true };
}

export async function logout(req: Request, who: StaffPrincipal) {
  if (who.kind !== 'staff' || !who.sessionId) return { ok: true };
  await StaffSessionModel.updateOne({ _id: who.sessionId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'logout' } });
  await recordAuthEvent(req, 'logout', { kind: 'staff', id: who.id, role: who.role, name: who.name, email: who.email, managerId: who.managerId }, true);
  return { ok: true };
}

export async function listSessions(staffId: string, currentSessionId: string | null = null) {
  const now = new Date();
  const rows = await StaffSessionModel.find({ staffId, revokedAt: null, expiresAt: { $gt: now }, idleUntil: { $gt: now } })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return rows.map(row => ({
    id: row._id,
    createdAt: (row as { createdAt?: Date }).createdAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    ip: row.clientIp ?? row.ip,
    userAgent: row.userAgent,
    mfa: row.mfa,
    current: row._id === currentSessionId,
  }));
}

export async function revokeOwnSession(who: StaffPrincipal, sessionId: string) {
  requireStaff(who);
  const result = await StaffSessionModel.updateOne({ _id: sessionId, staffId: who.id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'signed_out_by_self' } });
  if (result.matchedCount === 0) throw Errors.notFound('That session');
  return { ok: true };
}

/**
 * The brakes on guessing, beside the account's own lock after five wrong
 * answers. Per email first: sign-ins arrive through the panel, so they all
 * share the panel's address, and a tight per-address limit would turn a
 * team's morning sign-ins into a lockout. The panel limits each real
 * visitor's address itself (`vokve-crm/src/proxy.ts`); the per-address
 * ceiling here is only for somebody calling the API directly.
 */
export async function loginThrottled(ip: string | undefined, email: string): Promise<boolean> {
  const [byIp, byEmail] = await Promise.all([
    ip ? getKV().incrWithTtl(`rl:staff-login-ip:${ip}`, 900) : Promise.resolve(0),
    getKV().incrWithTtl(`rl:staff-login-email:${email}`, 900),
  ]);
  return byIp > 300 || byEmail > 20;
}
