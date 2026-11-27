import { createHash, createPublicKey, type JsonWebKey, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';
import { logger } from './logger.js';
import { spendIdentityToken } from './idTokenReplay.js';

/**
 * Who Apple says somebody is (RULES O13).
 *
 * The same rule as Google (O12): the phone hands us an identity token and
 * nothing in the request is believed beside it. The token is a JWT Apple
 * signs with one of the keys it publishes at `/auth/keys`; everything we
 * act on is read out of it after the signature, the issuer, the audience
 * and the expiry have been checked.
 *
 * Two things differ from Google and both are deliberate:
 *
 *  - **The audience is a list of two kinds of id.** iOS signs in natively
 *    and Apple addresses the token to the app's bundle id. Android has no
 *    native Apple sign-in; it opens Apple's web flow, and that token is
 *    addressed to the Services ID the flow was opened with. Both are ours
 *    and each is matched exactly.
 *
 *  - **The nonce is checked.** Each sign-in on the phone makes a random
 *    nonce, Apple signs its SHA-256 into the token, and the phone sends us
 *    the raw value beside it. A token lifted out of a log or a crash report
 *    is useless without the raw nonce, which never appears in the token.
 *
 * And one thing Apple does that Google does not: the email may be absent,
 * and when present it may be a private relay address
 * (`…@privaterelay.appleid.com`). Both are handled by the caller; this
 * file only reports what the token proves.
 */

export const APPLE_ISSUER = 'https://appleid.apple.com';
const KEYS_URL = 'https://appleid.apple.com/auth/keys';

/** Apple rotates its keys rarely; a day is plenty and costs one fetch. */
const KEYS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * A token naming a key we do not hold re-fetches the set — that is how a
 * rotation is picked up — but not more than once a minute, or a stream of
 * made-up `kid`s would turn this server into a client hammering Apple.
 */
const REFETCH_FLOOR_MS = 60 * 1000;

export interface AppleIdentity {
  /** The `sub` claim: Apple's stable id for this member, per developer team. */
  appleId: string;
  /** Lower-cased, and only when Apple says it is verified. Null otherwise. */
  email: string | null;
  /** A `…@privaterelay.appleid.com` address that forwards to the real one. */
  isPrivateEmail: boolean;
  /**
   * Which of our client ids the token is addressed to — the bundle id for
   * a native iOS sign-in, the Services ID for Android's web flow. Apple's
   * token endpoints want the same one back (`appleTokens`).
   */
  audience?: string;
}

export function isAppleSignInConfigured(): boolean {
  return audiences().length > 0;
}

/** Every client id an Apple token may legitimately be addressed to. */
export function audiences(): string[] {
  return (env.APPLE_CLIENT_IDS ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

/** Tests swap the verifier for one that does not reach Apple. */
let verifier: ((idToken: string, nonce: string) => Promise<AppleIdentity>) | null = null;
export function setAppleVerifier(
  next: ((idToken: string, nonce: string) => Promise<AppleIdentity>) | null,
): void {
  verifier = next;
}

// ─── Apple's signing keys ──────────────────────────────────────────────────

let keys: Map<string, KeyObject> | null = null;
/** When the set held in `keys` was fetched. */
let fetchedAt = 0;
/** When Apple was last asked, whether or not it answered. */
let attemptedAt = 0;
let inflight: Promise<Map<string, KeyObject>> | null = null;

/** Drops the cached keys, so a test starts from an empty cache. */
export function forgetAppleKeys(): void {
  keys = null;
  fetchedAt = 0;
  attemptedAt = 0;
  inflight = null;
}

async function fetchKeys(): Promise<Map<string, KeyObject>> {
  const response = await fetch(KEYS_URL, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Apple keys answered ${response.status}`);
  const body = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };

  const fetched = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue;
    fetched.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
  }
  return fetched;
}

/**
 * Refreshes the set, keeping the old one if Apple cannot be reached.
 *
 * Keys a day old are still Apple's keys. Refusing every sign-in because
 * the refresh failed would turn a blip at Apple into an outage here; only
 * a server that has never held a key set has nothing to fall back on.
 * One fetch at a time: ten sign-ins arriving together share it.
 */
async function refreshKeys(): Promise<void> {
  attemptedAt = Date.now();
  inflight ??= fetchKeys().finally(() => {
    inflight = null;
  });
  try {
    keys = await inflight;
    fetchedAt = Date.now();
  } catch (error) {
    logger.warn({ err: error }, 'auth.apple_keys_unreachable');
    if (!keys) {
      throw new ApiError(
        503,
        'APPLE_SIGN_IN_UNAVAILABLE',
        'Apple could not be reached. Please try again in a moment.',
      );
    }
  }
}

async function keyFor(kid: string): Promise<KeyObject | null> {
  const stale = Date.now() - fetchedAt > KEYS_MAX_AGE_MS;
  if (!keys || (stale && Date.now() - attemptedAt > REFETCH_FLOOR_MS)) await refreshKeys();

  let key = keys?.get(kid);
  if (!key && Date.now() - attemptedAt > REFETCH_FLOOR_MS) {
    await refreshKeys();
    key = keys?.get(kid);
  }
  return key ?? null;
}

// ─── Verification ──────────────────────────────────────────────────────────

/**
 * Verifies one identity token against the raw nonce the phone made for it,
 * and returns only what it proves.
 *
 * Every failure of the token itself is the same 401, as with Google: a
 * verifier that said "expired" rather than "wrong audience" would be
 * telling whoever is probing it how to get closer, and the app's answer to
 * all of them is the same — sign in again.
 */
export async function verifyAppleIdToken(idToken: string, rawNonce: string): Promise<AppleIdentity> {
  if (verifier) return verifier(idToken, rawNonce);

  if (!isAppleSignInConfigured()) {
    throw new ApiError(503, 'APPLE_SIGN_IN_UNAVAILABLE', 'Apple sign-in is not set up on this server.');
  }

  const decoded = jwt.decode(idToken, { complete: true });
  const kid = decoded?.header.kid;
  if (!decoded || !kid || decoded.header.alg !== 'RS256') throw rejected();

  const key = await keyFor(kid);
  if (!key) {
    logger.warn({ kid }, 'auth.apple_unknown_key');
    throw rejected();
  }

  // Non-empty: `isAppleSignInConfigured` was checked above.
  const [first, ...rest] = audiences();
  let payload: jwt.JwtPayload;
  try {
    const verified = jwt.verify(idToken, key, {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: [first!, ...rest],
      // A phone whose clock is a little out should still sign in; Apple's
      // tokens live ten minutes, so a minute's slack is not a loosening.
      clockTolerance: 60,
    });
    if (typeof verified === 'string') throw new Error('token payload is not an object');
    payload = verified;
  } catch (error) {
    logger.warn({ err: error }, 'auth.apple_token_rejected');
    throw rejected();
  }

  if (typeof payload.sub !== 'string' || !payload.sub) throw rejected();

  // The token carries the SHA-256 of the nonce; the phone sent the nonce.
  // Both native libraries hash it as lower-case hex before asking Apple.
  const expected = createHash('sha256').update(rawNonce).digest('hex');
  if (payload.nonce !== expected) {
    logger.warn('auth.apple_nonce_mismatch');
    throw rejected();
  }
  // Good once: the nonce is the phone's own, so it cannot stop a replay (I-1).
  if (!(await spendIdentityToken('apple', idToken, payload.exp))) {
    logger.warn('auth.apple_token_reused');
    throw rejected();
  }

  // Apple writes these two claims as booleans in some tokens and as the
  // strings "true"/"false" in others; both forms are in the wild.
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  const email =
    emailVerified && typeof payload.email === 'string' && payload.email.includes('@')
      ? payload.email.toLowerCase()
      : null;

  return {
    appleId: payload.sub,
    email,
    isPrivateEmail: payload.is_private_email === true || payload.is_private_email === 'true',
    audience: typeof payload.aud === 'string' ? payload.aud : undefined,
  };
}

const rejected = () =>
  new ApiError(401, 'APPLE_TOKEN_INVALID', 'That Apple sign-in could not be verified.');

// ─── Server-to-server notifications (RULES O17) ─────────────────────────────

export type AppleEventType = 'email-disabled' | 'email-enabled' | 'consent-revoked' | 'account-delete';

export interface AppleServerEvent {
  type: AppleEventType;
  /** The member's `sub`, the same id their sign-in carried. */
  appleId: string;
  /** The relay address an email event is about; null otherwise. */
  email: string | null;
  /** When it happened, as Apple stamps it. */
  at: Date | null;
}

/** Tests swap this for one that does not need Apple's keys. */
let notificationVerifier: ((payload: string) => Promise<AppleServerEvent | null>) | null = null;
export function setAppleNotificationVerifier(next: ((payload: string) => Promise<AppleServerEvent | null>) | null): void {
  notificationVerifier = next;
}

/**
 * Reads one notification Apple posts to `/auth/apple/notifications`.
 *
 * The body is `{ payload: <JWT> }`, signed with the same keys as an
 * identity token and addressed to our primary App ID — so it is verified
 * the same way, minus the nonce, which only a sign-in has. `events` is one
 * event, written as an object by some of Apple's examples and as a JSON
 * string by others; both are read. The account-deletion type is spelled
 * `account-delete` in Apple's documentation and `account-deleted` in the
 * wild, and both mean the same. An event type this server does not know
 * is `null`, not an error: Apple adds types, and refusing one would only
 * make Apple's log noisier.
 */
export async function verifyAppleNotification(payload: string): Promise<AppleServerEvent | null> {
  if (notificationVerifier) return notificationVerifier(payload);
  if (!isAppleSignInConfigured()) {
    throw new ApiError(503, 'APPLE_SIGN_IN_UNAVAILABLE', 'Apple sign-in is not set up on this server.');
  }

  const decoded = jwt.decode(payload, { complete: true });
  const kid = decoded?.header.kid;
  if (!decoded || !kid || decoded.header.alg !== 'RS256') throw notificationRejected();
  const key = await keyFor(kid);
  if (!key) throw notificationRejected();

  const [first, ...rest] = audiences();
  let claims: jwt.JwtPayload;
  try {
    const verified = jwt.verify(payload, key, {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: [first!, ...rest],
      clockTolerance: 60,
    });
    if (typeof verified === 'string') throw new Error('notification payload is not an object');
    claims = verified;
  } catch (error) {
    logger.warn({ err: error }, 'auth.apple_notification_rejected');
    throw notificationRejected();
  }

  let events: unknown = claims.events;
  if (typeof events === 'string') {
    try {
      events = JSON.parse(events);
    } catch {
      throw notificationRejected();
    }
  }
  if (!events || typeof events !== 'object') throw notificationRejected();
  const event = events as Record<string, unknown>;
  if (typeof event.sub !== 'string' || !event.sub) throw notificationRejected();

  const raw = String(event.type ?? '');
  const type: AppleEventType | null =
    raw === 'account-deleted' ? 'account-delete'
      : raw === 'email-disabled' || raw === 'email-enabled' || raw === 'consent-revoked' || raw === 'account-delete' ? raw
        : null;
  if (!type) {
    logger.info({ type: raw }, 'auth.apple_notification_unknown_type');
    return null;
  }
  const seconds = Number(event.event_time);
  return {
    type,
    appleId: event.sub,
    email: typeof event.email === 'string' && event.email.includes('@') ? event.email.toLowerCase() : null,
    // Apple's examples are in seconds; a figure that large is milliseconds.
    at: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds > 1e12 ? seconds : seconds * 1000) : null,
  };
}

const notificationRejected = () =>
  new ApiError(401, 'APPLE_NOTIFICATION_INVALID', 'That notification could not be verified.');
