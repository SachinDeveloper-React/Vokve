import { getConfig } from '../../config/remote.js';
import type { AppConfig } from '../../config/defaults.js';
import {
  hydrationDaySchema,
  hydrationHistorySchema,
  hydrationReminderPlanSchema,
  hydrationStatsSchema,
  reminderSoundSchema,
  type HydrationCaution,
  type HydrationDay,
  type HydrationHistory,
  type HydrationReminderPlan,
  type HydrationStats,
  type ReminderSound,
} from '../../contracts/index.js';
import { addDays, localDayOf, weekdayOf, type IsoDate } from '../../lib/dates.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { UserSettingsModel } from '../identity/models.js';
import { daysBetween } from '../streak/rules.js';
import { HydrationEntryModel, HydrationPlanModel } from './models.js';

/**
 * Water (RULES §Y), on the server: every drink logged, the day's total
 * worked out from them (Y2), the habit figures over the days (Y4), and the
 * reminder plan (Y5). The app keeps a cache of today and the drinks it has
 * not been able to send yet; the totals are always these.
 */

const DAY_MS = 86_400_000;

async function goalOf(userId: string): Promise<number> {
  const settings = await UserSettingsModel.findById(userId, { dailyWaterGoalMl: 1 }).lean();
  return settings?.dailyWaterGoalMl ?? 2_500;
}

/** The limits every day payload carries (RULES Y1b). */
function limitsOf(config: AppConfig) {
  const { minMl, maxMl, maxDailyMl, confirmAboveMl, hourlyMl, hourlyMinutes } = config.hydration;
  return { minMl, maxMl, maxDailyMl, confirmAboveMl, hourlyMl, hourlyMinutes };
}

/**
 * The health note a day has earned, or null (RULES Y1b).
 *
 * The rate is asked first and the total second, because it is the one with
 * medicine behind it: four litres over a day is unusual, four litres in an
 * hour is dangerous, and a member doing the second should not be told about
 * the first. Only one note is ever returned — two at once would read as an
 * app panicking rather than a fact worth knowing.
 */
function cautionFor(
  config: AppConfig,
  drinks: { ml: number; at: Date }[],
  now: Date,
): HydrationCaution | null {
  const { cautionAboveMl, hourlyMl, hourlyMinutes } = config.hydration;
  const since = now.getTime() - hourlyMinutes * 60_000;
  const recent = drinks
    .filter(drink => drink.at.getTime() >= since)
    .reduce((sum, drink) => sum + drink.ml, 0);

  if (recent > hourlyMl) {
    return {
      kind: 'rate',
      title: config.hydration.cautionRateTitle,
      message: config.hydration.cautionRateBody.replaceAll('{amount}', litres(recent)),
    };
  }

  const total = drinks.reduce((sum, drink) => sum + drink.ml, 0);
  if (total > cautionAboveMl) {
    return {
      kind: 'high',
      title: config.hydration.cautionHighTitle,
      message: config.hydration.cautionHighBody.replaceAll('{amount}', litres(total)),
    };
  }
  return null;
}

/** "6.4 L", or "800 ml" below a litre — the way a person says it. */
function litres(ml: number): string {
  return ml >= 1_000 ? `${(ml / 1_000).toFixed(1)} L` : `${ml} ml`;
}

/** One day's water: the drinks not deleted, newest first, and their total (RULES Y2). */
export async function getHydrationDay(
  userId: string,
  localDay: IsoDate,
  now = new Date(),
): Promise<HydrationDay> {
  const [rows, goalMl, config] = await Promise.all([
    HydrationEntryModel.find({ userId, localDay, deletedAt: null }).sort({ at: -1, _id: -1 }).lean(),
    goalOf(userId),
    getConfig(),
  ]);
  return hydrationDaySchema.parse({
    date: localDay,
    consumedMl: rows.reduce((sum, row) => sum + row.ml, 0),
    goalMl,
    entries: rows.map(row => ({ id: row.clientId, ml: row.ml, at: row.at.toISOString() })),
    limits: limitsOf(config),
    caution: cautionFor(config, rows.map(row => ({ ml: row.ml, at: row.at })), now),
  });
}

export async function getHydrationToday(userId: string, timeZone: string, now = new Date()): Promise<HydrationDay> {
  return getHydrationDay(userId, localDayOf(now, timeZone));
}

