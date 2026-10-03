import { getKV } from '../db/redis.js';
import { logger } from '../lib/logger.js';
import { purgeScheduledDeletions } from '../modules/account/service.js';
import { expireUnpaidOrders } from '../modules/commerce/service.js';
import { releaseDueHolds } from '../modules/economy/holds.service.js';
import { expireIdleWallets, warnExpiringWallets } from '../modules/economy/wallet.service.js';
import { flushDeferredPushes } from '../modules/notifications/service.js';
import { warnStreaksAtRisk } from '../modules/streak/service.js';
import { closeDueWeeks } from '../modules/leaderboard/service.js';

/**
 * The daily jobs (BACKEND §9), run from inside the API process.
 *
 * No queue and no cron daemon yet: the app is one process on one box, and a
 * scheduler that needs a second service to exist would mean the sweep never
 * runs at all. Each job claims a per-day key in the KV before it runs, so two
 * instances behind a load balancer cannot both sweep the same night — the
 * loser sees the key and moves on. The jobs are idempotent regardless (the
 * expiry sweep refuses to zero a wallet twice), so a claim that leaks is a
 * wasted run, never a double one.
 *
 * Checked hourly rather than scheduled for midnight: a process that starts
 * at 00:05 would otherwise wait a day for its first sweep.
 */
const TICK_MS = 60 * 60 * 1000;
const CLAIM_TTL_SECONDS = 26 * 60 * 60;

interface DailyJob {
  name: string;
  run: () => Promise<unknown>;
}

/**
 * In order: the warnings go out before the sweep, so a wallet on its last
 * day is told "tonight" rather than being emptied without a word.
 */
const DAILY_JOBS: readonly DailyJob[] = [
  { name: 'coin-expiry-warn', run: () => warnExpiringWallets() },
  { name: 'coin-expiry', run: () => expireIdleWallets() },
  { name: 'account-purge', run: () => purgeScheduledDeletions() },
];

/**
 * Every tick, unclaimed: each is idempotent over its own rows, and running
 * on two instances at once only means the work is split, not doubled.
 */
const HOURLY_JOBS: readonly DailyJob[] = [
  { name: 'flush-deferred-pushes', run: () => flushDeferredPushes() },
  { name: 'expire-unpaid-orders', run: () => expireUnpaidOrders() },
  // Step coins out of escrow once their window has passed (RULES E15). A
  // hold is moved by a conditional update, so two instances split the work.
  { name: 'release-holds', run: () => releaseDueHolds() },
  // The evening nudge for a streak not yet covered today (RULES S10): each
  // user in the hour that is 19:00 for them, told once a day.
  { name: 'streak-at-risk', run: () => warnStreaksAtRisk() },
  // Last week's board, frozen and paid a few hours into Monday in each
  // country's zone (RULES L6, L10). A week already closed is skipped.
  { name: 'leaderboard-close', run: () => closeDueWeeks() },
];

/** `YYYY-MM-DD` in UTC — the calendar the claim keys live on. */
function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function runDailyJobs(now = new Date()): Promise<void> {
  const day = utcDay(now);
  for (const job of DAILY_JOBS) {
    const claimed = await getKV().setIfAbsent(
      `jobs:${job.name}:${day}`,
      CLAIM_TTL_SECONDS,
    );
    if (!claimed) continue;
    try {
      const result = await job.run();
      logger.info({ job: job.name, day, result }, 'job.ran');
    } catch (err) {
      // Release the claim so the next tick tries again today rather than tomorrow.
      await getKV().del(`jobs:${job.name}:${day}`);
      logger.error({ err, job: job.name, day }, 'job.failed');
    }
  }
}

export async function runHourlyJobs(now = new Date()): Promise<void> {
  for (const job of HOURLY_JOBS) {
    try {
      await job.run();
    } catch (err) {
      logger.error({ err, job: job.name, at: now }, 'job.failed');
    }
  }
}

async function tick(): Promise<void> {
  await runHourlyJobs();
  await runDailyJobs();
}

/** Starts the hourly tick and returns what stops it, for shutdown. */
export function startScheduler(): () => void {
  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
