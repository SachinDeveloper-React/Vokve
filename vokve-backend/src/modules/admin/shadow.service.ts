import { getConfig } from '../../config/remote.js';
import { addDays, localDayOf } from '../../lib/dates.js';
import { ActivityDailyModel } from '../activity/models.js';

/**
 * What flipping ⚙ `coins.steps.enabled` would cost, read off the days
 * already scored (D-05, RULES E14).
 *
 * Steps are ingested and scored from the first release, but nothing is
 * minted: `coins.steps.enabled` is off through Phase 2 on purpose. The
 * decision to turn it on is not a code change, it is an answer to two
 * questions this report exists to answer from real days.
 *
 * **Does verification pay out fairly?** `verifiedShare` is the share of
 * shown steps that were verified — the number a member feels as "I walked
 * 10,000 and got paid for 6,000". Sweatcoin's own published figure is about
 * 65%; much below that and the rate is wrong, or a layer is too harsh, and
 * the time to find out is before anybody has been paid, because a coin that
 * has been minted cannot be taken back.
 *
 * **What would it cost?** `coins` is what the current rate and ceilings
 * would have held, day by day. Approximate in one way worth knowing: every
 * day is capped at the *normal* tier's step ceiling rather than at each
 * member's own tier, so an account on `watch` is costed slightly high. The
 * per-source and daily coin caps are applied as the economy would apply
 * them, which is where the real ceiling bites.
 */
export interface ShadowDay {
  localDay: string;
  /** Accounts with a scored day. */
  users: number;
  days: number;
  steps: number;
  verifiedSteps: number;
  /** Days the layers verified, and days they did not (RULES A20). */
  verifiedDays: number;
  unverifiedDays: number;
  /** Coins the day would have held, at today's rate and ceilings. */
  coins: number;
}

export interface ShadowReport {
  from: string;
  to: string;
  /** The knobs the figures below were worked out with. */
  rate: {
    enabled: boolean;
    unitSteps: number;
    coinsPerUnit: number;
    /** Coins per 1,000 verified steps — the rate as a product person reads it. */
    per1000: number;
    stepCap: number;
    sourceCap: number;
    dailyCap: number;
  };
  totals: {
    users: number;
    days: number;
    steps: number;
    verifiedSteps: number;
    /** `verifiedSteps / steps`, 0–1. The number to compare with 0.65. */
    verifiedShare: number;
    verifiedDays: number;
    unverifiedDays: number;
    coins: number;
    /** Coins per account per day over the window — the run rate to budget from. */
    coinsPerUserDay: number;
  };
  byDay: ShadowDay[];
}

export async function shadowReport(days: number, timeZone?: string): Promise<ShadowReport> {
  const config = await getConfig();
  const { unitSteps, coinsPerUnit, enabled } = config.coins.steps;
  const stepCap = config.trust.stepCaps.normal;
  const sourceCap = config.coins.sourceCaps.steps;
  const dailyCap = config.coins.dailyCap;
  const ceiling = Math.min(sourceCap, dailyCap);

  const to = localDayOf(new Date(), timeZone ?? config.locale.timezone);
  const from = addDays(to, -(days - 1));

  const rows = await ActivityDailyModel.find(
    { localDay: { $gte: from, $lte: to } },
    { userId: 1, localDay: 1, steps: 1, verifiedSteps: 1, verified: 1 },
  ).lean();

  /** One day's worth of step coins, as `creditStepsForDay` would work it out. */
  const coinsFor = (verifiedSteps: number) =>
    Math.min(ceiling, Math.floor(Math.min(verifiedSteps, stepCap) / unitSteps) * coinsPerUnit);

  const byDay = new Map<string, ShadowDay & { seen: Set<string> }>();
  const everyone = new Set<string>();
  for (const row of rows) {
    const day =
      byDay.get(row.localDay) ??
      {
        localDay: row.localDay, users: 0, days: 0, steps: 0, verifiedSteps: 0,
        verifiedDays: 0, unverifiedDays: 0, coins: 0, seen: new Set<string>(),
      };
    day.seen.add(row.userId);
    everyone.add(row.userId);
    day.days += 1;
    day.steps += row.steps ?? 0;
    day.verifiedSteps += row.verifiedSteps ?? 0;
    if (row.verified) day.verifiedDays += 1;
    else day.unverifiedDays += 1;
    day.coins += coinsFor(row.verifiedSteps ?? 0);
    byDay.set(row.localDay, day);
  }

  const round = (n: number) => Math.round(n * 1000) / 1000;
  const series = [...byDay.values()]
    .sort((a, b) => a.localDay.localeCompare(b.localDay))
    .map(({ seen, ...day }) => ({ ...day, users: seen.size, coins: round(day.coins) }));

  const totalSteps = series.reduce((sum, day) => sum + day.steps, 0);
  const totalVerified = series.reduce((sum, day) => sum + day.verifiedSteps, 0);
  const totalDays = series.reduce((sum, day) => sum + day.days, 0);
  const totalCoins = series.reduce((sum, day) => sum + day.coins, 0);

  return {
    from,
    to,
    rate: {
      enabled, unitSteps, coinsPerUnit,
      per1000: round((1000 / unitSteps) * coinsPerUnit),
      stepCap, sourceCap, dailyCap,
    },
    totals: {
      users: everyone.size,
      days: totalDays,
      steps: totalSteps,
      verifiedSteps: totalVerified,
      verifiedShare: totalSteps > 0 ? round(totalVerified / totalSteps) : 0,
      verifiedDays: series.reduce((sum, day) => sum + day.verifiedDays, 0),
      unverifiedDays: series.reduce((sum, day) => sum + day.unverifiedDays, 0),
      coins: round(totalCoins),
      coinsPerUserDay: totalDays > 0 ? round(totalCoins / totalDays) : 0,
    },
    byDay: series,
  };
}
