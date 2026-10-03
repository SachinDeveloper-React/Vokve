import { getConfig } from '../../config/remote.js';
import type { AppConfig } from '../../config/defaults.js';
import {
  healthScoreSchema,
  vitalReadingSchema,
  vitalsLatestSchema,
  type HealthScore,
  type HealthScoreFactor,
  type VitalReading,
  type VitalsLatest,
} from '../../contracts/index.js';
import { addDays, localDayOf } from '../../lib/dates.js';
import { Errors } from '../../lib/errors.js';
import { ActivityDailyModel } from '../activity/models.js';
import { HydrationEntryModel } from '../hydration/models.js';
import { UserModel, UserSettingsModel } from '../identity/models.js';
import { streakFigures } from '../streak/service.js';
import { VitalReadingModel, type EnteredVitalKind } from './models.js';

/**
 * Vitals and the health score (RULES §V): readings logged within sane
 * bounds (V2), BMI derived rather than entered (V1, V3), a weight that keeps
 * the profile's weight current (V4), and one score made of five parts whose
 * workings are returned with it (V8). Every answer carries the wellness line
 * (V9).
 */

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

// ─── Bands (RULES V5–V7) ───────────────────────────────────────────────────

export type Band = 'low' | 'normal' | 'elevated' | 'high';

/** Heart rate (V5): < 60 low · 60–100 normal · 101–120 elevated · > 120 high. */
export function heartBandOf(bpm: number): Band {
  if (bpm < 60) return 'low';
  if (bpm <= 100) return 'normal';
  if (bpm <= 120) return 'elevated';
  return 'high';
}

/** Blood pressure (V6): either half can raise the band. */
export function pressureBandOf(systolic: number, diastolic: number): Band {
  if (systolic >= 130 || diastolic >= 80) return 'high';
  if (systolic < 90 || diastolic < 60) return 'low';
  if (systolic >= 120) return 'elevated';
  return 'normal';
}

export type BmiBand = 'underweight' | 'healthy' | 'overweight' | 'obese';

/** BMI (V7): < 18.5 · 18.5–24.9 · 25–29.9 · ≥ 30. */
export function bmiBandOf(bmi: number): BmiBand {
  if (bmi < 18.5) return 'underweight';
  if (bmi < 25) return 'healthy';
  if (bmi < 30) return 'overweight';
  return 'obese';
}

// ─── Readings ──────────────────────────────────────────────────────────────

type ReadingRow = { clientId: string; kind: string; value: number; secondary?: number | null; recordedAt: Date };

function toReading(row: ReadingRow): VitalReading {
  return vitalReadingSchema.parse({
    id: row.clientId,
    kind: row.kind,
    value: row.value,
    secondary: row.secondary ?? null,
    recordedAt: row.recordedAt.toISOString(),
  });
}

export interface ReadingInput {
  id: string;
  kind: EnteredVitalKind;
  value: number;
  secondary?: number | null;
  /** ISO-8601; now when absent. */
  recordedAt?: string;
}

function checkBounds(config: AppConfig, input: ReadingInput): void {
  const { bounds } = config.health;
  const within = (value: number, range: { min: number; max: number }) => value >= range.min && value <= range.max;
  if (input.kind === 'heart_rate' && !within(input.value, bounds.heart_rate)) {
    throw Errors.validation({ value: `A heart rate is between ${bounds.heart_rate.min} and ${bounds.heart_rate.max} bpm.` });
  }
  if (input.kind === 'weight' && !within(input.value, bounds.weight)) {
    throw Errors.validation({ value: `A weight is between ${bounds.weight.min} and ${bounds.weight.max} kg.` });
  }
  if (input.kind === 'blood_pressure') {
    if (!within(input.value, bounds.systolic)) {
      throw Errors.validation({ value: `The upper number is between ${bounds.systolic.min} and ${bounds.systolic.max}.` });
    }
    if (input.secondary == null || !within(input.secondary, bounds.diastolic)) {
      throw Errors.validation({ secondary: `The lower number is between ${bounds.diastolic.min} and ${bounds.diastolic.max}.` });
    }
  }
}

