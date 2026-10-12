import { getConfig } from '../../config/remote.js';
import type { AppConfig } from '../../config/defaults.js';
import {
  streakDayDetailSchema,
  streakDayEventsPageSchema,
  streakHistoryPageSchema,
  streakRestoreResultSchema,
  streakSummarySchema,
  type StreakDayDetail,
  type StreakDayEvent,
  type StreakDayEventsPage,
  type StreakDayMetric,
  type StreakDayStatus,
  type StreakHistoryPage,
  type StreakHistoryStatus,
  type StreakMilestone,
  type StreakRestoreResult,
  type StreakRun,
  type StreakSummary,
} from '../../contracts/index.js';
import { withTransaction } from '../../db/mongo.js';
import { addDays, localDayOf, localHourOf, localMidnightUtc, type IsoDate } from '../../lib/dates.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { toCoins } from '../../lib/coins.js';
import { ActivityDailyModel } from '../activity/models.js';
import { evaluateAchievements } from '../challenges/service.js';
import { CoinBalanceModel, CoinLedgerModel, type CoinSource } from '../economy/models.js';
import { credit, debitInSession } from '../economy/service.js';
import { HydrationEntryModel } from '../hydration/models.js';
import { UserModel, UserSettingsModel } from '../identity/models.js';
import { notify } from '../notifications/service.js';
import { FoodEntryModel } from '../nutrition/models.js';
import { WorkoutModel } from '../training/models.js';
import { StreakDayModel, StreakStateModel, type StreakDaySource } from './models.js';
import { currentRunOf, currentStreakOf, daysBetween, longestStreakOf, restoreGapOf, runAt } from './rules.js';

/**
 * The streak (RULES §S), on the server: which days count, the figures drawn
 * from them, and the two tools — a freeze and a paid restore. Ported from
 * the client's `streakStore`, whose golden tests were the acceptance suite;
 * the app now only shows what this says.
 */

const MILESTONE_REFERENCE = 'streak_milestone';
const RESTORE_REFERENCE = 'streak_restore';

export { currentRunOf, currentStreakOf, daysBetween, longestStreakOf, restoreGapOf, runAt } from './rules.js';

/** What makes a day count, in a sentence, from the rules in force. */
export function howToEarn(config: AppConfig, dailyStepGoal: number): string {
  const { workout, stepGoal } = config.streak.earnedBy;
  const steps = `${dailyStepGoal.toLocaleString('en-IN')} steps`;
  if (workout && stepGoal) return `Finish a workout or walk ${steps} in a day.`;
  if (stepGoal) return `Walk ${steps} in a day.`;
  if (workout) return 'Finish a workout in a day.';
  return 'Only a freeze or a restore keeps a day right now.';
}

// ─── Reads ─────────────────────────────────────────────────────────────────

interface Days {
  earned: IsoDate[];
  protected: IsoDate[];
  all: Set<IsoDate>;
}

async function daysOf(userId: string): Promise<Days> {
  const rows = await StreakDayModel.find({ userId }, { localDay: 1, kind: 1 }).lean();
  const earned: IsoDate[] = [];
  const protectedDays: IsoDate[] = [];
  for (const row of rows) (row.kind === 'earned' ? earned : protectedDays).push(row.localDay);
  earned.sort();
  protectedDays.sort();
  return { earned, protected: protectedDays, all: new Set([...earned, ...protectedDays]) };
}

/** The user's counters, made with the sign-up freezes the first time they are needed (RULES S5). */
async function stateOf(userId: string, config: AppConfig) {
  return StreakStateModel.findOneAndUpdate(
    { _id: userId },
    { $setOnInsert: { _id: userId, freezesAvailable: config.streak.freezes.initial, freezeGrantKeys: [] } },
    { upsert: true, new: true },
  ).lean();
}

async function dailyStepGoalOf(userId: string): Promise<number> {
  const settings = await UserSettingsModel.findById(userId, { dailyStepGoal: 1 }).lean();
  return settings?.dailyStepGoal ?? 10_000;
}

async function paidMilestonesOf(userId: string): Promise<Set<string>> {
  const rows = await CoinLedgerModel.find(
    { userId, source: 'streak', referenceType: MILESTONE_REFERENCE },
    { referenceId: 1 },
  ).lean();
  return new Set(rows.map(r => r.referenceId));
}

