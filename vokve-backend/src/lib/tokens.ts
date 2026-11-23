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

/**
 * Checks a token against the current secret and, during a rotation, the one
 * before it (RULES Z1). Only a bad *signature* falls back: an expired token
 * is expired whichever secret signed it.
 */
function verifySigned(token: string, options: jwt.VerifyOptions = VERIFY): string | jwt.JwtPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET, options);
  } catch (error) {
    const signatureOnly = error instanceof jwt.JsonWebTokenError
      && !(error instanceof jwt.TokenExpiredError)
      && !(error instanceof jwt.NotBeforeError);
    if (!env.JWT_SECRET_PREVIOUS || !signatureOnly) throw error;
    return jwt.verify(token, env.JWT_SECRET_PREVIOUS, options);
  }
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const payload = verifySigned(token);
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

/**
 * Who an access token was issued to, even past its expiry — or null for one
 * this server did not sign, or for any other kind of token.
 *
 * For the maintenance gate alone (RULES DV14): an expired session is still
 * somebody's, and a tester's must be answered 401 — which the app refreshes
 * — rather than 503, which it would draw as the maintenance screen. Never a
 * session: nothing is served on this.
 */
export function accessTokenSubject(token: string): { sub: string; expired: boolean } | null {
  const live = verifyAccessToken(token);
  if (live) return { sub: live.sub, expired: false };
  try {
    const payload = verifySigned(token, { ...VERIFY, ignoreExpiration: true });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null;
    if ((payload as Record<string, unknown>).kind !== undefined) return null;
    return { sub: payload.sub, expired: true };
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
    const payload = verifySigned(token);
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') return null;
    if ((payload as Record<string, unknown>).kind !== 'step_up') return null;
    return { sub: payload.sub, jti: payload.jti };
  } catch {
    return null;
  }
}

/** How long the choice "new account, or connect it to mine?" stays open (RULES O15). */
export const IDENTITY_LINK_TTL_SECONDS = 15 * 60;

/**
 * A Google or Apple identity the server has just verified and found no
 * account for, held while the member decides what it belongs to.
 */
export interface IdentityLinkClaims {
  provider: 'google' | 'apple';
  /** The provider's `sub`. */
  providerId: string;
  /** The provider-verified email, where it gave one. */
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * The proof that somebody just signed in with that identity (RULES O15).
 * Signed rather than stored, like the step-up token, and with a `kind` so
 * `verifyAccessToken` refuses it as a session.
 *
 * Not bound to the device: the phone's device id is per account and
 * install, so the one it carried while signed out is not the one it has
 * after signing in to the account the identity is meant for. Nor does it
 * need to be — whoever holds it could already link the identity with the
 * provider token it was made from, which is the same proof for longer.
 */
export function signIdentityLinkToken(claims: IdentityLinkClaims): string {
  return jwt.sign(
    { kind: 'identity_link', p: claims.provider, pid: claims.providerId, em: claims.email, nm: claims.name, av: claims.avatarUrl },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: IDENTITY_LINK_TTL_SECONDS, issuer: 'vokve' },
  );
}

export function verifyIdentityLinkToken(token: string): IdentityLinkClaims | null {
  try {
    const payload = verifySigned(token);
    if (typeof payload === 'string') return null;
    const p = payload as Record<string, unknown>;
    if (p.kind !== 'identity_link') return null;
    if (p.p !== 'google' && p.p !== 'apple') return null;
    if (typeof p.pid !== 'string' || !p.pid) return null;
    const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return { provider: p.p, providerId: p.pid, email: text(p.em), name: text(p.nm), avatarUrl: text(p.av) };
  } catch {
    return null;
  }
}

/** How long an operator's panel session lasts: a working day (RULES Z7). */
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;

/**
 * The key admin sessions are signed with, derived from both secrets: a
 * member token can never verify as one (different key), and rotating either
 * the JWT secret or the admin key signs every operator out at once.
 */
function adminSessionKey(): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`vokve-admin-session:${env.ADMIN_API_KEY ?? ''}`).digest('base64url');
}

const ADMIN_VERIFY = { issuer: 'vokve', audience: 'vokve-admin', algorithms: ['HS256'] } satisfies jwt.VerifyOptions;

/**
 * What the panel holds after signing in with the admin key (and, where it
 * is set up, the authenticator code): a twelve-hour proof that both passed,
 * so the key itself never has to sit in a browser cookie.
 */
export function signAdminSession(mfa: boolean): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000;
  const token = jwt.sign({ kind: 'admin_session', mfa, jti: crypto.randomBytes(16).toString('hex') }, adminSessionKey(), {
    algorithm: 'HS256',
    expiresIn: ADMIN_SESSION_TTL_SECONDS,
    issuer: 'vokve',
    audience: 'vokve-admin',
  });
  return { token, expiresAt };
}

export function verifyAdminSession(token: string): { mfa: boolean } | null {
  if (!env.ADMIN_API_KEY) return null;
  try {
    const payload = jwt.verify(token, adminSessionKey(), ADMIN_VERIFY);
    if (typeof payload === 'string' || (payload as Record<string, unknown>).kind !== 'admin_session') return null;
    return { mfa: (payload as Record<string, unknown>).mfa === true };
  } catch {
    return null;
  }
}
