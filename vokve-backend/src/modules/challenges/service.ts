import { getConfig } from '../../config/remote.js';
import { achievementSchema, challengeSchema, type Achievement, type Challenge } from '../../contracts/index.js';
import { addDays, localDayOf, type IsoDate } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';
import { ActivityDailyModel } from '../activity/models.js';
import { credit } from '../economy/service.js';
import { notify } from '../notifications/service.js';
import { StreakDayModel } from '../streak/models.js';
import { daysBetween, longestStreakOf } from '../streak/rules.js';
import { WorkoutModel } from '../training/models.js';
import {
  AchievementDefinitionModel,
  ChallengeCompletionModel,
  ChallengeDefinitionModel,
  UserAchievementModel,
  type AchievementRule,
  type ChallengeCadence,
  type ChallengeMetric,
} from './models.js';

/**
 * Challenges and achievements (RULES §C), on the server: the catalogue,
 * each member's progress worked out from verified activity for the period
 * a day falls in (C3), completions recorded and paid once per (user,
 * challenge, period) (C4), and the badges they and their own rules unlock.
 * Everyone is enrolled in every open challenge (C5, D-08); there is nothing
 * to join and nothing to claim.
 */

// ─── Periods (RULES C6) ────────────────────────────────────────────────────

export interface Period {
  start: IsoDate;
  end: IsoDate;
}