/** `GET /streak`: every figure the streak screen shows. */
export async function getStreak(userId: string, timeZone: string, now = new Date()): Promise<StreakSummary> {
  const config = await getConfig();
  const [state, days, paid, goal] = await Promise.all([
    stateOf(userId, config),
    daysOf(userId),
    paidMilestonesOf(userId),
    dailyStepGoalOf(userId),
  ]);
  const today = localDayOf(now, timeZone);
  const current = currentStreakOf(days.all, today);
  const longest = longestStreakOf(days.all);
  const gap = restoreGapOf(days.all, today, config.streak.restoreWindowDays);

  const milestones: StreakMilestone[] = config.coins.streakMilestones.map(m => ({
    days: m.days,
    coins: m.coins,
    achieved: (longest?.length ?? 0) >= m.days,
    paid: paid.has(String(m.days)),
  }));

  return streakSummarySchema.parse({
    today,
    currentStreak: current,
    longestStreak: longest,
    completedDays: days.earned,
    protectedDays: days.protected,
    freezesAvailable: state?.freezesAvailable ?? 0,
    maxFreezes: config.streak.freezes.maxHeld,
    todayCovered: days.all.has(today),
    todayFrozen: days.protected.includes(today),
    canRestore: gap.length > 0,
    restoreGap: gap,
    restoreCostCoins: config.streak.restoreCost,
    restoreWindowDays: config.streak.restoreWindowDays,
    milestones,
    nextMilestone: milestones.find(m => m.days > current) ?? null,
    howToEarn: howToEarn(config, goal),
  });
}

/** The current and longest streak alone — what the profile card shows beside other figures. */
export async function streakFigures(userId: string, timeZone: string, now = new Date()): Promise<{ current: number; longest: number }> {
  const days = await daysOf(userId);
  return {
    current: currentStreakOf(days.all, localDayOf(now, timeZone)),
    longest: longestStreakOf(days.all)?.length ?? 0,
  };
}

// ─── The record (RULES S1) ─────────────────────────────────────────────────

/** How many days a page of the history carries by default. */
const HISTORY_PAGE = 30;
const HISTORY_MAX_PAGE = 100;

const fmtSteps = (steps: number) => Math.round(steps).toLocaleString('en-IN');

/**
 * How a day went and what is worth saying about it, in the server's words.
 *
 * Shared by the record (`GET /streak/history`) and the day's own screen
 * (`GET /streak/day`): a row and the page it opens must never word the same
 * day differently, and what a restore cost is the ledger's to say in both.
 */
function wordDay(
  kind: string | null,
  steps: number,
  restore: { cost: number; span: number },
): { status: StreakHistoryStatus; detail: string } {
  if (kind === null) {
    return {
      status: 'missed',
      detail: steps > 0 ? `${fmtSteps(steps)} steps — short of your goal` : 'No activity',
    };
  }
  if (kind === 'frozen') return { status: 'frozen', detail: 'Freeze used' };
  if (kind === 'restored') {
    const { cost, span } = restore;
    return {
      status: 'restored',
      detail:
        cost === 0
          ? 'Restored'
          : span > 1
            ? `Restored (${fmtSteps(cost)} coins for ${span} days)`
            : `Restored (${fmtSteps(cost)} coins)`,
    };
  }
  return {
    status: 'completed',
    detail: steps > 0 ? `${fmtSteps(steps)} steps` : 'Workout completed',
  };
}

/**
 * `GET /streak/history?cursor=&limit=`: the streak's record, newest first,
 * back to the first day that ever counted.
 *
 * Missed days are filled in rather than left out. A day that did not count
 * has no row — that is what "did not count" means — but it is the day the
 * member came to look at, so the walk is over the calendar rather than over
 * the table, and a day with no row becomes a missed one.
 *
 * "Day 18" is the day's place in its own run, not its place in the list: a
 * history scrolled past a break has to start counting again at 1, which it
 * can only do by walking the whole record forward from the beginning. That
 * is one read of ids per request, bounded by the age of the account.
 */
