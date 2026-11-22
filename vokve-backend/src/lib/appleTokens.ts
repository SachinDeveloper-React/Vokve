import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { raiseAlert } from './alerts.js';
import { APPLE_ISSUER, audiences } from './appleIdentity.js';
import { ApiError } from './errors.js';
import { logger } from './logger.js';

/**
 * Revoking a member's Sign in with Apple authorisation (RULES O16).
 *
 * App Store Review Guideline 5.1.1(v): an app that offers Sign in with
 * Apple has to revoke the member's tokens when they delete their account.
 * Apple only revokes a token it issued, and this server never kept one —
 * so the deletion asks the member to confirm with Apple once more, and the
 * **authorisation code** that fresh sign-in carries is exchanged here for
 * a refresh token and that token revoked at once. Nothing long-lived is
 * stored, and an account from before any of this needs no migration: the
 * code comes from the confirmation, not from the day they signed up.
 *
 * Both endpoints authenticate with a `client_secret` that is a short-lived
 * ES256 JWT signed with our Sign in with Apple key (`APPLE_KEY_ID`, the
 * `.p8` in `APPLE_PRIVATE_KEY`, `APPLE_TEAM_ID`), naming the client the
 * code was issued to: the bundle id for a native iOS sign-in, the Services
 * ID for Android's web flow. One key serves both — the Services ID is
 * grouped under the primary App ID.
 */

const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
/** Apple accepts up to six months; a few minutes is all one request needs. */
const SECRET_TTL_SECONDS = 5 * 60;

export function isAppleRevocationConfigured(): boolean {
  return Boolean(env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);
}

/** The `.p8` as one env line: quotes stripped, `\n` turned back into newlines. */
function privateKey(): string {
  return (env.APPLE_PRIVATE_KEY ?? '')
    .trim()
    .replace(/^(['"])([\s\S]*)\1$/, '$2')
    .replace(/\\n/g, '\n');
}

/** The `client_secret` Apple's token endpoints take, for one client id. */
export function appleClientSecret(clientId: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  return jwt.sign(
    { iss: env.APPLE_TEAM_ID, iat, exp: iat + SECRET_TTL_SECONDS, aud: APPLE_ISSUER, sub: clientId },
    privateKey(),
    // `iat` is ours (the payload's wins over the library's clock), and Apple
    // requires it — `noTimestamp` would strip it.
    { algorithm: 'ES256', keyid: env.APPLE_KEY_ID },
  );
}

export interface AppleTokens {
  refreshToken: string | null;
  accessToken: string | null;
}

/** The two calls to Apple, swappable so the tests never reach it. */
export interface AppleTokenTransport {
  exchange(form: Record<string, string>): Promise<AppleTokens>;
  revoke(form: Record<string, string>): Promise<void>;
}

/** Apple refused the code itself: used already, or older than its five minutes. */
export class AppleCodeRefused extends Error {}

const httpTransport: AppleTokenTransport = {
  async exchange(form) {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      if (body.error === 'invalid_grant') throw new AppleCodeRefused(String(body.error_description ?? 'invalid_grant'));
      throw new Error(`Apple token endpoint answered ${response.status}: ${String(body.error ?? '')}`);
    }
    return {
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
      accessToken: typeof body.access_token === 'string' ? body.access_token : null,
    };
  },
  async revoke(form) {
    const response = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(`Apple revoke endpoint answered ${response.status}: ${String(body.error ?? '')}`);
    }
  },
};

let transport: AppleTokenTransport = httpTransport;
export function setAppleTokenTransport(next: AppleTokenTransport | null): void {
  transport = next ?? httpTransport;
}

export type RevocationResult = 'revoked' | 'not_configured' | 'failed';

/**
 * Exchanges a fresh authorisation code and revokes what it yields.
 *
 * Only a code Apple refuses is the member's problem — they confirm again,
 * so it throws. Anything else (no key configured, Apple down, a key Apple
 * no longer accepts) must not keep somebody in an account they asked to
 * leave: it is logged, raised to ops, and reported back as not revoked.
 */
export async function revokeAppleAuthorization(input: {
  code: string;
  /** The `aud` of the identity token that came with the code. */
  clientId: string | undefined;
  /** Android's web flow: the code was issued against this return URL. */
  webFlow: boolean;
  userId: string;
}): Promise<RevocationResult> {
  if (!isAppleRevocationConfigured()) {
    logger.error({ userId: input.userId }, 'apple.revoke_not_configured');
    await raiseAlert({
      key: 'apple.revoke_not_configured',
      severity: 'critical',
      title: 'Apple tokens are not being revoked',
      lines: [
        'A member deleted their account or disconnected Apple, and the server has no Sign in with Apple key to revoke their authorisation with.',
        'Set APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (App Store Review Guideline 5.1.1(v)).',
      ],
    }).catch(() => false);
    return 'not_configured';
  }

  const clientId = input.clientId ?? audiences()[0];
  if (!clientId) return 'not_configured';
  const secret = appleClientSecret(clientId);

  let tokens: AppleTokens;
  try {
    tokens = await transport.exchange({
      client_id: clientId,
      client_secret: secret,
      code: input.code,
      grant_type: 'authorization_code',
      ...(input.webFlow && env.APPLE_REDIRECT_URI ? { redirect_uri: env.APPLE_REDIRECT_URI } : {}),
    });
  } catch (error) {
    if (error instanceof AppleCodeRefused) {
      throw new ApiError(422, 'APPLE_CONFIRMATION_EXPIRED', 'Apple did not confirm that in time. Please try again.');
    }
    return failed(error, input.userId, 'exchange');
  }

  const token = tokens.refreshToken ?? tokens.accessToken;
  if (!token) return failed(new Error('Apple returned no token to revoke'), input.userId, 'exchange');
  try {
    await transport.revoke({
      client_id: clientId,
      client_secret: secret,
      token,
      token_type_hint: tokens.refreshToken ? 'refresh_token' : 'access_token',
    });
  } catch (error) {
    return failed(error, input.userId, 'revoke');
  }
  logger.info({ userId: input.userId }, 'apple.revoked');
  return 'revoked';
}

async function failed(error: unknown, userId: string, step: 'exchange' | 'revoke'): Promise<RevocationResult> {
  logger.error({ err: error, userId, step }, 'apple.revoke_failed');
  await raiseAlert({
    key: `apple.revoke_failed:${step}`,
    severity: 'warning',
    title: 'An Apple authorisation could not be revoked',
    lines: [`Step: ${step}. Member: ${userId}.`, error instanceof Error ? error.message : String(error)],
  }).catch(() => false);
  return 'failed';
}
