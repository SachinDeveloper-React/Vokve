import { getConfig } from '../../config/remote.js';
import { withTransaction } from '../../db/mongo.js';
import { toCoins, toMilli } from '../../lib/coins.js';
import { localDayOf } from '../../lib/dates.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { coinTransactionSchema, walletSchema, type CoinTransaction, type EarnRule, type Wallet } from '../../contracts/index.js';
import { notify } from '../notifications/service.js';
import { CoinBalanceModel, CoinDailyCapModel, CoinHoldModel, CoinLedgerModel } from './models.js';

const MS_PER_DAY = 86_400_000;

/** The two dates a wallet's window can run from, as the sweep reads them. */
interface Anchored {
  balanceMc?: number;
  lastCreditAt?: Date | null;
  lastStepSyncAt?: Date | null;
}

/**
 * When this wallet's idle window last restarted, or null when it never has.
 *
 * Steps first (RULES E9). The window asks whether the member's phone is still
 * reporting, not whether they are still earning, so an accepted snapshot is
 * what keeps coins alive and a credit — a workout, a streak, a referral, an
 * operator's grant — does not. An upload with no steps in it counts: the
 * question is whether the install is reporting at all.
 *
 * `lastCreditAt` is the fallback, and only for a wallet that has never synced
 * once. Without it an account that earns by referral alone, or one whose
 * owner refused the activity permission, would be swept the day this ships.
 */
function anchorOf(bal: Anchored | null): Date | null {
  return bal?.lastStepSyncAt ?? bal?.lastCreditAt ?? null;
}

/**
 * When a wallet's coins lapse, or null when there is nothing to lapse.
 *
 * Only a balance can expire: a wallet that has never earned, or whose coins
 * were already swept, has no date — it reports the full window instead of a
 * countdown against coins it does not hold (RULES E11). Pending step coins
 * are not counted; they are not the user's yet, and the upload that brought
 * them in has already restarted the clock.
 */
function expiryOf(bal: Anchored | null, expiryDays: number) {
  const since = anchorOf(bal);
  const hasCoins = (bal?.balanceMc ?? 0) > 0;
  const expiresAt = hasCoins && since ? new Date(since.getTime() + expiryDays * MS_PER_DAY) : null;
  // Counted as whole days idle, subtracted from the window — the same
  // arithmetic the client used when it derived this itself — so a sync a
  // minute ago reads as the full window, not as one day already gone.
  const daysIdle = since ? Math.floor((Date.now() - since.getTime()) / MS_PER_DAY) : 0;
  const daysLeft = expiresAt ? Math.min(expiryDays, Math.max(0, expiryDays - daysIdle)) : expiryDays;
  return { expiresAt, daysLeft };
}

/**
 * The query both jobs run: wallets holding coins whose window opened on or
 * before `cutoff`, on whichever of the two clocks applies to them.
 *
 * Written as an `$or` rather than resolved in code because the alternative is
 * reading every wallet with a balance into the process once a night and
 * throwing most of them away.
 */
function idleBefore(cutoff: Date) {
  return {
    balanceMc: { $gt: 0 },
    $or: [
      { lastStepSyncAt: { $ne: null, $lte: cutoff } },
      { lastStepSyncAt: null, lastCreditAt: { $ne: null, $lte: cutoff } },
    ],
  };
}

/** What both jobs need off a wallet to decide and to explain itself. */
const ANCHOR_FIELDS = { balanceMc: 1, lastCreditAt: 1, lastStepSyncAt: 1 } as const;

/**
 * An install has reported: this member's idle window starts again (RULES E9).
 *
 * Called from the ingest path for every accepted snapshot, stamped with the
 * receipt rather than the day walked — a member who syncs ten days of backfill
 * today has reported today, and "is this phone still reporting?" is the only
 * question the window asks. Upserted because a member can sync before they
 * have ever earned a coin, and that wallet is the one the sweep will read.
 */
export async function stampStepSync(userId: string, now = new Date()): Promise<void> {
  await CoinBalanceModel.updateOne({ _id: userId }, { $set: { lastStepSyncAt: now } }, { upsert: true });
}

