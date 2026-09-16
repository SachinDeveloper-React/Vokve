import { getConfig } from '../../config/remote.js';
import { withTransaction } from '../../db/mongo.js';
import { toCoins, toMilli } from '../../lib/coins.js';
import { localDayOf } from '../../lib/dates.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { coinTransactionSchema, walletSchema, type CoinTransaction, type EarnRule, type Wallet } from '../../contracts/index.js';
import { notify } from '../notifications/service.js';
import { CoinBalanceModel, CoinDailyCapModel, CoinLedgerModel } from './models.js';

const MS_PER_DAY = 86_400_000;

/**
 * When a wallet's coins lapse, or null when there is nothing to lapse.
 *
 * Only a balance can expire: a wallet that has never earned, or whose coins
 * were already swept, has no date — it reports the full window instead of a
 * countdown against coins it does not hold (RULES E11). Pending step coins
 * are not counted; they are not the user's yet, and releasing them resets
 * the clock like any other credit.
 */
function expiryOf(bal: { balanceMc?: number; lastCreditAt?: Date | null } | null, expiryDays: number) {
  const lastCredit = bal?.lastCreditAt ?? null;
  const hasCoins = (bal?.balanceMc ?? 0) > 0;
  const expiresAt = hasCoins && lastCredit ? new Date(lastCredit.getTime() + expiryDays * MS_PER_DAY) : null;
  // Counted as whole days idle, subtracted from the window — the same
  // arithmetic the client used when it derived this itself — so a credit a
  // minute ago reads as the full window, not as one day already gone.
  const daysIdle = lastCredit ? Math.floor((Date.now() - lastCredit.getTime()) / MS_PER_DAY) : 0;
  const daysLeft = expiresAt ? Math.min(expiryDays, Math.max(0, expiryDays - daysIdle)) : expiryDays;
  return { expiresAt, daysLeft };
}

export async function getWallet(userId: string, timeZone: string): Promise<Wallet> {
  const config = await getConfig();
  const today = localDayOf(new Date(), timeZone);
  const [bal, cap, month] = await Promise.all([
    CoinBalanceModel.findById(userId).lean(),
    CoinDailyCapModel.findById(`${userId}:${today}`).lean(),
    monthSummary(userId, today.slice(0, 7), timeZone),
  ]);

  const { expiresAt, daysLeft } = expiryOf(bal, config.coins.expiryDays);

  const dailyCapMc = toMilli(config.coins.dailyCap);
  const earnedTodayMc = cap?.totalMc ?? 0;

  return walletSchema.parse({
    balance: toCoins(bal?.balanceMc ?? 0),
    pending: toCoins(bal?.pendingMc ?? 0),
    lifetimeEarned: toCoins(bal?.lifetimeEarnedMc ?? 0),
    expiresAt: expiresAt?.toISOString() ?? null,
    expiryDaysLeft: daysLeft,
    expiryWindowDays: config.coins.expiryDays,
    expiryWarnDays: config.coins.expiryWarnDays,
    monthSummary: month,
    dailyCap: config.coins.dailyCap,
    earnedToday: toCoins(earnedTodayMc),
    remainingToday: toCoins(Math.max(0, dailyCapMc - earnedTodayMc)),
    stepUpThreshold: config.coins.stepUpThreshold,
  });
}

export interface ExpirySweepResult {
  /** Wallets whose window had run out. */
  expired: number;
  /** Coins removed, in total. */
  coins: number;
  /** Wallets that were already swept by a concurrent run, or emptied in between. */
  skipped: number;
}

/**
 * The idle-expiry sweep (RULES E9, BACKEND §8.4): every wallet with coins
 * and no credit for `coins.expiryDays` is zeroed with one compensating
 * `refund` row, so the ledger still explains the balance.
 *
 * Idempotent two ways. The row's reference is the credit the window ran
 * from, and the ledger's unique index refuses a second row for it; and the
 * balance is only zeroed when it is still what was read, so a credit that
 * lands between the read and the write keeps its coins and its fresh clock.
 * `lastCreditAt` is left alone — it is the evidence — so the wallet keeps
 * reporting the full window until the user earns again (`expiryOf`).
 *
 * `now` is a parameter so a test, or the dev route, can move the calendar.
 */