/**
 * Logs a reading (RULES V1, V2). The same id again is the same reading. A
 * weight that is the newest on record becomes the profile's weight (V4) —
 * one write path for weight, and the BMI follows from it.
 */
export async function logReading(userId: string, input: ReadingInput, now = new Date()): Promise<VitalReading> {
  const config = await getConfig();
  checkBounds(config, input);
  const recordedAt = input.recordedAt ? new Date(input.recordedAt) : now;
  if (Number.isNaN(recordedAt.getTime())) throw Errors.validation({ recordedAt: 'Use an ISO-8601 time.' });
  if (recordedAt.getTime() > now.getTime() + 5 * 60_000) throw Errors.validation({ recordedAt: 'That time is still to come.' });

  const id = `${userId}:${input.id}`;
  try {
    await VitalReadingModel.create({
      _id: id,
      userId,
      clientId: input.id,
      kind: input.kind,
      value: input.value,
      secondary: input.kind === 'blood_pressure' ? input.secondary ?? null : null,
      recordedAt,
    });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }
  const row = await VitalReadingModel.findById(id).lean();

  if (row && row.kind === 'weight' && !row.deletedAt) {
    const newest = await VitalReadingModel.findOne({ userId, kind: 'weight', deletedAt: null }).sort({ recordedAt: -1 }).lean();
    if (newest?._id === row._id) {
      await UserModel.updateOne({ _id: userId }, { $set: { weightKg: row.value } });
    }
  }
  return toReading(row!);
}

/** Takes a reading back out. Another member's reading is not found (RULES X8). */
export async function deleteReading(userId: string, id: string): Promise<void> {
  const row = await VitalReadingModel.findOneAndUpdate(
    { _id: `${userId}:${id}`, deletedAt: null },
    { $set: { deletedAt: new Date() } },
  ).lean();
  if (!row) throw Errors.notFound('That reading');
}

/** The newest readings, of one kind or all, newest first. */
export async function listReadings(userId: string, kind: EnteredVitalKind | undefined, limit: number): Promise<VitalReading[]> {
  const rows = await VitalReadingModel.find({ userId, deletedAt: null, ...(kind ? { kind } : {}) })
    .sort({ recordedAt: -1, _id: -1 })
    .limit(limit)
    .lean();
  return rows.map(toReading);
}

/** BMI to one place, from kilograms and centimetres (RULES V3). */
const bmiOf = (weightKg: number, heightCm: number) => Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;

/** The newest of each kind, and the BMI derived from the newest weight and the profile's height (RULES V3). */
export async function latestVitals(userId: string): Promise<VitalsLatest> {
  const config = await getConfig();
  const newest = (kind: EnteredVitalKind) =>
    VitalReadingModel.findOne({ userId, kind, deletedAt: null }).sort({ recordedAt: -1, _id: -1 }).lean();
  const [heart, pressure, weight, user] = await Promise.all([
    newest('heart_rate'),
    newest('blood_pressure'),
    newest('weight'),
    UserModel.findById(userId, { heightCm: 1, weightKg: 1 }).lean(),
  ]);

  // The newest weight reading; the profile's own weight stands in until there is one.
  const kg = weight?.value ?? user?.weightKg ?? null;
  const bmi =
    kg !== null && user?.heightCm
      ? vitalReadingSchema.parse({
          id: 'bmi',
          kind: 'bmi',
          value: bmiOf(kg, user.heightCm),
          secondary: null,
          recordedAt: (weight?.recordedAt ?? new Date()).toISOString(),
        })
      : null;

  return vitalsLatestSchema.parse({
    heart_rate: heart ? toReading(heart) : null,
    blood_pressure: pressure ? toReading(pressure) : null,
    weight: weight ? toReading(weight) : null,
    bmi,
    disclaimer: config.health.disclaimer,
  });
}

// ─── The health score (RULES V8) ───────────────────────────────────────────

