import crypto, { createPublicKey, type JsonWebKey, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';
import { logger } from './logger.js';

/**
 * Who Facebook says somebody is (RULES O18) — two proofs, one per platform.
 *
 * **iPhone: Limited Login.** iOS asks Facebook in "limited" mode, which
 * needs no App Tracking Transparency prompt and gives back an OIDC
 * **authentication token**: a JWT Facebook signs (RS256, keys at
 * `limited.facebook.com`), addressed to our App ID, carrying the nonce the
 * SDK made for that login. That is checked here like Apple's token — no
 * call to Facebook beyond its public keys. Its `sub` is the same
 * app-scoped id `/me` gives on Android, so one person is one account on
 * both phones.
 *
 * **Android: the classic access token.** Facebook Login on Android hands the phone an **access token**, not a
 * signed statement like Google's or Apple's ID token, so there is no
 * signature to check here. What there is instead is Facebook itself:
 *
 *  1. `debug_token`, asked with our **app** token (`APP_ID|APP_SECRET`),
 *     says whether the token is valid, which app it was issued to and
 *     which user it is for. A token issued to some other app — a game the
 *     member also logged in to — is refused here; without this check,
 *     any app that ever got a member's token could sign in as them.
 *  2. `/me`, asked with the member's token and an `appsecret_proof` (the
 *     token HMAC'd with our secret, so a token lifted off the phone is no
 *     use to anyone without the secret), says their id, name and email.
 *     The id must be the one `debug_token` named.
 *
 * The id is Facebook's **app-scoped** user id: stable for this app, and
 * different from the one any other app sees for the same person.
 *
 * The email is returned as Facebook gives it and is **not** treated as
 * proved: Facebook does not say whether it has confirmed the address,
 * so it never matches an existing account, and a new account made from
 * it starts with the email unverified (O18).
 *
 * Unversioned Graph calls use the app's default API version (App settings
 * → Advanced), which Meta moves forward as old versions retire; the three
 * fields read here have not changed in any version.
 */

const GRAPH = 'https://graph.facebook.com';

/** What the phone sends: Android's access token, or iOS's Limited Login token and its nonce. */
export type FacebookProof = { accessToken: string } | { authenticationToken: string; nonce: string };

export interface FacebookIdentity {
  /** The app-scoped user id. Never the email. */
  facebookId: string;
  /** Lower-cased; null when the member has none or did not share it. Not proved. */
  email: string | null;
  name: string | null;
}

export function isFacebookSignInConfigured(): boolean {
  return Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET);
}

/** Tests swap the verifier for one that does not reach Facebook. */
let verifier: ((proof: FacebookProof) => Promise<FacebookIdentity>) | null = null;
export function setFacebookVerifier(next: ((proof: FacebookProof) => Promise<FacebookIdentity>) | null): void {
  verifier = next;
}

/** Either proof, checked the way its platform's needs. */
export async function verifyFacebookProof(proof: FacebookProof): Promise<FacebookIdentity> {
  if (verifier) return verifier(proof);
  return 'accessToken' in proof
    ? verifyFacebookAccessToken(proof.accessToken)
    : verifyFacebookLimitedToken(proof.authenticationToken, proof.nonce);
}

/** Tests replace the network; everything else is the real verifier. */
let fetcher: typeof fetch = (...args) => fetch(...args);
export function setFacebookFetch(next: typeof fetch | null): void {
  fetcher = next ?? ((...args) => fetch(...args));
}

/**
 * Verifies one access token and returns only what Facebook says about it.
 *
 * A token Facebook refuses, or one for another app, is the same 401 to the
 * caller — the app's answer to every one of them is to log in again. A
 * Facebook that did not answer is a 503, because that one is worth
 * retrying and the member did nothing wrong.
 */
export async function verifyFacebookAccessToken(accessToken: string): Promise<FacebookIdentity> {
  const appId = env.FACEBOOK_APP_ID;
  const secret = env.FACEBOOK_APP_SECRET;
  if (!appId || !secret) {
    throw new ApiError(503, 'FACEBOOK_SIGN_IN_UNAVAILABLE', 'Facebook sign-in is not set up on this server.');
  }

  const debug = await graph('/debug_token', { input_token: accessToken, access_token: `${appId}|${secret}` }, 'debug');
  const data = (debug as { data?: Record<string, unknown> }).data;
  if (
    !data ||
    data.is_valid !== true ||
    String(data.app_id ?? '') !== appId ||
    (data.type !== undefined && data.type !== 'USER') ||
    typeof data.user_id !== 'string' ||
    !data.user_id
  ) {
    logger.warn({ appMatches: String(data?.app_id ?? '') === appId, valid: data?.is_valid === true, type: data?.type }, 'auth.facebook_token_rejected');
    throw rejected();
  }

  const proof = crypto.createHmac('sha256', secret).update(accessToken).digest('hex');
  const me = (await graph('/me', { fields: 'id,name,email', access_token: accessToken, appsecret_proof: proof }, 'me')) as Record<string, unknown>;
  if (typeof me.id !== 'string' || me.id !== data.user_id) {
    logger.warn('auth.facebook_user_mismatch');
    throw rejected();
  }

  const email = typeof me.email === 'string' && me.email.includes('@') ? me.email.trim().toLowerCase() : null;
  const name = typeof me.name === 'string' && me.name.trim().length >= 2 ? me.name.trim().slice(0, 60) : null;
  return { facebookId: me.id, email, name };
}

/**
 * One Graph call. The URL carries the app secret (`debug_token` is asked
 * that way) and the member's token, so it is never logged — only which
 * call it was and what Facebook said went wrong.
 */