export async function expireIdleWallets(now = new Date()): Promise<ExpirySweepResult> {
  const config = await getConfig();
  const cutoff = new Date(now.getTime() - config.coins.expiryDays * MS_PER_DAY);
  const title = `Coins expired after ${config.coins.expiryDays} days of inactivity`;

  const idle = await CoinBalanceModel.find(
    { balanceMc: { $gt: 0 }, lastCreditAt: { $ne: null, $lte: cutoff } },
    { balanceMc: 1, lastCreditAt: 1 },
  ).lean();

  const result: ExpirySweepResult = { expired: 0, coins: 0, skipped: 0 };
  for (const bal of idle) {
    const swept = await withTransaction(async session => {
      const zeroed = await CoinBalanceModel.updateOne(
        { _id: bal._id, balanceMc: bal.balanceMc },
        { $set: { balanceMc: 0 } },
        { session },
      );
      if (zeroed.modifiedCount === 0) return 0;
      await CoinLedgerModel.create([{
        _id: newId('led'), userId: bal._id, amountMc: -bal.balanceMc, source: 'refund', title,
        referenceType: 'expiry', referenceId: bal.lastCreditAt!.toISOString(), actor: 'system:expiry',
      }], { session });
      return bal.balanceMc;
    }).catch((err: unknown) => {
      // E11000 on the ledger: another instance swept this wallet first.
      if ((err as { code?: number }).code === 11000) return 0;
      throw err;
    });

    if (swept > 0) {
      result.expired += 1;
      result.coins += toCoins(swept);
      // Told after the fact, keyed to the credit the window ran from, so a
      // re-run that finds nothing to sweep also has nothing to repeat.
      await notify({
        userId: bal._id, topic: 'coins', now,
        title: 'Your coins have expired',
        message: `${fmtCoins(swept)} coins lapsed after ${config.coins.expiryDays} days without earning. Earn again and the clock starts fresh.`,
        dedupeKey: `coin-expired:${bal.lastCreditAt!.toISOString()}`,
      });
    } else {
      result.skipped += 1;
    }
  }

  logger.info({ ...result, cutoff }, 'economy.expiry_sweep');
  return result;
}

export interface ExpiryWarnResult {
  /** Wallets that were on a warn day and had not been told yet. */
  warned: number;
  /** Wallets on a warn day already told — the job ran twice today, or the user was told on this window before. */
  repeated: number;
}

/**
 * The reminders before the sweep (RULES E10, BACKEND §8.4): a wallet with
 * coins is told on each of `coins.expiryWarnDays` days-before that its clock
 * is running out. Keyed to the credit the window runs from *and* the
 * threshold, so a user gets each warning once per idle stretch — and none at
 * all if they earn in between, because the key then names a credit that no
 * longer has a window.
 *
 * Runs as a daily job, so it uses the same whole-days arithmetic as the
 * wallet's countdown: the day the panel shows "14 days left" is the day the
 * reminder arrives.
 */
