import { createHash } from 'node:crypto';
import { getKV } from '../db/redis.js';

/**
 * Spends a provider's sign-in token, once (security audit 2026-11-27, I-1).
 *
 * Apple's identity token and Facebook's Limited Login token each carry a
 * nonce, but the phone makes the nonce and sends it beside the token, so
 * checking one against the other proves only that both came from the same
 * request — a token copied off a log or a debugging proxy could be sent
 * again, nonce and all, until it expired. Each token is good for one
 * request now: the first use marks its hash until it would have expired
 * anyway, and every later one is refused like any other bad token.
 *
 * Returns false for a token already used.
 */
export async function spendIdentityToken(provider: 'apple' | 'facebook', token: string, exp: number | undefined): Promise<boolean> {
  const secondsLeft = typeof exp === 'number' ? Math.ceil(exp - Date.now() / 1000) : 0;
  // The verifier's own minute of clock slack, plus a margin; never past a day.
  const ttl = Math.min(86_400, Math.max(120, secondsLeft + 120));
  const key = `idtoken-used:${provider}:${createHash('sha256').update(token).digest('hex')}`;
  return getKV().setIfAbsent(key, ttl);
}