export async function getStreakHistory(
  userId: string,
  timeZone: string,
  options: { cursor?: IsoDate; limit?: number } = {},
  now = new Date(),
): Promise<StreakHistoryPage> {
  const limit = Math.min(HISTORY_MAX_PAGE, Math.max(1, options.limit ?? HISTORY_PAGE));
  const today = localDayOf(now, timeZone);

  const rows = await StreakDayModel.find({ userId }).sort({ localDay: 1 }).lean();
  if (rows.length === 0) {
    return streakHistoryPageSchema.parse({ data: [], nextCursor: null, total: 0 });
  }

  const first = rows[0].localDay;
  const byDay = new Map(rows.map(row => [row.localDay, row]));

  // Each day's place in its own run, counted forward from the first day that
  // ever counted. A day with no row breaks the run and resets the count.
  const runIndex = new Map<IsoDate, number>();
  let run = 0;
  for (let day = first; day <= today; day = addDays(day, 1)) {
    run = byDay.has(day) ? run + 1 : 0;
    if (run > 0) runIndex.set(day, run);
  }

  // The page: `limit` days ending at the cursor, or at today on the first one.
  const end = options.cursor ? addDays(options.cursor, -1) : today;
  const dates: IsoDate[] = [];
  for (let day = end; day >= first && dates.length < limit; day = addDays(day, -1)) {
    dates.push(day);
  }
  if (dates.length === 0) {
    return streakHistoryPageSchema.parse({
      data: [],
      nextCursor: null,
      total: daysBetween(first, today) + 1,
    });
  }

  // What each day is worth saying: the steps walked, and what a restore cost.
  const restoreIds = [
    ...new Set(
      dates
        .map(date => byDay.get(date))
        .filter(row => row?.kind === 'restored' && row.referenceId)
        .map(row => row!.referenceId as string),
    ),
  ];
  const [activity, ledger] = await Promise.all([
    ActivityDailyModel.find({ userId, localDay: { $in: dates } }, { localDay: 1, verifiedSteps: 1 }).lean(),
    restoreIds.length > 0
      ? CoinLedgerModel.find({ _id: { $in: restoreIds } }, { amountMc: 1 }).lean()
      : Promise.resolve([] as { _id: string; amountMc: number }[]),
  ]);
  const stepsOn = new Map(activity.map(row => [row.localDay, Math.round(row.verifiedSteps ?? 0)]));
  const restoreCost = new Map(ledger.map(row => [row._id, Math.abs(toCoins(row.amountMc))]));
  // One restore can bridge several days off one debit, so the figure on a row
  // has to say which it is or every day would look like it cost the lot.
  const restoreSpan = new Map<string, number>();
  for (const row of rows) {
    if (row.kind === 'restored' && row.referenceId) {
      restoreSpan.set(row.referenceId, (restoreSpan.get(row.referenceId) ?? 0) + 1);
    }
  }

  const data = dates.map(date => {
    const row = byDay.get(date);
    const steps = stepsOn.get(date) ?? 0;
    const worded = wordDay(row?.kind ?? null, steps, {
      cost: restoreCost.get(row?.referenceId ?? '') ?? 0,
      span: restoreSpan.get(row?.referenceId ?? '') ?? 1,
    });
    return { date, day: row ? runIndex.get(date) ?? null : null, ...worded, steps };
  });

  const oldest = dates[dates.length - 1];
  return streakHistoryPageSchema.parse({
    data,
    nextCursor: oldest > first ? oldest : null,
    total: daysBetween(first, today) + 1,
  });
}

// ─── One day (RULES S11) ───────────────────────────────────────────────────

/** How many rows a page of the day's log carries by default. */
const DAY_EVENTS_PAGE = 20;
const DAY_EVENTS_MAX_PAGE = 100;

const fmtNumber = (value: number) => Math.round(value).toLocaleString('en-IN');

/** Coins, to three decimals — a step credit can be 0.095 (D-27). */
const roundCoins = (coins: number) => Math.round(coins * 1000) / 1000;

/** What a ledger row is called on a day's log. */
const COIN_SOURCE_WORDS: Record<CoinSource, string> = {
  steps: 'Steps',
  workout: 'Workout',
  streak: 'Streak',
  challenge: 'Challenge',
  referral: 'Referral',
  purchase: 'Order',
  refund: 'Refund',
};

/**
 * The ledger rows written during one local day.
 *
 * By `createdAt` inside the day's own midnights rather than by a stored day:
 * the ledger has no `localDay` of its own (the daily cap is what keeps that),
 * and coins are earned when they are written.
 */
