import { getConfig } from '../../config/remote.js';
import type { AppConfig } from '../../config/defaults.js';
import {
  hydrationDaySchema,
  hydrationReminderPlanSchema,
  hydrationStatsSchema,
  type HydrationDay,
  type HydrationReminderPlan,
  type HydrationStats,
} from '../../contracts/index.js';
import { addDays, localDayOf, type IsoDate } from '../../lib/dates.js';
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

/** One day's water: the drinks not deleted, newest first, and their total (RULES Y2). */
export async function getHydrationDay(userId: string, localDay: IsoDate): Promise<HydrationDay> {
  const [rows, goalMl] = await Promise.all([
    HydrationEntryModel.find({ userId, localDay, deletedAt: null }).sort({ at: -1, _id: -1 }).lean(),
    goalOf(userId),
  ]);
  return hydrationDaySchema.parse({
    date: localDay,
    consumedMl: rows.reduce((sum, row) => sum + row.ml, 0),
    goalMl,
    entries: rows.map(row => ({ id: row.clientId, ml: row.ml, at: row.at.toISOString() })),
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
  try {
    await HydrationEntryModel.create({
      _id: `${userId}:${input.id}`, userId, clientId: input.id, ml: Math.round(input.ml), at, localDay,
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

/** The member's plan, or the default one until they have changed anything. */
export async function getReminderPlan(userId: string): Promise<HydrationReminderPlan> {
  const config = await getConfig();
  const row = await HydrationPlanModel.findById(userId).lean();
  if (!row) return hydrationReminderPlanSchema.parse(defaultPlan(config));
  return hydrationReminderPlanSchema.parse({
    enabled: row.enabled,
    reminders: row.reminders.map(r => ({ id: r.id, time: r.time, slot: r.slot, enabled: r.enabled })),
    sound: row.sound,
    vibration: row.vibration,
    repeatDays: row.repeatDays,
  });
}

/**
 * Replaces the plan whole (RULES Y5): times in clock order, a second
 * (time, block) pair dropped, repeat days unique and in order. Bounded
 * (X9) — a plan of a thousand alarms is not one anybody means.
 */
export async function putReminderPlan(userId: string, plan: HydrationReminderPlan): Promise<HydrationReminderPlan> {
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

  await HydrationPlanModel.updateOne(
    { _id: userId },
    { $set: { enabled: plan.enabled, reminders, sound: plan.sound, vibration: plan.vibration, repeatDays } },
    { upsert: true },
  );
  return getReminderPlan(userId);
}

/** 0 = Monday … 6 = Sunday (RULES Y5). */
function weekdayOf(day: IsoDate): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** How many reminders will actually arrive today (RULES Y6, short of quiet hours). */
function remindersToday(plan: HydrationReminderPlan, today: IsoDate): number {
  if (!plan.enabled || !plan.repeatDays.includes(weekdayOf(today))) return 0;
  return plan.reminders.filter(reminder => reminder.enabled).length;
}
