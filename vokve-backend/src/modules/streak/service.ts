import { getConfig } from '../../config/remote.js';
import type { AppConfig } from '../../config/defaults.js';
import {
  streakRestoreResultSchema,
  streakSummarySchema,
  type StreakMilestone,
  type StreakRestoreResult,
  type StreakRun,
  type StreakSummary,
} from '../../contracts/index.js';
import { withTransaction } from '../../db/mongo.js';
import { addDays, localDayOf, localHourOf, type IsoDate } from '../../lib/dates.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { toCoins } from '../../lib/coins.js';
import { evaluateAchievements } from '../challenges/service.js';
import { CoinBalanceModel, CoinLedgerModel } from '../economy/models.js';
import { credit, debitInSession } from '../economy/service.js';
import { UserModel, UserSettingsModel } from '../identity/models.js';
import { notify } from '../notifications/service.js';
import { StreakDayModel, StreakStateModel, type StreakDaySource } from './models.js';
import { currentRunOf, currentStreakOf, longestStreakOf, restoreGapOf } from './rules.js';

/**
 * The streak (RULES §S), on the server: which days count, the figures drawn
 * from them, and the two tools — a freeze and a paid restore. Ported from
 * the client's `streakStore`, whose golden tests were the acceptance suite;
 * the app now only shows what this says.
 */

const MILESTONE_REFERENCE = 'streak_milestone';
const RESTORE_REFERENCE = 'streak_restore';

export { currentRunOf, currentStreakOf, daysBetween, longestStreakOf, restoreGapOf } from './rules.js';

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