async function ledgerOnDay(userId: string, date: IsoDate, timeZone: string) {
  return CoinLedgerModel.find(
    {
      userId,
      createdAt: {
        $gte: localMidnightUtc(date, timeZone),
        $lt: localMidnightUtc(addDays(date, 1), timeZone),
      },
    },
    { amountMc: 1, title: 1, source: 1, createdAt: 1 },
  )
    .sort({ createdAt: -1 })
    .lean();
}

/** What a restored day cost, and over how many days that one debit was spread. */
async function restoreCostOf(userId: string, referenceId: string | null | undefined) {
  if (!referenceId) return { cost: 0, span: 1 };
  const [debit, span] = await Promise.all([
    CoinLedgerModel.findById(referenceId, { amountMc: 1 }).lean(),
    StreakDayModel.countDocuments({ userId, kind: 'restored', referenceId }),
  ]);
  return { cost: debit ? Math.abs(toCoins(debit.amountMc)) : 0, span: Math.max(1, span) };
}

/**
 * `GET /streak/day?date=`: one day of the streak in full — how it went, the
 * figures behind it, and the days either side.
 *
 * The same read as the record's row, with the day's own numbers added, and
 * worded by the same `wordDay`: tapping a cell of the calendar must not
 * change the story the list told about it.
 *
 * Nothing is recomputed (RULES D2). Whether the day counted is the
 * `streak_days` row written when the day was decided, not a fresh judgement
 * under today's goal — a member who raised their goal last week still sees
 * the days they earned under the old one.
 */
export async function getStreakDay(
  userId: string,
  timeZone: string,
  date: IsoDate,
  now = new Date(),
): Promise<StreakDayDetail> {
  const config = await getConfig();
  const today = localDayOf(now, timeZone);

  const [row, activity, settings, days, oldestActivity, water, food, ledger] = await Promise.all([
    StreakDayModel.findById(`${userId}:${date}`).lean(),
    ActivityDailyModel.findById(`${userId}:${date}`).lean(),
    UserSettingsModel.findById(userId, { dailyStepGoal: 1, dailyWaterGoalMl: 1 }).lean(),
    daysOf(userId),
    ActivityDailyModel.findOne({ userId }, { localDay: 1 }).sort({ localDay: 1 }).lean(),
    HydrationEntryModel.find({ userId, localDay: date, deletedAt: null }, { ml: 1 }).lean(),
    FoodEntryModel.find({ userId, localDay: date, deletedAt: null }, { calories: 1 }).lean(),
    ledgerOnDay(userId, date, timeZone),
  ]);

  const stepGoal = settings?.dailyStepGoal ?? 10_000;
  const steps = Math.round(activity?.verifiedSteps ?? 0);
  const upcoming = date > today;

  const run = runAt(days.all, date);
  const current = currentRunOf(days.all, today);
  const day = run ? daysBetween(run.start, date) + 1 : null;
  const worded = wordDay(row?.kind ?? null, steps, await restoreCostOf(userId, row?.referenceId));
  const status: StreakDayStatus = upcoming ? 'upcoming' : worded.status;

  const title = upcoming
    ? 'Still to come'
    : run && day !== null
      ? current !== null && current.start === run.start
        ? `Day ${day} of your current streak`
        : `Day ${day} of a ${run.length}-day run`
      : date === today
        ? 'Not counted yet'
        : 'Day missed';

  // The way back stops at the first day anything is known about — a counting
  // day, or a day the phone sent steps for. Paging further would be paging
  // through days that could only ever read "No activity".
  const recorded = [...days.all].sort();
  const earliest = [recorded[0], oldestActivity?.localDay, today]
    .filter((value): value is IsoDate => typeof value === 'string')
    .sort()[0];

  const metrics: StreakDayMetric[] = [];
  if (!upcoming) {
    const consumedMl = water.reduce((sum, entry) => sum + entry.ml, 0);
    const eaten = food.reduce((sum, entry) => sum + entry.calories, 0);
    metrics.push(
      { id: 'distance', label: 'Distance', value: `${(activity?.distanceKm ?? 0).toFixed(1)} km`, caption: null },
      { id: 'activeMinutes', label: 'Active', value: `${fmtNumber(activity?.activeMinutes ?? 0)} min`, caption: null },
      {
        id: 'calories',
        label: 'Calories',
        value: `${fmtNumber((activity?.caloriesBurned ?? 0) + (activity?.stepCalories ?? 0))} kcal`,
        caption: 'Walking and workouts',
      },
      { id: 'workouts', label: 'Workouts', value: fmtNumber(activity?.workoutsCompleted ?? 0), caption: null },
    );
    // Water and food only when there is something to report: a row reading
    // "0 ml" says nothing about a day the member never opened the screen on.
    if (consumedMl > 0) {
      metrics.push({
        id: 'water',
        label: 'Water',
        value: `${fmtNumber(consumedMl)} ml`,
        caption: `Goal ${fmtNumber(settings?.dailyWaterGoalMl ?? 2_500)} ml`,
      });
    }
    if (eaten > 0) {
      metrics.push({
        id: 'food',
        label: 'Food',
        value: `${fmtNumber(eaten)} kcal`,
        caption: `${food.length} ${food.length === 1 ? 'item' : 'items'} logged`,
      });
    }
  }

  // What is still open about the day: a restore while it is inside the window
  // (RULES S6), otherwise what it would have taken to count.
  const gap = restoreGapOf(days.all, today, config.streak.restoreWindowDays);
  const note = upcoming
    ? null
    : gap.includes(date)
      ? `A restore would bring this day back for ${fmtNumber(config.streak.restoreCost)} coins.`
      : row
        ? null
        : howToEarn(config, stepGoal);

  return streakDayDetailSchema.parse({
    date,
    today,
    status,
    title,
    detail: upcoming ? 'This day has not happened yet.' : worded.detail,
    day,
    run,
    counted: row !== null && row !== undefined,
    steps,
    stepGoal,
    goalMet: steps >= stepGoal,
    verified: activity?.verified ?? false,
    metrics,
    coinsEarned: roundCoins(toCoins(ledger.reduce((sum, entry) => sum + entry.amountMc, 0))),
    note,
    previousDate: date > earliest ? addDays(date, -1) : null,
    nextDate: date < today ? addDays(date, 1) : null,
  });
}