export async function getWallet(userId: string, timeZone: string): Promise<Wallet> {
  const config = await getConfig();
  const today = localDayOf(new Date(), timeZone);
  const [bal, cap, month, nextOut] = await Promise.all([
    CoinBalanceModel.findById(userId).lean(),
    CoinDailyCapModel.findById(`${userId}:${today}`).lean(),
    monthSummary(userId, today.slice(0, 7), timeZone),
    // The first hold due out, for the date the wallet shows against
    // "pending". A hold with no `releaseAfter` is a restricted account's,
    // which an operator releases by hand (RULES T4) — it has no date to
    // promise, so it is left out rather than guessed at.
    CoinHoldModel.find({ userId, status: 'held', releaseAfter: { $ne: null } }, { releaseAfter: 1 })
      .sort({ releaseAfter: 1 })
      .limit(1)
      .lean(),
  ]);

  const { expiresAt, daysLeft } = expiryOf(bal, config.coins.expiryDays);

  const dailyCapMc = toMilli(config.coins.dailyCap);
  const earnedTodayMc = cap?.totalMc ?? 0;

  return walletSchema.parse({
    balance: toCoins(bal?.balanceMc ?? 0),
    pending: toCoins(bal?.pendingMc ?? 0),
    pendingReleaseAt: nextOut[0]?.releaseAfter?.toISOString() ?? null,
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
 * whose phone has not reported steps for `coins.expiryDays` is zeroed with
 * one compensating `refund` row, so the ledger still explains the balance.
 *
 * Idempotent two ways. The row's reference is the sync the window ran from,
 * and the ledger's unique index refuses a second row for it; and the balance
 * is only zeroed when it is still what was read, so a credit that lands
 * between the read and the write keeps its coins. Neither anchor is touched
 * — they are the evidence — so the wallet keeps reporting the full window
 * until it holds coins again (`expiryOf`).
 *
 * `now` is a parameter so a test, or the dev route, can move the calendar.
 */
export async function expireIdleWallets(now = new Date()): Promise<ExpirySweepResult> {
  const config = await getConfig();
  const cutoff = new Date(now.getTime() - config.coins.expiryDays * MS_PER_DAY);
  const title = `Coins expired after ${config.coins.expiryDays} days of inactivity`;

  const idle = await CoinBalanceModel.find(idleBefore(cutoff), ANCHOR_FIELDS).lean();

  const result: ExpirySweepResult = { expired: 0, coins: 0, skipped: 0 };
  for (const bal of idle) {
    // Non-null: `idleBefore` only matches a wallet with one of the two set.
    const since = anchorOf(bal)!;
    const swept = await withTransaction(async session => {
      const zeroed = await CoinBalanceModel.updateOne(
        { _id: bal._id, balanceMc: bal.balanceMc },
        { $set: { balanceMc: 0 } },
        { session },
      );
      if (zeroed.modifiedCount === 0) return 0;
      await CoinLedgerModel.create([{
        _id: newId('led'), userId: bal._id, amountMc: -bal.balanceMc, source: 'refund', title,
        referenceType: 'expiry', referenceId: since.toISOString(), actor: 'system:expiry',
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
      // Told after the fact, keyed to the sync the window ran from, so a
      // re-run that finds nothing to sweep also has nothing to repeat.
      await notify({
        userId: bal._id, topic: 'coins', now,
        title: 'Your coins have expired',
        message: `${fmtCoins(swept)} coins lapsed after ${config.coins.expiryDays} days without a step sync. Open the app to sync your steps and the clock starts fresh.`,
        dedupeKey: `coin-expired:${since.toISOString()}`,
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
 * is running out. Keyed to the sync the window runs from *and* the
 * threshold, so a user gets each warning once per idle stretch — and none at
 * all if their phone reports in between, because the key then names a sync
 * that no longer has a window.
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
    idleBefore(new Date(now.getTime() - oldestIdle * MS_PER_DAY)),
    ANCHOR_FIELDS,
  ).lean();

  for (const bal of candidates) {
    const since = anchorOf(bal)!;
    const daysIdle = Math.floor((now.getTime() - since.getTime()) / MS_PER_DAY);
    const daysLeft = config.coins.expiryDays - daysIdle;
    if (!warnDays.includes(daysLeft)) continue;

    const when = daysLeft === 0 ? 'tonight' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
    const outcome = await notify({
      userId: bal._id, topic: 'coins', now,
      title: `Your coins expire ${when}`,
      message: `You have ${fmtCoins(bal.balanceMc)} coins and your steps have not synced for ${daysIdle} days. Open the app to sync and keep them for another ${config.coins.expiryDays} days.`,
      dedupeKey: `coin-expiry-warn:${since.toISOString()}:${daysLeft}`,
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
