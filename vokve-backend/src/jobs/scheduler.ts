import { getKV } from '../db/redis.js';
import { logger } from '../lib/logger.js';
import { expireIdleWallets } from '../modules/economy/wallet.service.js';

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

const DAILY_JOBS: readonly DailyJob[] = [
  { name: 'coin-expiry', run: () => expireIdleWallets() },
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

/** Starts the hourly tick and returns what stops it, for shutdown. */
export function startScheduler(): () => void {
  void runDailyJobs();
  const timer = setInterval(() => void runDailyJobs(), TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