/**
 * `GET /streak/day/events?date=&cursor=&limit=`: everything the day holds, in
 * one list, newest first — what decided the day, the workouts done, the coins
 * it moved, the water drunk and the food logged.
 *
 * Built whole and then sliced, rather than paged in the database: the rows
 * come from five collections with five different clocks, and a cursor into
 * any one of them could not order the others. One local day is bounded — a
 * few dozen rows — so the whole of it is the cheapest correct page, and the
 * `total` is exact rather than an estimate. The cursor is an offset, which
 * for a day that is over can never shift under the reader.
 */
export async function getStreakDayEvents(
  userId: string,
  timeZone: string,
  date: IsoDate,
  options: { cursor?: string; limit?: number } = {},
): Promise<StreakDayEventsPage> {
  const limit = Math.min(DAY_EVENTS_MAX_PAGE, Math.max(1, options.limit ?? DAY_EVENTS_PAGE));
  const offset = Math.max(0, Number(options.cursor ?? 0));

  const [row, activity, workouts, ledger, water, food] = await Promise.all([
    StreakDayModel.findById(`${userId}:${date}`).lean(),
    ActivityDailyModel.findById(`${userId}:${date}`, { verifiedSteps: 1 }).lean(),
    WorkoutModel.find(
      { userId, localDay: date, deletedAt: null },
      { title: 1, startedAt: 1, completedAt: 1, caloriesBurned: 1, totalVolumeKg: 1 },
    ).lean(),
    ledgerOnDay(userId, date, timeZone),
    HydrationEntryModel.find({ userId, localDay: date, deletedAt: null }, { ml: 1, at: 1 }).lean(),
    FoodEntryModel.find({ userId, localDay: date, deletedAt: null }, { name: 1, slot: 1, calories: 1, loggedAt: 1 }).lean(),
  ]);

  const events: StreakDayEvent[] = [];

  if (row) {
    const worded = wordDay(row.kind, Math.round(activity?.verifiedSteps ?? 0), await restoreCostOf(userId, row.referenceId));
    events.push({
      id: `streak:${date}`,
      kind: 'streak',
      title:
        row.kind === 'frozen'
          ? 'Streak Freeze used'
          : row.kind === 'restored'
            ? 'Day restored'
            : row.source === 'workout'
              ? 'Workout counted the day'
              : 'Step goal reached',
      detail: worded.detail,
      at: (row as { createdAt?: Date }).createdAt?.toISOString() ?? null,
      coins: null,
    });
  }

  for (const entry of workouts) {
    const minutes = entry.completedAt
      ? Math.max(0, Math.round((entry.completedAt.getTime() - entry.startedAt.getTime()) / 60_000))
      : null;
    events.push({
      id: `workout:${entry._id}`,
      kind: 'workout',
      title: entry.title,
      detail: [
        minutes === null ? null : `${minutes} min`,
        entry.caloriesBurned ? `${fmtNumber(entry.caloriesBurned)} kcal` : null,
        entry.totalVolumeKg ? `${fmtNumber(entry.totalVolumeKg)} kg lifted` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
      at: (entry.completedAt ?? entry.startedAt).toISOString(),
      coins: null,
    });
  }

  for (const entry of ledger) {
    events.push({
      id: `coins:${entry._id}`,
      kind: 'coins',
      title: entry.title,
      detail: COIN_SOURCE_WORDS[entry.source as CoinSource] ?? null,
      at: entry.createdAt.toISOString(),
      coins: roundCoins(toCoins(entry.amountMc)),
    });
  }

  for (const entry of water) {
    events.push({
      id: `water:${entry._id}`,
      kind: 'water',
      title: `${fmtNumber(entry.ml)} ml of water`,
      detail: null,
      at: entry.at.toISOString(),
      coins: null,
    });
  }

  for (const entry of food) {
    events.push({
      id: `meal:${entry._id}`,
      kind: 'meal',
      title: entry.name,
      detail: `${entry.slot[0].toUpperCase()}${entry.slot.slice(1)} · ${fmtNumber(entry.calories)} kcal`,
      at: entry.loggedAt.toISOString(),
      coins: null,
    });
  }

  // Newest first, with anything undated last — and the id as the tie-break,
  // so two rows written in the same millisecond keep one order between pages.
  events.sort((a, b) => {
    if (a.at === b.at) return a.id < b.id ? 1 : -1;
    if (a.at === null) return 1;
    if (b.at === null) return -1;
    return a.at < b.at ? 1 : -1;
  });

  const page = events.slice(offset, offset + limit);
  return streakDayEventsPageSchema.parse({
    data: page,
    nextCursor: offset + page.length < events.length ? String(offset + page.length) : null,
    total: events.length,
  });
}

// ─── Writes ────────────────────────────────────────────────────────────────

/**
 * Records that `localDay` was earned (RULES S1, W6) — by a plausible
 * workout, or by verified steps at or above the user's goal where
 * ⚙ `streak.earnedBy` says steps count. A day already earned stays as it
 * was; a frozen or restored day becomes earned. Returns whether anything
 * changed.
 */
export async function markEarned(
  userId: string,
  localDay: IsoDate,
  source: Extract<StreakDaySource, 'workout' | 'steps'>,
  timeZone: string,
  options: { referenceId?: string; now?: Date } = {},
): Promise<boolean> {
  const config = await getConfig();
  if (!config.streak.earnedBy[source === 'steps' ? 'stepGoal' : 'workout']) return false;

  const id = `${userId}:${localDay}`;
  const existing = await StreakDayModel.findById(id, { kind: 1, source: 1 }).lean();
  if (existing?.kind === 'earned') return false;

  if (existing) {
    const upgraded = await StreakDayModel.updateOne(
      { _id: id, kind: { $ne: 'earned' } },
      { $set: { kind: 'earned', source, protectedBy: existing.source, referenceId: options.referenceId ?? null } },
    );
    if (upgraded.modifiedCount === 0) return false;
  } else {
    try {
      await StreakDayModel.create({ _id: id, userId, localDay, kind: 'earned', source, referenceId: options.referenceId ?? null });
    } catch (err) {
      // Earned by something else a moment ago: one row, whoever got there first.
      if ((err as { code?: number }).code === 11000) return false;
      throw err;
    }
  }

  await afterStreakChange(userId, timeZone, options.now);
  return true;
}

/**
 * Spends a freeze on today (RULES S4). Refused — with nothing spent — when
 * none are left or today already counts.
 */
export async function freezeToday(userId: string, timeZone: string, now = new Date()): Promise<StreakSummary> {
  const config = await getConfig();
  await stateOf(userId, config);
  const today = localDayOf(now, timeZone);

  await withTransaction(async session => {
    const covered = await StreakDayModel.exists({ _id: `${userId}:${today}` }).session(session);
    if (covered) {
      throw new ApiError(409, 'STREAK_ALREADY_COVERED', 'Today already counts — save the freeze for a rest day.');
    }
    const spent = await StreakStateModel.findOneAndUpdate(
      { _id: userId, freezesAvailable: { $gt: 0 } },
      { $inc: { freezesAvailable: -1 } },
      { session, new: true },
    ).lean();
    if (!spent) {
      throw new ApiError(409, 'NO_FREEZES_LEFT', 'No freezes left. Keep your streak going to earn another.');
    }
    await StreakDayModel.create([{ _id: `${userId}:${today}`, userId, localDay: today, kind: 'frozen', source: 'freeze' }], { session });
  });

  await afterStreakChange(userId, timeZone, now);
  return getStreak(userId, timeZone, now);
}

export interface RestoreMeta {
  idempotencyKey?: string;
  deviceId?: string;
  appVersion?: string;
}

/**
 * Bridges the gap since the last run with restored days, for coins
 * (RULES S6, S7). The debit and the days are one transaction: a restore
 * that cannot be paid for protects nothing, and a payment never leaves the
 * gap open. The debit is keyed by the run it revives, so a retried request
 * cannot pay twice for one gap.
 */
export async function restoreStreak(userId: string, timeZone: string, meta: RestoreMeta = {}, now = new Date()): Promise<StreakRestoreResult> {
  const config = await getConfig();
  const today = localDayOf(now, timeZone);
  const days = await daysOf(userId);
  const gap = restoreGapOf(days.all, today, config.streak.restoreWindowDays);
  if (gap.length === 0) {
    throw new ApiError(
      422,
      'NOTHING_TO_RESTORE',
      currentStreakOf(days.all, today) > 0
        ? 'Your streak is intact. Keep it going!'
        : 'Your last streak ended too long ago to bring back.',
    );
  }
  const lastRunEnd = addDays(gap[0], -1);

  const paid = await withTransaction(async session => {
    const debit = await debitInSession(
      {
        userId,
        source: 'streak',
        referenceType: RESTORE_REFERENCE,
        referenceId: lastRunEnd,
        amount: config.streak.restoreCost,
        title: 'Streak restored',
        idempotencyKey: meta.idempotencyKey,
        deviceId: meta.deviceId,
        appVersion: meta.appVersion,
      },
      session,
    );
    await StreakDayModel.bulkWrite(
      gap.map(day => ({
        updateOne: {
          filter: { _id: `${userId}:${day}` },
          // A day that came to count in the meantime is left as it is.
          update: { $setOnInsert: { _id: `${userId}:${day}`, userId, localDay: day, kind: 'restored', source: 'restore', referenceId: debit.ledgerId } },
          upsert: true,
        },
      })),
      { session },
    );
    return debit;
  });

  // A revived run can reach a milestone, so the balance is read after it.
  await afterStreakChange(userId, timeZone, now);
  const balance = await CoinBalanceModel.findById(userId, { balanceMc: 1 }).lean();
  return streakRestoreResultSchema.parse({
    streak: await getStreak(userId, timeZone, now),
    balance: balance ? toCoins(balance.balanceMc) : paid.balance,
  });
}

/**
 * What follows any change to the day lists: a freeze for every
 * `everyDays` of the current run (RULES S5), the milestone coins the
 * longest run has reached and the ledger has not paid (S8), and the user
 * record's own `streakDays`. Every step is idempotent — the grant keys, the
 * ledger's unique index and the notification dedupe keys — so recounting
 * after a retry changes nothing.
 */
async function afterStreakChange(userId: string, timeZone: string, now = new Date()): Promise<void> {
  try {
    const config = await getConfig();
    const today = localDayOf(now, timeZone);
    const days = await daysOf(userId);
    const run = currentRunOf(days.all, today);
    const longest = longestStreakOf(days.all);

    await grantFreezes(userId, run, config, now);
    await payMilestones(userId, longest?.length ?? 0, today, config, now);
    await UserModel.updateOne({ _id: userId }, { $set: { streakDays: run?.length ?? 0 } });
    // A longer record can unlock a streak badge (RULES C7).
    await evaluateAchievements(userId, timeZone, now);
  } catch (err) {
    // The day itself is recorded; what follows from it is retried by the next change.
    logger.warn({ err, userId }, 'streak.after_change_failed');
  }
}

async function grantFreezes(userId: string, run: StreakRun | null, config: AppConfig, now: Date): Promise<void> {
  const { everyDays, maxHeld } = config.streak.freezes;
  if (!run || everyDays <= 0 || run.length < everyDays) return;
  await stateOf(userId, config);

  for (let length = everyDays; length <= run.length; length += everyDays) {
    const key = `${run.start}:${length}`;
    // The key first: a run reaching 30 days grants once, held or not —
    // a user already holding the most cannot bank it for later.
    const recorded = await StreakStateModel.updateOne(
      { _id: userId, freezeGrantKeys: { $ne: key } },
      { $push: { freezeGrantKeys: { $each: [key], $slice: -50 } } },
    );
    if (recorded.modifiedCount === 0) continue;
    const granted = await StreakStateModel.updateOne(
      { _id: userId, freezesAvailable: { $lt: maxHeld } },
      { $inc: { freezesAvailable: 1 } },
    );
    if (granted.modifiedCount === 1) {
      await notify({
        userId,
        topic: 'streak',
        title: 'You earned a Streak Freeze ❄️',
        message: `${length} days in a row! A freeze is ready for the day you need a rest.`,
        dedupeKey: `streak-freeze:${userId}:${key}`,
        now,
      });
    }
  }
}

async function payMilestones(userId: string, longest: number, today: IsoDate, config: AppConfig, now: Date): Promise<void> {
  // Days steps earned make the coins step-derived: while step coins wait in
  // shadow mode (D-05), so do these (D-46). The first change after step
  // coins are switched on pays every milestone already reached.
  if (config.streak.earnedBy.stepGoal && !config.coins.steps.enabled) return;
  const reached = config.coins.streakMilestones.filter(m => longest >= m.days);
  if (reached.length === 0) return;
  const paid = await paidMilestonesOf(userId);

  for (const milestone of reached) {
    if (paid.has(String(milestone.days))) continue;
    const result = await credit({
      userId,
      source: 'streak',
      referenceType: MILESTONE_REFERENCE,
      referenceId: String(milestone.days),
      amount: milestone.coins,
      title: `${milestone.days}-day streak`,
      localDay: today,
    });
    if (result.status === 'credited') {
      await notify({
        userId,
        topic: 'streak',
        title: `${milestone.days}-day streak! 🔥`,
        message: `You earned ${result.granted.toLocaleString('en-IN')} coins for keeping it going.`,
        dedupeKey: `streak-milestone:${userId}:${milestone.days}`,
        now,
      });
    }
  }
}

// ─── The evening nudge (RULES S10) ─────────────────────────────────────────

/**
 * At ⚙ `streak.atRiskHour` local time, tells everyone whose streak is alive
 * but not yet covered today that it ends at midnight. Hourly; each user is
 * told once a day (the dedupe key), and only in the hour that is theirs.
 * The notification layer applies the `activity` switch and quiet hours.
 */
export async function warnStreaksAtRisk(now = new Date()): Promise<{ warned: number }> {
  const config = await getConfig();
  const utcToday = now.toISOString().slice(0, 10);
  // Anyone counting yesterday, in any zone — a streak with no such day is not alive.
  const window = [addDays(utcToday, -2), addDays(utcToday, -1), utcToday, addDays(utcToday, 1)];
  const userIds: string[] = await StreakDayModel.distinct('userId', { localDay: { $in: window } });

  let warned = 0;
  for (const userId of userIds) {
    const user = await UserModel.findById(userId, { timezone: 1, deletedAt: 1 }).lean();
    if (!user || user.deletedAt) continue;
    const timeZone = user.timezone ?? config.locale.timezone;
    if (localHourOf(now, timeZone) !== config.streak.atRiskHour) continue;

    const today = localDayOf(now, timeZone);
    const days = await daysOf(userId);
    if (days.all.has(today)) continue;
    const current = currentStreakOf(days.all, today);
    if (current === 0) continue;

    const goal = await dailyStepGoalOf(userId);
    const result = await notify({
      userId,
      topic: 'streak',
      title: 'Your streak is at risk 🔥',
      message: `Your ${current}-day streak ends at midnight. ${howToEarn(config, goal)}`,
      dedupeKey: `streak-risk:${userId}:${today}`,
      now,
    });
    if (result.status === 'created') warned += 1;
  }
  return { warned };
}
