import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessClaims {
  sub: string;
  tier: string;
}

export function signAccessToken(claims: AccessClaims): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + env.ACCESS_TOKEN_TTL_SECONDS * 1000;
  const token = jwt.sign(claims, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'vokve',
  });
  return { token, expiresAt };
}

/**
 * The one algorithm these tokens are signed with, and so the only one
 * accepted back. Left unsaid, the library takes any of the HMAC family for
 * a string secret — nothing an attacker without the secret can use, but
 * "whatever the token's own header asks for" is not a rule to leave
 * standing in front of every request.
 */
const VERIFY = { issuer: 'vokve', algorithms: ['HS256'] } satisfies jwt.VerifyOptions;

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, VERIFY);
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null;
    // An access token carries no `kind`. Every other token this server
    // signs does — a step-up token is `kind: 'step_up'` — and is signed
    // with the same secret, for the same member, by the same issuer. So
    // without this line a step-up token was a session: one with no `tier`
    // claim, read below as `normal`, which handed a restricted account ten
    // minutes of an unrestricted one each time it passed its own OTP.
    if ((payload as Record<string, unknown>).kind !== undefined) return null;
    return { sub: payload.sub, tier: String((payload as Record<string, unknown>).tier ?? 'normal') };
  } catch {
    return null;
  }
}

/** Opaque refresh tokens: random, stored hashed (RULES Z1). */
export function newRefreshToken(): { token: string; hash: string } {
  const token = `rt_${crypto.randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** How long a step-up token may be held before it is used (RULES O8). */
export const STEP_UP_TTL_SECONDS = 10 * 60;

export interface StepUpClaims {
  sub: string;
  /** Random per token, so the KV can mark it spent (one action, once). */
  jti: string;
}

/**
 * The proof that a second factor just passed, for one sensitive action.
 * A signed JWT rather than a stored row: it carries its own expiry and the
 * `jti` is what `consumeStepUp` burns, so no table has to be cleaned up.
 */
export function signStepUpToken(userId: string): string {
  return jwt.sign({ sub: userId, kind: 'step_up', jti: crypto.randomBytes(16).toString('hex') }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: STEP_UP_TTL_SECONDS,
    issuer: 'vokve',
  });
}

export function verifyStepUpToken(token: string): StepUpClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, VERIFY);
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') return null;
    if ((payload as Record<string, unknown>).kind !== 'step_up') return null;
    return { sub: payload.sub, jti: payload.jti };
  } catch {
    return null;
  }
}
