import { getKV } from '../../db/redis.js';
import { STEP_UP_TTL_SECONDS, verifyStepUpToken } from '../../lib/tokens.js';

/** What a step-up token offered for one action came to (RULES O8). */
export type StepUpVerdict = 'ok' | 'missing' | 'invalid' | 'used';

/**
 * Spends a step-up token on one action: this member's, unexpired, and not
 * spent before — its `jti` is burnt in the KV, so one code passes one
 * action whichever route it is shown to.
 */
export async function spendStepUpToken(userId: string, token: string | undefined): Promise<StepUpVerdict> {
  if (!token) return 'missing';
  const claims = verifyStepUpToken(token);
  if (!claims || claims.sub !== userId) return 'invalid';
  return (await getKV().setIfAbsent(`stepup:${claims.jti}`, STEP_UP_TTL_SECONDS)) ? 'ok' : 'used';
}