export interface DrinkInput {
  /** The app's own id for the drink — what makes a retry the same drink. */
  id: string;
  ml: number;
  /** ISO-8601; now when absent. */
  at?: string;
}

/**
 * Logs a drink (RULES Y1). Its day is the local day of `at` in the caller's
 * zone, fixed now (D2). Logging the same id again changes nothing and
 * answers the same day — a retried request is not a second glass.
 */
export async function logDrink(userId: string, input: DrinkInput, timeZone: string, now = new Date()): Promise<HydrationDay> {
  const config = await getConfig();
  const at = input.at ? new Date(input.at) : now;
  if (Number.isNaN(at.getTime())) throw Errors.validation({ at: 'Use an ISO-8601 time.' });
  if (at.getTime() > now.getTime() + 5 * 60_000) throw Errors.validation({ at: 'That time is still to come.' });
  if (now.getTime() - at.getTime() > config.hydration.maxAgeDays * DAY_MS) {
    throw Errors.validation({ at: `Only the last ${config.hydration.maxAgeDays} days can be logged.` });
  }
  const localDay = localDayOf(at, timeZone);
  const ml = Math.round(input.ml);

  /**
   * The day's ceiling (RULES Y1b).
   *
   * Checked here rather than left to the client, because the client is not
   * the only way in and because this is what protects every figure built on
   * top of the log — the average, the goal-hit rate, the streak. A refusal
   * names the ceiling and what is left, so the app can say something true
   * rather than "invalid".
   *
   * Idempotent on purpose: the same drink sent twice is one glass, so the
   * sum below excludes this id. A retry of a drink that already landed must
   * not be refused for pushing the day over a line it is already inside.
   */
  const already = await HydrationEntryModel.aggregate<{ total: number }>([
    { $match: { userId, localDay, deletedAt: null, _id: { $ne: `${userId}:${input.id}` } } },
    { $group: { _id: null, total: { $sum: '$ml' } } },
  ]);
  const dayTotal = (already[0]?.total ?? 0) + ml;
  if (dayTotal > config.hydration.maxDailyMl) {
    const remaining = Math.max(0, config.hydration.maxDailyMl - (already[0]?.total ?? 0));
    throw new ApiError(422, 'HYDRATION_DAILY_LIMIT', remaining > 0
      ? `That would put you over ${litres(config.hydration.maxDailyMl)} today. You can still log ${litres(remaining)}.`
      : `You have already logged ${litres(config.hydration.maxDailyMl)} today, which is as much as Vokve will record.`,
      { maxDailyMl: config.hydration.maxDailyMl, remainingMl: remaining });
  }

  try {
    await HydrationEntryModel.create({
      _id: `${userId}:${input.id}`, userId, clientId: input.id, ml, at, localDay,
    });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    // Already logged: answer with the day it was logged on.
    const existing = await HydrationEntryModel.findById(`${userId}:${input.id}`, { localDay: 1 }).lean();
    return getHydrationDay(userId, existing?.localDay ?? localDay);
  }
  return getHydrationDay(userId, localDay);
}

/** Takes a drink back out of its day. A drink that is not the caller's is not found (RULES X8). */
export async function deleteDrink(userId: string, id: string): Promise<HydrationDay> {
  const row = await HydrationEntryModel.findOneAndUpdate(
    { _id: `${userId}:${id}` },
    { $set: { deletedAt: new Date() } },
    { new: true },
  ).lean();
  if (!row) throw Errors.notFound('That drink');
  return getHydrationDay(userId, row.localDay);
}

/**
 * A span of days and what it came to (RULES Y4) — the history screen's
 * whole answer in one call.
 *
 * The summary is worked out here, not in the app, so the figures cannot
 * disagree with the stats card: both divide by days that had any water, and
 * both read every day against the goal in force now. A day nobody logged is
 * present with a zero and counted out of the average — those are different
 * facts and the rows say which.
 */
