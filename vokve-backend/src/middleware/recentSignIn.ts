import type { Request, RequestHandler } from 'express';
import { ApiError, Errors } from '../lib/errors.js';
import { spendStepUpToken } from '../modules/identity/stepUp.js';

/** How long after a sign-in (or a code) the session counts as freshly proved (RULES O22). */
export const RECENT_SIGN_IN_SECONDS = 10 * 60;

/**
 * Changing how an account is signed in to asks for a session proved a
 * moment ago, or a step-up code (RULES O22).
 *
 * Without it a session token alone — copied off a phone, or a phone picked
 * up unlocked — could connect its holder's own Facebook and keep a way in
 * for good, then take the owner's Google off so that Facebook became what
 * confirms an email change (security audit 2026-11-27, M-3). A sign-in in
 * the last ten minutes is proof enough (it is how "I already have an
 * account" connects a provider straight after signing in); otherwise the
 * app asks for an email code (`POST /auth/step-up`) and sends the token it
 * returns as `X-Vokve-Step-Up`. The check runs before the provider's token
 * is looked at, so a refusal here costs the phone nothing it has to redo.
 */
export async function assertRecentSignIn(req: Request): Promise<void> {
  const provedAt = req.ctx.authenticatedAt;
  if (provedAt && Date.now() - provedAt.getTime() <= RECENT_SIGN_IN_SECONDS * 1000) return;
  const verdict = await spendStepUpToken(req.ctx.userId!, req.header('x-vokve-step-up') ?? undefined);
  if (verdict === 'ok') return;
  if (verdict === 'missing') {
    throw Errors.forbidden('STEP_UP_REQUIRED', 'Confirm it is you first. We will email you a code.');
  }
  throw new ApiError(
    403,
    'STEP_UP_INVALID',
    verdict === 'used' ? 'That confirmation was already used. Please confirm again.' : 'That confirmation has expired. Please confirm again.',
  );
}

export const requireRecentSignIn: RequestHandler = (req, _res, next) => {
  assertRecentSignIn(req).then(() => next(), next);
};
