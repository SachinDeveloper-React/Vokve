import { getConfig } from '../../config/remote.js';
import type { AppConfig } from '../../config/defaults.js';
import { stepGoalSchema, type ActivityLevel, type StepGoal } from '../../contracts/index.js';
import { addDays, localDayOf, type IsoDate } from '../../lib/dates.js';
import { UserModel, UserSettingsModel } from '../identity/models.js';
import { bmiBandOf, latestVitals } from '../vitals/service.js';
import { ActivityDailyModel } from './models.js';

type GoalConfig = AppConfig['activity']['goal'];

/** What a suggested goal is worked out from — whatever of it the server has. */
export interface GoalInputs {
  /** Whole years, or null without a date of birth. */
  age: number | null;
  bmi: number | null;
  /** The profile's own word for how active the member is. */
  activityLevel: ActivityLevel;
  /** The steps of each recent day that had any, today left out. */
  recentDays: number[];
}

/** Whole years from a `YYYY-MM-DD` birth date to a local day; null for a date that is not one. */
export function ageOn(dateOfBirth: string, day: IsoDate): number | null {
  const born = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  const on = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!born || !on) return null;
  // `MMDD` against `MMDD`: the birthday has come this year once it is not later.
  const years = Number(on[1]) - Number(born[1]) - (on[2] + on[3] < born[2] + born[3] ? 1 : 0);
  return years >= 0 && years < 130 ? years : null;
}

/**
 * The suggested daily goal (D-55): where the member walks now — the average
 * of their recent days, or the day typical of the activity level in their
 * profile until there are enough of those — one stretch further, but never
 * past where the benefit levels off for their age, plus a little more where
 * BMI says weight is the thing to work on. A member who already walks past
 * that target is suggested what they walk: the goal is to keep it.
 *
 * Rounded to the screen's increment and kept inside the range, so the
 * suggestion is always a value the screen can show and save as it is.
 */
export function recommendStepGoal(inputs: GoalInputs, config: GoalConfig) {
  const { recommend } = config;
  const recentSteps = inputs.recentDays.length >= recommend.minDaysWithSteps;
  const now = recentSteps
    ? inputs.recentDays.reduce((sum, steps) => sum + steps, 0) / inputs.recentDays.length
    : recommend.typicalByLevel[inputs.activityLevel] ?? recommend.typicalByLevel.moderate;

  const age = inputs.age;
  const band = age === null ? undefined : recommend.targetByAge.filter(b => age >= b.from).at(-1);
  const target =
    (band?.steps ?? recommend.defaultTarget) + (inputs.bmi === null ? 0 : recommend.bmiAdjust[bmiBandOf(inputs.bmi)] ?? 0);

  const suggested = now >= target ? now : Math.min(target, now + recommend.stretch);
  const steps = Math.min(config.max, Math.max(config.min, Math.round(suggested / config.increment) * config.increment));
  return { steps, basedOn: { age: inputs.age !== null, bmi: inputs.bmi !== null, recentSteps } };
}

/** `GET /activity/goal`: the member's goal, the suggested one and the range a goal may be set in. */
export async function getStepGoal(userId: string, timezone: string): Promise<StepGoal> {
  const config = (await getConfig()).activity.goal;
  const today = localDayOf(new Date(), timezone);
  const [settings, user, vitals, days] = await Promise.all([
    UserSettingsModel.findById(userId, { dailyStepGoal: 1, stepGoalSetAt: 1 }).lean(),
    UserModel.findById(userId, { dateOfBirth: 1, activityLevel: 1 }).lean(),
    // The newest weight, or the profile's, over the profile's height (RULES V3).
    latestVitals(userId),
    ActivityDailyModel.find(
      { userId, localDay: { $gte: addDays(today, -config.recommend.historyDays), $lt: today }, steps: { $gt: 0 } },
      { steps: 1 },
    ).lean(),
  ]);

  const { steps, basedOn } = recommendStepGoal(
    {
      age: user?.dateOfBirth ? ageOn(user.dateOfBirth, today) : null,
      bmi: vitals.bmi?.value ?? null,
      activityLevel: (user?.activityLevel ?? 'moderate') as ActivityLevel,
      recentDays: days.map(day => day.steps),
    },
    config,
  );

  return stepGoalSchema.parse({
    goal: settings?.dailyStepGoal ?? 10_000,
    recommended: steps,
    basedOn,
    min: config.min,
    max: config.max,
    increment: config.increment,
    chosenAt: settings?.stepGoalSetAt ? new Date(settings.stepGoalSetAt).toISOString() : null,
  });
}