export async function getHydrationHistory(userId: string, from: IsoDate, to: IsoDate): Promise<HydrationHistory> {
  if (daysBetween(from, to) < 0) throw Errors.validation({ to: 'Must not be before from.' });
  if (daysBetween(from, to) > 366) throw new ApiError(422, 'RANGE_TOO_LONG', 'Ask for a year at most.');

  const [rows, goalMl] = await Promise.all([
    HydrationEntryModel.aggregate<{ _id: string; total: number; entries: number }>([
      { $match: { userId, deletedAt: null, localDay: { $gte: from, $lte: to } } },
      { $group: { _id: '$localDay', total: { $sum: '$ml' }, entries: { $sum: 1 } } },
    ]),
    goalOf(userId),
  ]);
  const logged = new Map(rows.map(row => [row._id, row]));

  const days: HydrationHistory['days'] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const row = logged.get(day);
    const consumedMl = row?.total ?? 0;
    days.push({ date: day, consumedMl, goalMl, goalMet: consumedMl >= goalMl, entries: row?.entries ?? 0 });
  }

  const withWater = days.filter(day => day.entries > 0);
  const totalMl = withWater.reduce((sum, day) => sum + day.consumedMl, 0);
  const hit = withWater.filter(day => day.goalMet).length;

  // The longest run inside the span, counted over consecutive calendar days;
  // a day with no water breaks it, because it is not a day at the goal.
  let bestStreakDays = 0;
  let run = 0;
  for (const day of days) {
    run = day.goalMet ? run + 1 : 0;
    bestStreakDays = Math.max(bestStreakDays, run);
  }

  const bestDay = withWater.reduce<HydrationHistory['summary']['bestDay']>(
    (best, day) => (best === null || day.consumedMl > best.consumedMl
      ? { date: day.date, consumedMl: day.consumedMl }
      : best),
    null,
  );

  return hydrationHistorySchema.parse({
    from,
    to,
    // Newest first, the way every other history in the app reads.
    days: [...days].reverse(),
    summary: {
      dailyAverageMl: withWater.length > 0 ? Math.round(totalMl / withWater.length) : 0,
      totalMl,
      daysLogged: withWater.length,
      daysInRange: days.length,
      goalHitRatePercent: withWater.length > 0 ? Math.round((hit / withWater.length) * 100) : 0,
      bestStreakDays,
      bestDay,
    },
  });
}

/** Per-day totals from `from` to `to` inclusive, with every day present — a day with no water is 0. */
export async function getHydrationDays(userId: string, from: IsoDate, to: IsoDate): Promise<{ date: string; consumedMl: number; goalMl: number }[]> {
  if (daysBetween(from, to) < 0) throw Errors.validation({ to: 'Must not be before from.' });
  if (daysBetween(from, to) > 366) throw new ApiError(422, 'RANGE_TOO_LONG', 'Ask for a year at most.');
  const [rows, goalMl] = await Promise.all([
    HydrationEntryModel.aggregate<{ _id: string; total: number }>([
      { $match: { userId, deletedAt: null, localDay: { $gte: from, $lte: to } } },
      { $group: { _id: '$localDay', total: { $sum: '$ml' } } },
    ]),
    goalOf(userId),
  ]);
  const totals = new Map(rows.map(row => [row._id, row.total]));
  const days: { date: string; consumedMl: number; goalMl: number }[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push({ date: day, consumedMl: totals.get(day) ?? 0, goalMl });
  }
  return days;
}

/**
 * The habit figures (RULES Y4): the longest run of days at or above the
 * goal; the average over the last 30 days that had any water; and how many
 * of those reached the goal. Measured against today's goal — the one the
 * user is working to.
 */
export async function getHydrationStats(userId: string, timeZone: string, now = new Date()): Promise<HydrationStats> {
  const today = localDayOf(now, timeZone);
  const since = addDays(today, -29);
  const [rows, goalMl, plan] = await Promise.all([
    HydrationEntryModel.aggregate<{ _id: string; total: number }>([
      { $match: { userId, deletedAt: null } },
      { $group: { _id: '$localDay', total: { $sum: '$ml' } } },
      { $sort: { _id: 1 } },
    ]),
    goalOf(userId),
    getReminderPlan(userId),
  ]);

  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const row of rows) {
    if (row.total < goalMl) {
      run = 0;
    } else {
      run = previous !== null && run > 0 && daysBetween(previous, row._id) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    previous = row._id;
  }

  const recent = rows.filter(row => row._id >= since && row._id <= today);
  const total = recent.reduce((sum, row) => sum + row.total, 0);
  const hit = recent.filter(row => row.total >= goalMl).length;

  return hydrationStatsSchema.parse({
    bestStreakDays: best,
    dailyAverageMl: recent.length > 0 ? Math.round(total / recent.length) : 0,
    goalHitRatePercent: recent.length > 0 ? Math.round((hit / recent.length) * 100) : 0,
    reminderCount: remindersToday(plan, today),
  });
}

