import { getConfig } from '../../config/remote.js';
import { logger } from '../../lib/logger.js';
import { ActivityDailyModel } from '../activity/models.js';
import { FraudFlagModel } from '../integrity/models.js';
import { CoinHoldModel } from './models.js';
import { release, voidHold } from './service.js';

/** Holds handled per run; the hourly tick takes the rest next time. */
const BATCH = 500;

export interface ReleaseResult {
  released: number;
  voided: number;
  /** In shadow mode: holds that would have been voided, released instead. */
  wouldVoid: number;
}

/**
 * Why a step hold should not be paid, or null. A day is judged again
 * whenever a later snapshot arrives, so by the end of the window it may be
 * unverified, or carry a hard flag that first appeared after the coins were
 * held — on another of the user's phones, say. A flag that was already
 * there when the day was paid for was already weighed.
 */
async function voidReason(hold: { userId: string; source: string; referenceType: string; referenceId: string; createdAt?: Date }): Promise<string | null> {
  if (hold.source !== 'steps' || hold.referenceType !== 'activity_day') return null;
  const localDay = hold.referenceId.split(':')[0];
  const day = await ActivityDailyModel.findById(`${hold.userId}:${localDay}`, { verified: 1 }).lean();
  if (day && day.verified === false) return 'day_unverified';
  const flagged = await FraudFlagModel.exists({
    userId: hold.userId,
    localDay,
    severity: 'hard',
    status: { $ne: 'dismissed' },
    ...(hold.createdAt ? { createdAt: { $gt: hold.createdAt } } : {}),
  });
  return flagged ? 'new_flag' : null;
}

/**
 * The `releaseHolds` job (RULES E15): every hold whose window has passed is
 * paid out, unless the day has since been found wanting, in which case it is
 * voided with the reason. A hold with no `releaseAfter` waits for a person
 * (the restricted tier's manual review) and is never touched here.
 *
 * In shadow mode (T9) nothing is voided on a flag — the flags are not yet
 * trusted to cost anyone anything — but each one that would have been is
 * logged, so the thresholds can be judged on what they would have done.
 */
export async function releaseDueHolds(now = new Date()): Promise<ReleaseResult> {
  const config = await getConfig();
  const result: ReleaseResult = { released: 0, voided: 0, wouldVoid: 0 };
  const due = await CoinHoldModel.find({ status: 'held', releaseAfter: { $ne: null, $lte: now } })
    .sort({ releaseAfter: 1 })
    .limit(BATCH)
    .lean();

  for (const hold of due) {
    try {
      const reason = await voidReason(hold);
      if (reason && !config.trust.shadow) {
        if ((await voidHold(hold._id, reason)) === 'voided') result.voided += 1;
        continue;
      }
      if (reason) {
        result.wouldVoid += 1;
        logger.info({ holdId: hold._id, userId: hold.userId, reason }, 'holds.would_void');
      }
      if ((await release(hold._id)) === 'released') result.released += 1;
    } catch (err) {
      // One hold that cannot move must not stop the rest; it is due again next hour.
      logger.error({ err, holdId: hold._id }, 'holds.release_failed');
    }
  }
  return result;
}