/** The score in a word, at the same thresholds the app's card uses. */
function scoreBand(score: number, outOf: number): string {
  const percent = (score / Math.max(1, outOf)) * 100;
  if (percent >= 80) return 'Good';
  if (percent >= 60) return 'Fair';
  return 'Needs work';
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One number out of 100 for how the member is doing (RULES V8), made of five
 * parts weighted by ⚙ `health.scoreWeights`:
 *  - activity: the last 7 days' average verified steps against the goal;
 *  - hydration: the share of the last 7 days that reached the water goal;
 *  - vitals: full marks for a normal heart rate *and* blood pressure, half
 *    for low or elevated, none for high or missing;
 *  - BMI: full for healthy, half for the bands either side, none otherwise;
 *  - consistency: the current streak against a week.
 * Each part's points and a sentence about it are returned, so the ⓘ can say
 * where the score came from.
 */
export async function healthScore(userId: string, timeZone: string, now = new Date()): Promise<HealthScore> {
  const config = await getConfig();
  const weights = config.health.scoreWeights;
  const today = localDayOf(now, timeZone);
  const since = addDays(today, -6);

  const [settings, steps, water, latest, streak] = await Promise.all([
    UserSettingsModel.findById(userId, { dailyStepGoal: 1, dailyWaterGoalMl: 1 }).lean(),
    ActivityDailyModel.find({ userId, localDay: { $gte: since, $lte: today } }, { verifiedSteps: 1 }).lean(),
    HydrationEntryModel.aggregate<{ _id: string; total: number }>([
      { $match: { userId, deletedAt: null, localDay: { $gte: since, $lte: today } } },
      { $group: { _id: '$localDay', total: { $sum: '$ml' } } },
    ]),
    latestVitals(userId),
    streakFigures(userId, timeZone, now),
  ]);
  const stepGoal = settings?.dailyStepGoal ?? 10_000;
  const waterGoal = settings?.dailyWaterGoalMl ?? 2_500;

  const averageSteps = steps.reduce((sum, row) => sum + (row.verifiedSteps ?? 0), 0) / 7;
  const activity = Math.min(1, averageSteps / stepGoal);

  const waterDays = water.filter(row => row.total >= waterGoal).length;
  const hydration = waterDays / 7;

  let vitals = 0;
  let vitalsDetail = 'Log your heart rate and blood pressure to count this.';
  if (latest.heart_rate && latest.blood_pressure) {
    const heart = heartBandOf(latest.heart_rate.value);
    const pressure = pressureBandOf(latest.blood_pressure.value, latest.blood_pressure.secondary ?? 0);
    vitals = heart === 'high' || pressure === 'high' ? 0 : heart === 'normal' && pressure === 'normal' ? 1 : 0.5;
    vitalsDetail = `Heart rate ${heart}, blood pressure ${pressure}.`;
  }

  let bmi = 0;
  let bmiDetail = 'Add your height and a weight reading to count this.';
  if (latest.bmi) {
    const band = bmiBandOf(latest.bmi.value);
    bmi = band === 'healthy' ? 1 : band === 'obese' ? 0 : 0.5;
    bmiDetail = `BMI ${latest.bmi.value} — ${band}.`;
  }

  const consistency = Math.min(1, streak.current / 7);

  const factors: HealthScoreFactor[] = [
    {
      id: 'activity', label: 'Activity', weight: weights.activity, points: round1(weights.activity * activity),
      detail: `A 7-day average of ${fmt(averageSteps)} verified steps against your ${fmt(stepGoal)} goal.`,
    },
    {
      id: 'hydration', label: 'Hydration', weight: weights.hydration, points: round1(weights.hydration * hydration),
      detail: `Your water goal was reached on ${waterDays} of the last 7 days.`,
    },
    { id: 'vitals', label: 'Vitals', weight: weights.vitals, points: round1(weights.vitals * vitals), detail: vitalsDetail },
    { id: 'bmi', label: 'BMI', weight: weights.bmi, points: round1(weights.bmi * bmi), detail: bmiDetail },
    {
      id: 'consistency', label: 'Consistency', weight: weights.consistency, points: round1(weights.consistency * consistency),
      detail: `A current streak of ${streak.current} ${streak.current === 1 ? 'day' : 'days'}, of the 7 that count in full.`,
    },
  ];
  const outOf = Math.round(Object.values(weights).reduce((sum, w) => sum + w, 0));
  const score = Math.round(factors.reduce((sum, f) => sum + f.points, 0));

  return healthScoreSchema.parse({ score, outOf, band: scoreBand(score, outOf), factors, disclaimer: config.health.disclaimer });
}
