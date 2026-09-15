import { getConfig } from '../../config/remote.js';
import { addDays, localDayOf } from '../../lib/dates.js';
import { dailyActivitySchema, type DailyActivity } from '../../contracts/index.js';
import { hold } from '../economy/service.js';
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

function toDaily(localDay: string, d: Record<string, any> | null | undefined): DailyActivity {
  return dailyActivitySchema.parse({
    date: localDay, steps: d?.steps ?? 0, verifiedSteps: d?.verifiedSteps ?? 0, distanceKm: d?.distanceKm ?? 0,
    activeMinutes: d?.activeMinutes ?? 0, caloriesBurned: d?.caloriesBurned ?? 0, workoutsCompleted: d?.workoutsCompleted ?? 0,
    source: d?.source ?? null, verified: d?.verified ?? false,
  });
}

/**
 * Step credit for a day, by high-water mark (RULES A4, D-26):
 *   owed = floor(min(verified, tierCap) / unitSteps) × coinsPerUnit − already
 * The coins go to escrow (`hold`), which also consumes the daily ceiling.
 * Phase 2's ingest calls this from the rollup job; until then the dev
 * endpoint below calls it directly.
 */
export async function creditStepsForDay(userId: string, localDay: string, verifiedSteps: number, trustTier = 'normal') {
  const config = await getConfig();
  const tierCap = (config.trust.stepCaps as Record<string, number>)[trustTier] ?? config.trust.stepCaps.normal;
  const countable = Math.min(verifiedSteps, tierCap);
  const units = Math.floor(countable / config.coins.steps.unitSteps);
  const owedTotal = units * config.coins.steps.coinsPerUnit;

  const doc = await ActivityDailyModel.findById(`${userId}:${localDay}`).lean();
  const alreadyUnits = Math.floor((doc?.stepsCredited ?? 0) / config.coins.steps.unitSteps);
  const owed = Math.round((owedTotal - alreadyUnits * config.coins.steps.coinsPerUnit) * 1000) / 1000;
  if (owed <= 0) return { granted: 0, status: 'already_done' as const };

  const holdHours = (config.trust.holdHours as Record<string, number | null>)[config.trust.shadow ? 'normal' : trustTier];
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
  return result;
}