// ─── Reminders (RULES Y5, Y6) ──────────────────────────────────────────────

function defaultPlan(config: AppConfig): HydrationReminderPlan {
  const plan = config.hydration.defaultPlan;
  return {
    enabled: plan.enabled,
    sound: plan.sound,
    vibration: plan.vibration,
    repeatDays: [...plan.repeatDays],
    reminders: (Object.entries(plan.times) as [HydrationReminderPlan['reminders'][number]['slot'], string[]][])
      .flatMap(([slot, times]) => times.map(time => ({ id: `${slot}-${time}`, time, slot, enabled: true }))),
  };
}

/** Minutes since midnight of an `HH:mm`. */
const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** The sounds a reminder may arrive with (RULES Y5). */
export async function getReminderSounds(): Promise<ReminderSound[]> {
  const config = await getConfig();
  return config.hydration.sounds.map(sound => reminderSoundSchema.parse(sound));
}

/**
 * The stored sound as one of the catalogue's ids.
 *
 * Plans written before the catalogue existed hold the label — `Default` —
 * so a label is matched too, case-insensitively; anything else at all gets
 * the first sound on the list. A plan is never answered with a sound the
 * picker could not show, and never refused for one either: a sound dropped
 * from the catalogue would otherwise lock a member out of their own plan.
 */
function normalizeSound(stored: string, sounds: { id: string; label: string }[]): string {
  const wanted = stored.trim().toLowerCase();
  const match = sounds.find(
    sound => sound.id.toLowerCase() === wanted || sound.label.toLowerCase() === wanted,
  );
  return (match ?? sounds[0]).id;
}

/** The member's plan, or the default one until they have changed anything. */
export async function getReminderPlan(userId: string): Promise<HydrationReminderPlan> {
  const config = await getConfig();
  const row = await HydrationPlanModel.findById(userId).lean();
  if (!row) return hydrationReminderPlanSchema.parse(defaultPlan(config));
  return hydrationReminderPlanSchema.parse({
    enabled: row.enabled,
    reminders: row.reminders.map(r => ({ id: r.id, time: r.time, slot: r.slot, enabled: r.enabled })),
    sound: normalizeSound(row.sound, config.hydration.sounds),
    vibration: row.vibration,
    repeatDays: row.repeatDays,
  });
}

/**
 * Replaces the plan whole (RULES Y5): times in clock order, a second
 * (time, block) pair dropped, repeat days unique and in order. Bounded
 * (X9) — a plan of a thousand alarms is not one anybody means.
 */
export async function putReminderPlan(
  userId: string,
  plan: HydrationReminderPlan,
  timeZone?: string,
): Promise<HydrationReminderPlan> {
  const config = await getConfig();
  const seen = new Set<string>();
  const reminders = plan.reminders
    .filter(reminder => {
      const key = `${reminder.time}|${reminder.slot}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
  if (reminders.length > config.hydration.maxReminders) {
    throw Errors.validation({ reminders: `A plan holds at most ${config.hydration.maxReminders} times.` });
  }
  const repeatDays = [...new Set(plan.repeatDays)].sort((a, b) => a - b);

  const set: Record<string, unknown> = {
    enabled: plan.enabled,
    reminders,
    sound: normalizeSound(plan.sound, config.hydration.sounds),
    vibration: plan.vibration,
    repeatDays,
  };
  // The zone the times were set on, for the minute sweep to find them by (Y6).
  if (timeZone) set.timezone = timeZone;
  await HydrationPlanModel.updateOne({ _id: userId }, { $set: set }, { upsert: true });
  return getReminderPlan(userId);
}


/** How many reminders will actually arrive today (RULES Y6, short of quiet hours). */
function remindersToday(plan: HydrationReminderPlan, today: IsoDate): number {
  if (!plan.enabled || !plan.repeatDays.includes(weekdayOf(today))) return 0;
  return plan.reminders.filter(reminder => reminder.enabled).length;
}
