import { getConfig } from '../../config/remote.js';
import { addDays, localDayOf } from '../../lib/dates.js';
import { dailyActivitySchema, type DailyActivity } from '../../contracts/index.js';
import { hold, type EarnResult } from '../economy/service.js';
import { ActivityDailyModel } from './models.js';

export async function getDay(userId: string, localDay: string): Promise<DailyActivity> {
  const d = await ActivityDailyModel.findById(`${userId}:${localDay}`).lean();
  return toDaily(localDay, d);
}

export async function getWeek(userId: string, timeZone: string): Promise<DailyActivity[]> {
  const today = localDayOf(new Date(), timeZone);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const rows = await ActivityDailyModel.find({ _id: { $in: days.map(d => `${userId}:${d}`) } }).lean();
  const byDay = new Map(rows.map(r => [r.localDay, r]));
  return days.map(d => toDaily(d, byDay.get(d)));
}

/** A day as the client reads it. Calories are the walking and the workouts together. */
export function toDaily(localDay: string, d: Record<string, any> | null | undefined): DailyActivity {
  return dailyActivitySchema.parse({
    date: localDay, steps: d?.steps ?? 0, verifiedSteps: d?.verifiedSteps ?? 0, distanceKm: d?.distanceKm ?? 0,
    activeMinutes: d?.activeMinutes ?? 0,
    caloriesBurned: Math.round(((d?.caloriesBurned ?? 0) + (d?.stepCalories ?? 0)) * 10) / 10,
    workoutsCompleted: d?.workoutsCompleted ?? 0,
    source: d?.source ?? null, verified: d?.verified ?? false,
  });
}

export interface StepCredit extends EarnResult {
  /** When the held coins are due out of escrow; null while held for review, or when nothing was held. */
  releaseAfter: Date | null;
}

/**
 * Step credit for a day, by high-water mark (RULES A4, D-26):
 *   owed = floor(min(verified, tierCap) / unitSteps) × coinsPerUnit − already
 * The coins go to escrow (`hold`), which also consumes the daily ceiling.
 * The rollup calls this once `coins.steps.enabled` is on; the dev endpoint
 * calls it directly. In shadow mode (RULES T9) every user is `normal` here —
 * the tier's cap and window are computed elsewhere, never applied.
 */
export async function creditStepsForDay(userId: string, localDay: string, verifiedSteps: number, trustTier = 'normal'): Promise<StepCredit> {
  const config = await getConfig();
  const tier = config.trust.shadow ? 'normal' : trustTier;
  const tierCap = (config.trust.stepCaps as Record<string, number>)[tier] ?? config.trust.stepCaps.normal;
  const countable = Math.min(verifiedSteps, tierCap);
  const units = Math.floor(countable / config.coins.steps.unitSteps);
  const owedTotal = units * config.coins.steps.coinsPerUnit;

  const doc = await ActivityDailyModel.findById(`${userId}:${localDay}`).lean();
  const alreadyUnits = Math.floor((doc?.stepsCredited ?? 0) / config.coins.steps.unitSteps);
  const owed = Math.round((owedTotal - alreadyUnits * config.coins.steps.coinsPerUnit) * 1000) / 1000;
  if (owed <= 0) return { granted: 0, requested: 0, capped: 0, status: 'already_done', releaseAfter: null };

  const holdHours = (config.trust.holdHours as Record<string, number | null>)[tier];
  const releaseAfter = holdHours === null ? null : new Date(Date.now() + (holdHours ?? 72) * 3_600_000);

  // A fresh reference per tranche keeps each incremental hold idempotent while the day's total grows.
  const result = await hold(
    { userId, source: 'steps', referenceType: 'activity_day', referenceId: `${localDay}:${units}`, amount: owed,
      title: `${countable.toLocaleString('en-IN')} steps walked`, localDay },
    releaseAfter,
  );
  if (result.status === 'held' || result.status === 'cap_reached') {
    await ActivityDailyModel.updateOne(
      { _id: `${userId}:${localDay}` },
      { $setOnInsert: { _id: `${userId}:${localDay}`, userId, localDay }, $set: { stepsCredited: units * config.coins.steps.unitSteps } },
      { upsert: true },
    );
  }
  return { ...result, releaseAfter: result.status === 'held' ? releaseAfter : null };
}
