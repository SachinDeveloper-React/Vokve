import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { getKV } from '../db/redis.js';
import { ApiError, Errors } from '../lib/errors.js';
import { verifyAdminSession } from '../lib/tokens.js';
import { resolveSession } from '../modules/staff/auth.service.js';
import { ALL_PERMISSIONS } from '../modules/staff/permissions.js';
import type { StaffPrincipal } from './context.js';

/**
 * The operator's own door (`/v1/admin/*`).
 *
 * There is no admin account and no admin role on a member: the key lives in
 * the operator's environment, so no member token — stolen, rooted or
 * otherwise — can ever reach these routes, and nothing in the app has to know
 * the admin surface exists.
 *
 * Three ways through.
 *
 * - **A member of staff** (RULES Z9) — the normal door: signed in at
 *   `POST /v1/admin/staff/login` with email, password and authenticator,
 *   sending `x-staff-session`. What they may then do is their permissions,
 *   checked route by route (`modules/staff/guard.ts`).
 * - **The key, traded for a session** (RULES Z7) at `POST /v1/admin/session`,
 *   sent as `x-admin-session`.
 * - **The bare key** in `x-admin-key`, for scripts — only while no
 *   authenticator is set up for it (`ADMIN_TOTP_SECRET`).
 *
 * The key is the break-glass door: it acts as `root`, with every permission,
 * and the activity log records each use. With no key configured its two
 * doors answer 404 rather than 401 — a server never meant to be
 * administered by key should not advertise one.
 */
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  const staffToken = req.header('x-staff-session');
  const session = req.header('x-admin-session');
  const key = req.header('x-admin-key');
  if (!staffToken && !env.ADMIN_API_KEY) return next(Errors.notFound('That'));
  if (!staffToken && !session && !key) return next(Errors.unauthorized());

  // Staff sessions are checked before — and apart from — the address
  // lockout. Every panel request reaches this server from the panel's own
  // address, so a lockout counted per address would let twenty wrong keys
  // typed into the panel's recovery form lock every member of staff out. A
  // staff token is 256 random bits; there is nothing to guess.
  if (staffToken) {
    const resolved = await resolveSession(staffToken);
    if ('principal' in resolved) {
      req.ctx.staff = resolved.principal;
      req.ctx.adminActor = `${resolved.principal.role}:${resolved.principal.email}`;
      return next();
    }
    return next(resolved.error);
  }

  if (await adminLockedOut(req.ip)) return next(Errors.rateLimited(ADMIN_LOCKOUT_SECONDS));

  if (session) {
    const claims = verifyAdminSession(session);
    if (claims && (claims.mfa || !isAdminMfaRequired())) return asRoot(req, next);
    // A session from before the authenticator was set up is not a guess,
    // just out of date: sign in again, without counting against the address.
    if (claims) return next(adminMfaRequired());
  } else if (adminKeyMatches(key)) {
    if (isAdminMfaRequired()) return next(adminMfaRequired());
    return asRoot(req, next);
  }

  await recordAdminFailure(req.ip);
  return next(Errors.unauthorized());
};

const ROOT: StaffPrincipal = {
  kind: 'root',
  id: 'root',
  role: 'root',
  name: 'Owner (admin key)',
  email: null,
  managerId: null,
  permissions: new Set(ALL_PERMISSIONS),
  sessionId: null,
  restricted: false,
};

function asRoot(req: Parameters<RequestHandler>[0], next: Parameters<RequestHandler>[2]) {
  req.ctx.staff = ROOT;
  req.ctx.adminActor = env.ADMIN_ACTOR;
  next();
}

export function isAdminMfaRequired(): boolean {
  return Boolean(env.ADMIN_TOTP_SECRET);
}

export function adminMfaRequired(): ApiError {
  return new ApiError(401, 'ADMIN_MFA_REQUIRED', 'Sign in to the panel again with the code from your authenticator app.');
}

/** Compared in constant time, and only at equal length — `timingSafeEqual` throws on a mismatch. */
export function adminKeyMatches(offeredKey: string | undefined): boolean {
  const configured = env.ADMIN_API_KEY;
  if (!configured || !offeredKey) return false;
  const offered = Buffer.from(offeredKey, 'utf8');
  const expected = Buffer.from(configured, 'utf8');
  return offered.length === expected.length && timingSafeEqual(offered, expected);
}

/**
 * Guessing the key from one address stops after twenty wrong answers in a
 * quarter of an hour, for a quarter of an hour (RULES Z3). Only a wrong key
 * or session counts — a request that offered none is not a guess, and the
 * operator's own requests never come near the limit.
 */
const ADMIN_FAILURES_ALLOWED = 20;
export const ADMIN_LOCKOUT_SECONDS = 15 * 60;

export async function adminLockedOut(ip: string | undefined): Promise<boolean> {
  return ip ? getKV().has(`admin-auth-lock:${ip}`) : false;
}

export async function recordAdminFailure(ip: string | undefined): Promise<void> {
  if (!ip) return;
  const failures = await getKV().incrWithTtl(`rl:admin-auth-fail:${ip}`, ADMIN_LOCKOUT_SECONDS);
  if (failures >= ADMIN_FAILURES_ALLOWED) await getKV().setIfAbsent(`admin-auth-lock:${ip}`, ADMIN_LOCKOUT_SECONDS);
}