export async function warnExpiringWallets(now = new Date()): Promise<ExpiryWarnResult> {
  const config = await getConfig();
  const warnDays = [...new Set(config.coins.expiryWarnDays)].filter(d => d >= 0 && d < config.coins.expiryDays);
  const result: ExpiryWarnResult = { warned: 0, repeated: 0 };
  if (warnDays.length === 0) return result;

  // Only wallets idle long enough to be inside the outermost warn day.
  const oldestIdle = config.coins.expiryDays - Math.max(...warnDays);
  const candidates = await CoinBalanceModel.find(
    { balanceMc: { $gt: 0 }, lastCreditAt: { $ne: null, $lte: new Date(now.getTime() - oldestIdle * MS_PER_DAY) } },
    { balanceMc: 1, lastCreditAt: 1 },
  ).lean();

  for (const bal of candidates) {
    const daysIdle = Math.floor((now.getTime() - bal.lastCreditAt!.getTime()) / MS_PER_DAY);
    const daysLeft = config.coins.expiryDays - daysIdle;
    if (!warnDays.includes(daysLeft)) continue;

    const when = daysLeft === 0 ? 'tonight' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
    const outcome = await notify({
      userId: bal._id, topic: 'coins', now,
      title: `Your coins expire ${when}`,
      message: `You have ${fmtCoins(bal.balanceMc)} coins and nothing earned for ${daysIdle} days. Walk, train or finish a challenge to keep them for another ${config.coins.expiryDays} days.`,
      dedupeKey: `coin-expiry-warn:${bal.lastCreditAt!.toISOString()}:${daysLeft}`,
    });
    if (outcome.status === 'created') result.warned += 1;
    else result.repeated += 1;
  }

  logger.info(result, 'economy.expiry_warn');
  return result;
}

/** Milli-coins as the user reads them: whole numbers whole, fractions to two places. */
function fmtCoins(mc: number): string {
  const coins = toCoins(mc);
  return Number.isInteger(coins) ? coins.toLocaleString('en-IN') : coins.toFixed(2);
}

/** Calendar month in the user's zone, not a rolling 30 days (RULES E12). */
async function monthSummary(userId: string, monthKey: string, timeZone: string) {
  const [y, m] = monthKey.split('-').map(Number);
  // Month bounds in the user's zone: approximate by taking UTC bounds widened by a day and filtering per row.
  const start = new Date(Date.UTC(y, m - 1, 1) - 86_400_000);
  const end = new Date(Date.UTC(y, m, 1) + 86_400_000);
  const rows = await CoinLedgerModel.find({ userId, createdAt: { $gte: start, $lt: end } }, { amountMc: 1, createdAt: 1 }).lean();
  let earned = 0, spent = 0;
  for (const r of rows) {
    if (localDayOf(r.createdAt, timeZone).slice(0, 7) !== monthKey) continue;
    if (r.amountMc > 0) earned += r.amountMc; else spent += -r.amountMc;
  }
  return { earned: toCoins(earned), spent: toCoins(spent), net: toCoins(earned - spent) };
}

export async function listTransactions(userId: string, cursor: string | undefined, limit = 20, source?: string) {
  const filter: Record<string, unknown> = { userId };
  if (source) filter.source = source;
  if (cursor) filter._id = { $lt: cursor }; // uuid v7 ids sort by time
  const rows = await CoinLedgerModel.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const page = rows.slice(0, limit);
  const data: CoinTransaction[] = page.map(r =>
    coinTransactionSchema.parse({ id: r._id, title: r.title, source: r.source, amount: toCoins(r.amountMc), createdAt: r.createdAt.toISOString() }),
  );
  return { data, nextCursor: rows.length > limit ? page[page.length - 1]._id : null };
}

/** The rate card the wallet shows — served, never hardcoded (RULES E14). */
export async function earnRules(): Promise<EarnRule[]> {
  const { coins } = await getConfig();
  const first = coins.streakMilestones[0];
  return [
    { source: 'steps', title: 'Walk', detail: `Per ${coins.steps.unitSteps.toLocaleString('en-IN')} verified steps`, reward: coins.steps.coinsPerUnit },
    { source: 'workout', title: 'Finish a workout', detail: 'Any logged session', reward: coins.workout },
    { source: 'streak', title: 'Keep a streak', detail: `${first.days} days in a row`, reward: first.coins },
    { source: 'referral', title: 'Invite a friend', detail: 'Once they verify their number and email', reward: coins.referral.inviter },
  ];
}