async function graph(path: string, query: Record<string, string>, label: 'debug' | 'me'): Promise<unknown> {
  const url = `${GRAPH}${path}?${new URLSearchParams(query).toString()}`;
  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    logger.warn({ call: label, err: (error as Error)?.name }, 'auth.facebook_unreachable');
    throw unreachable();
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status >= 500 || body === null || typeof body !== 'object') {
    logger.warn({ call: label, status: response.status }, 'auth.facebook_unreachable');
    throw unreachable();
  }

  if (!response.ok) {
    const error = (body as { error?: { code?: number; type?: string; message?: string } }).error;
    // `debug_token` answering 190 ("Invalid OAuth access token signature")
    // is *our* app token being refused — a wrong or rotated
    // FACEBOOK_APP_SECRET — and is a server that cannot sign anybody in,
    // so it is loud. A member token Facebook cannot read at all comes back
    // as #100 ("You must provide an app access token…", misleadingly, with
    // a good app token: checked against the live API 2026-11-26), and an
    // expired one as `is_valid: false`; both are just a refused sign-in.
    if (label === 'debug' && error?.code === 190) {
      logger.error({ status: response.status, code: error?.code, type: error?.type }, 'auth.facebook_app_token_refused');
      throw new ApiError(503, 'FACEBOOK_SIGN_IN_UNAVAILABLE', 'Facebook sign-in is not working on this server right now.');
    }
    logger.warn({ call: label, status: response.status, code: error?.code }, 'auth.facebook_token_rejected');
    throw rejected();
  }

  return body;
}

const rejected = () =>
  new ApiError(401, 'FACEBOOK_TOKEN_INVALID', 'That Facebook sign-in could not be verified.');

const unreachable = () =>
  new ApiError(503, 'FACEBOOK_UNREACHABLE', 'Facebook did not answer. Please try again in a moment.');

// ─── iPhone: Limited Login (RULES O18) ─────────────────────────────────────

/** Facebook's Limited Login signing keys; the OIDC config names the same set at www.facebook.com. */
const KEYS_URL = 'https://limited.facebook.com/.well-known/oauth/openid/jwks/';
/** `issuer` in Facebook's OpenID configuration (checked 2026-11-26); the limited host is accepted too. */
const ISSUERS: [string, ...string[]] = ['https://www.facebook.com', 'https://limited.facebook.com'];
const KEYS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** An unknown key id refetches at most this often, so garbage tokens cannot hammer Facebook. */
const REFETCH_FLOOR_MS = 60 * 1000;

let keys: Map<string, KeyObject> | null = null;
let fetchedAt = 0;
let attemptedAt = 0;
let inflight: Promise<Map<string, KeyObject>> | null = null;

/** Drops the cached keys, so a test starts from an empty cache. */
export function forgetFacebookKeys(): void {
  keys = null;
  fetchedAt = 0;
  attemptedAt = 0;
  inflight = null;
}

async function fetchKeys(): Promise<Map<string, KeyObject>> {
  const response = await fetcher(KEYS_URL, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Facebook keys answered ${response.status}`);
  const body = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const fetched = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue;
    fetched.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
  }
  return fetched;
}

/** Keeps the old set if Facebook cannot be reached: day-old keys are still Facebook's keys. */
async function refreshKeys(): Promise<void> {
  attemptedAt = Date.now();
  inflight ??= fetchKeys().finally(() => {
    inflight = null;
  });
  try {
    keys = await inflight;
    fetchedAt = Date.now();
  } catch (error) {
    logger.warn({ err: (error as Error)?.message }, 'auth.facebook_keys_unreachable');
    if (!keys) throw unreachable();
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

/**
 * Verifies one Limited Login token: Facebook's signature, the issuer, our
 * App ID as the audience, the expiry, and the nonce the iOS SDK made for
 * this login (sent beside it, and the same value as the token's claim).
 */
export async function verifyFacebookLimitedToken(authenticationToken: string, nonce: string): Promise<FacebookIdentity> {
  const appId = env.FACEBOOK_APP_ID;
  if (!appId) {
    throw new ApiError(503, 'FACEBOOK_SIGN_IN_UNAVAILABLE', 'Facebook sign-in is not set up on this server.');
  }

  const decoded = jwt.decode(authenticationToken, { complete: true });
  const kid = decoded?.header.kid;
  if (!decoded || !kid || decoded.header.alg !== 'RS256') throw rejected();

  const key = await keyFor(kid);
  if (!key) {
    logger.warn({ kid }, 'auth.facebook_unknown_key');
    throw rejected();
  }

  let payload: jwt.JwtPayload;
  try {
    const verified = jwt.verify(authenticationToken, key, {
      algorithms: ['RS256'],
      issuer: ISSUERS,
      audience: appId,
      clockTolerance: 60,
    });
    if (typeof verified === 'string') throw new Error('token payload is not an object');
    payload = verified;
  } catch (error) {
    logger.warn({ err: (error as Error)?.message }, 'auth.facebook_limited_token_rejected');
    throw rejected();
  }

  if (typeof payload.sub !== 'string' || !payload.sub) throw rejected();
  if (typeof payload.nonce !== 'string' || payload.nonce !== nonce) {
    logger.warn('auth.facebook_nonce_mismatch');
    throw rejected();
  }

  const email = typeof payload.email === 'string' && payload.email.includes('@') ? payload.email.trim().toLowerCase() : null;
  const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
  return { facebookId: payload.sub, email, name: rawName.length >= 2 ? rawName.slice(0, 60) : null };
}