/** 0 for Monday … 6 for Sunday. */
function weekdayOf(day: IsoDate): number {
  const [y, m, d] = day.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** The day, the Monday-to-Sunday week, or the calendar month that `day` falls in. */
export function periodOf(cadence: ChallengeCadence, day: IsoDate): Period {
  if (cadence === 'daily') return { start: day, end: day };
  if (cadence === 'weekly') {
    const start = addDays(day, -weekdayOf(day));
    return { start, end: addDays(start, 6) };
  }
  const start = `${day.slice(0, 7)}-01`;
  const [y, m] = day.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { start, end: addDays(nextMonth, -1) };
}

interface DefinitionRow {
  _id: string;
  title: string;
  description?: string | null;
  emoji?: string | null;
  metric: ChallengeMetric;
  cadence: ChallengeCadence;
  goal: number;
  rewardCoins: number;
  rewardsBadge?: boolean | null;
  badgeId?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
}

function isOpenOn(def: DefinitionRow, day: IsoDate): boolean {
  return (!def.startsOn || def.startsOn <= day) && (!def.endsOn || def.endsOn >= day);
}

// ─── Progress (RULES C3) ───────────────────────────────────────────────────

/**
 * How far a member has got with one metric over one period, from verified
 * activity only: verified steps; workout calories plus the walking calories
 * of verified days; the active minutes of verified days; days the streak
 * counted as earned; plausible workouts.
 */
async function progressOf(userId: string, metric: ChallengeMetric, period: Period): Promise<number> {
  const days = { $gte: period.start, $lte: period.end };
  switch (metric) {
    case 'days':
      return StreakDayModel.countDocuments({ userId, kind: 'earned', localDay: days });
    case 'workouts':
      return WorkoutModel.countDocuments({ userId, plausible: true, deletedAt: null, localDay: days });
    default: {
      const sum =
        metric === 'steps'
          ? '$verifiedSteps'
          : metric === 'calories'
            ? { $add: [{ $ifNull: ['$caloriesBurned', 0] }, { $cond: ['$verified', { $ifNull: ['$stepCalories', 0] }, 0] }] }
            : { $cond: ['$verified', { $ifNull: ['$activeMinutes', 0] }, 0] };
      const [row] = await ActivityDailyModel.aggregate<{ total: number }>([
        { $match: { userId, localDay: days } },
        { $group: { _id: null, total: { $sum: sum } } },
      ]);
      return Math.round(row?.total ?? 0);
    }
  }
}

/** `progressOf`, asked once per (metric, period) however many challenges share it. */
function progressCache(userId: string) {
  const cache = new Map<string, Promise<number>>();
  return (metric: ChallengeMetric, period: Period) => {
    const key = `${metric}:${period.start}:${period.end}`;
    let value = cache.get(key);
    if (!value) {
      value = progressOf(userId, metric, period);
      cache.set(key, value);
    }
    return value;
  };
}

// ─── Reads ─────────────────────────────────────────────────────────────────

/**
 * `GET /challenges?date=`: the board for one day — every challenge open on
 * it with the progress of the period it falls in (`startsAt: null`), then
 * the ones opening within ⚙ `challenges.upcomingDays` (`startsAt` set,
 * soonest first). A past day shows what that day's periods came to.
 */
export async function getChallenges(userId: string, date: IsoDate): Promise<Challenge[]> {
  const config = await getConfig();
  const defs = (await ChallengeDefinitionModel.find({ active: true }).sort({ sort: 1, _id: 1 }).lean()) as DefinitionRow[];
  const open = defs.filter(def => isOpenOn(def, date));
  const upcoming = defs
    .filter(def => def.startsOn && def.startsOn > date && daysBetween(date, def.startsOn) <= config.challenges.upcomingDays)
    .sort((a, b) => a.startsOn!.localeCompare(b.startsOn!));

  const periods = new Map(open.map(def => [def._id, periodOf(def.cadence, date)]));
  const completions = await ChallengeCompletionModel.find({
    _id: { $in: open.map(def => `${userId}:${def._id}:${periods.get(def._id)!.start}`) },
  }).lean();
  const completedAt = new Map(completions.map(c => [c.challengeId, c.completedAt.toISOString()]));
  const progress = progressCache(userId);

  const active = await Promise.all(
    open.map(async def => {
      const period = periods.get(def._id)!;
      return challengeSchema.parse({
        id: def._id,
        title: def.title,
        description: def.description ?? '',
        emoji: def.emoji ?? '🏅',
        metric: def.metric,
        cadence: def.cadence,
        goal: def.goal,
        progress: await progress(def.metric, period),
        rewardCoins: def.rewardCoins,
        rewardsBadge: Boolean(def.rewardsBadge),
        startsAt: null,
        endsOn: period.end,
        completedAt: completedAt.get(def._id) ?? null,
      });
    }),
  );

  const later = upcoming.map(def =>
    challengeSchema.parse({
      id: def._id,
      title: def.title,
      description: def.description ?? '',
      emoji: def.emoji ?? '🏅',
      metric: def.metric,
      cadence: def.cadence,
      goal: def.goal,
      progress: 0,
      rewardCoins: def.rewardCoins,
      rewardsBadge: Boolean(def.rewardsBadge),
      startsAt: def.startsOn,
      endsOn: null,
      completedAt: null,
    }),
  );

  return [...active, ...later];
}

/** `GET /achievements`: the whole shelf, in catalogue order, with the date each was unlocked. */
export async function getAchievements(userId: string): Promise<Achievement[]> {
  const [defs, mine] = await Promise.all([
    AchievementDefinitionModel.find().sort({ sort: 1, _id: 1 }).lean(),
    UserAchievementModel.find({ userId }).lean(),
  ]);
  const achievedAt = new Map(mine.map(row => [row.achievementId, row.achievedAt.toISOString()]));
  return defs.map(def =>
    achievementSchema.parse({
      id: def._id,
      value: def.value,
      label: def.label,
      metric: def.metric,
      achievedAt: achievedAt.get(def._id) ?? null,
    }),
  );
}

// ─── Writes ────────────────────────────────────────────────────────────────

/**
 * Re-counts every challenge open on `localDay` after something that moves
 * its progress — a day's steps scored, a workout saved, a streak day earned
 * — and completes the ones that have reached their goal (RULES C4). A
 * completion is recorded once per (user, challenge, period); the coins go
 * through `economy.credit()` like any other, so the daily ceiling applies and
 * a replay pays nothing.
 *
 * Rewards a challenge earns from steps — steps, calories, active minutes,
 * goal days — wait for ⚙ `coins.steps.enabled`, exactly as step coins do
 * (D-05, D-46): while it is off the completion is recorded and nothing is
 * paid. Workout challenges pay whenever workouts do.
 */
export async function evaluateChallenges(userId: string, localDay: IsoDate, timeZone: string, now = new Date()): Promise<string[]> {
  const config = await getConfig();
  const defs = (await ChallengeDefinitionModel.find({ active: true }).lean()) as DefinitionRow[];
  const progress = progressCache(userId);
  const today = localDayOf(now, timeZone);
  const completed: string[] = [];

  for (const def of defs.filter(d => isOpenOn(d, localDay))) {
    const period = periodOf(def.cadence, localDay);
    const reached = await progress(def.metric, period);
    if (reached < def.goal) continue;

    const id = `${userId}:${def._id}:${period.start}`;
    const payable = def.rewardCoins > 0 && (def.metric === 'workouts' || config.coins.steps.enabled);
    try {
      await ChallengeCompletionModel.create({
        _id: id,
        userId,
        challengeId: def._id,
        cadence: def.cadence,
        periodStart: period.start,
        periodEnd: period.end,
        progress: reached,
        goal: def.goal,
        rewardCoins: def.rewardCoins,
        status: payable ? 'paid' : 'unpaid',
        completedAt: now,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) continue;
      throw err;
    }
    completed.push(def._id);

    let granted = 0;
    if (payable) {
      const result = await credit({
        userId,
        source: 'challenge',
        referenceType: 'challenge',
        referenceId: `${def._id}:${period.start}`,
        amount: def.rewardCoins,
        title: `${def.title} completed`,
        localDay: today,
      });
      granted = result.granted;
      await ChallengeCompletionModel.updateOne(
        { _id: id },
        { $set: { granted, ledgerId: result.ledgerId ?? null, status: result.capped > 0 || result.status === 'cap_reached' ? 'capped' : 'paid' } },
      );
    }

    if (def.rewardsBadge && def.badgeId) {
      await unlockAchievement(userId, def.badgeId, `challenge:${def._id}`, now);
    }

    await notify({
      userId,
      topic: 'challenge',
      title: `${def.title} complete! 🏆`,
      message: !payable
        ? 'Goal reached. Coins for challenges like this start soon.'
        : granted > 0
          ? `You earned ${granted.toLocaleString('en-IN')} coins.`
          : 'Goal reached. Today’s coin limit is already met.',
      dedupeKey: `challenge:${id}`,
      now,
    });
  }

  await evaluateAchievements(userId, timeZone, now);
  return completed;
}

/** Unlocks one badge, once. Returns whether it was new. */
async function unlockAchievement(userId: string, achievementId: string, via: string, now: Date): Promise<boolean> {
  const def = await AchievementDefinitionModel.findById(achievementId).lean();
  if (!def) {
    logger.warn({ achievementId }, 'challenges.unknown_badge');
    return false;
  }
  try {
    await UserAchievementModel.create({ _id: `${userId}:${achievementId}`, userId, achievementId, achievedAt: now, via });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
  await notify({
    userId,
    topic: 'challenge',
    title: `New badge: ${def.label} 🏅`,
    message: 'It’s on your achievements shelf.',
    dedupeKey: `achievement:${userId}:${achievementId}`,
    now,
  });
  return true;
}

/**
 * Unlocks every badge whose own rule the member now meets (RULES C7). Each
 * figure is the member's best on record, not today's, so a day synced late
 * or a streak restored still counts. Never takes a badge back.
 */
export async function evaluateAchievements(userId: string, _timeZone: string, now = new Date()): Promise<string[]> {
  const [defs, mine] = await Promise.all([
    AchievementDefinitionModel.find().lean(),
    UserAchievementModel.find({ userId }, { achievementId: 1 }).lean(),
  ]);
  const have = new Set(mine.map(row => row.achievementId));
  const pending = defs.filter(def => !have.has(def._id) && def.rule);
  if (pending.length === 0) return [];

  const figures = new Map<AchievementRule, Promise<number>>();
  const figure = (rule: AchievementRule) => {
    let value = figures.get(rule);
    if (!value) {
      value = figureOf(userId, rule);
      figures.set(rule, value);
    }
    return value;
  };

  const unlocked: string[] = [];
  for (const def of pending) {
    // A badge with no rule of its own is a challenge's to give.
    if (!def.rule || def.threshold == null) continue;
    if ((await figure(def.rule as AchievementRule)) >= def.threshold && (await unlockAchievement(userId, def._id, 'rule', now))) {
      unlocked.push(def._id);
    }
  }
  return unlocked;
}

async function figureOf(userId: string, rule: AchievementRule): Promise<number> {
  switch (rule) {
    case 'longest_streak': {
      const days = await StreakDayModel.find({ userId }, { localDay: 1 }).lean();
      return longestStreakOf(new Set(days.map(d => d.localDay)))?.length ?? 0;
    }
    case 'total_workouts':
      return WorkoutModel.countDocuments({ userId, plausible: true, deletedAt: null });
    case 'challenges_completed':
      return ChallengeCompletionModel.countDocuments({ userId });
    default: {
      const value =
        rule === 'best_day_steps'
          ? '$verifiedSteps'
          : rule === 'best_day_calories'
            ? { $add: [{ $ifNull: ['$caloriesBurned', 0] }, { $cond: ['$verified', { $ifNull: ['$stepCalories', 0] }, 0] }] }
            : { $cond: ['$verified', { $ifNull: ['$activeMinutes', 0] }, 0] };
      const [row] = await ActivityDailyModel.aggregate<{ best: number }>([
        { $match: { userId } },
        { $group: { _id: null, best: { $max: value } } },
      ]);
      return Math.round(row?.best ?? 0);
    }
  }
}
