import type { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';
import { logger } from './logger.js';

/**
 * Who Google says somebody is (RULES O12).
 *
 * The phone hands us an ID token and nothing else is believed. Not the
 * email it claims, not the name, not the id — the token is a signed
 * statement from Google and everything we act on is read out of it after
 * the signature, the issuer, the audience and the expiry have been
 * checked. A client that sent us `{ email: 'owner@vokve.app' }` with a
 * token for somebody else would otherwise be signing in as the owner.
 *
 * `google-auth-library` does that checking: it fetches Google's signing
 * keys, caches them, and rejects a token whose `aud` is not ours. The
 * audience is the **web** client id even on Android and iOS — that is
 * what the native SDKs put in the token when they are configured with
 * `webClientId`, and accepting anything else would accept tokens minted
 * for a different app.
 */

/** Google's two issuers; both are legitimate and both appear in the wild. */
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

let client: OAuth2Client | null = null;

export function isGoogleSignInConfigured(): boolean {
  return Boolean(env.GOOGLE_WEB_CLIENT_ID);
}

/** Tests swap the verifier for one that does not reach Google. */
let verifier: ((idToken: string) => Promise<GoogleIdentity>) | null = null;
export function setGoogleVerifier(next: ((idToken: string) => Promise<GoogleIdentity>) | null): void {
  verifier = next;
}

export interface GoogleIdentity {
  /** The `sub` claim: Google's stable id for the account. Never the email. */
  googleId: string;
  email: string;
  /** Whether Google itself has proved the address. */
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

async function oauthClient(): Promise<OAuth2Client> {
  if (client) return client;
  const { OAuth2Client } = await import('google-auth-library');
  client = new OAuth2Client(env.GOOGLE_WEB_CLIENT_ID);
  return client;
}

/**
 * Verifies one ID token and returns only what it proves.
 *
 * Every failure is the same 401 to the caller. A verifier that said
 * "expired" rather than "wrong audience" would be telling whoever is
 * probing it how to get closer, and none of the distinctions help an
 * honest client — the app's answer to all of them is to sign in again.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (verifier) return verifier(idToken);

  if (!isGoogleSignInConfigured()) {
    throw new ApiError(
      503,
      'GOOGLE_SIGN_IN_UNAVAILABLE',
      'Google sign-in is not set up on this server.',
    );
  }

  let payload;
  try {
    const ticket = await (await oauthClient()).verifyIdToken({
      idToken,
      audience: env.GOOGLE_WEB_CLIENT_ID!,
    });
    payload = ticket.getPayload();
  } catch (error) {
    logger.warn({ err: error }, 'auth.google_token_rejected');
    throw rejected();
  }

  if (!payload || !payload.sub || !ISSUERS.includes(payload.iss ?? '')) throw rejected();

  // An unverified address is the one claim worth refusing outright rather
  // than merely not trusting: it is what an account takeover would use —
  // sign up to Google with somebody else's address, never prove it, and
  // arrive here asking to be matched to their account by email.
  if (!payload.email || payload.email_verified !== true) {
    throw new ApiError(
      401,
      'GOOGLE_EMAIL_UNVERIFIED',
      'That Google account has no verified email address.',
    );
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: true,
    name: payload.name ?? null,
    picture: payload.picture ?? null,
  };
}

const rejected = () =>
  new ApiError(401, 'GOOGLE_TOKEN_INVALID', 'That Google sign-in could not be verified.');
