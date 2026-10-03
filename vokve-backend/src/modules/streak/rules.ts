import type { StreakRun } from '../../contracts/index.js';
import { addDays, type IsoDate } from '../../lib/dates.js';

/**
 * The streak's arithmetic (RULES S2, S3, S6), as pure functions over a set
 * of counting days — ported from the client's `streakStore`, whose golden
 * tests are the acceptance suite. Kept apart from the service so anything
 * that needs a figure (the achievements, the profile) can count without
 * pulling in the streak's writes.
 */

const DAY_MS = 86_400_000;

/** Whole days from `a` to `b` (`b` later is positive). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/**
 * The run that ends today — or yesterday, since a streak is not broken until
 * the day it needed is over (RULES S2). Null when neither day counts.
 */
export function currentRunOf(days: ReadonlySet<IsoDate>, today: IsoDate): StreakRun | null {
  const end = days.has(today) ? today : addDays(today, -1);
  if (!days.has(end)) return null;
  let start = end;
  let length = 1;
  while (days.has(addDays(start, -1))) {
    start = addDays(start, -1);
    length += 1;
  }
  return { length, start, end };
}

export function currentStreakOf(days: ReadonlySet<IsoDate>, today: IsoDate): number {
  return currentRunOf(days, today)?.length ?? 0;
}

/** The longest unbroken run on record, or null when nothing is recorded (RULES S3). */
export function longestStreakOf(days: ReadonlySet<IsoDate>): StreakRun | null {
  const sorted = [...days].sort();
  if (sorted.length === 0) return null;

  let best: StreakRun = { length: 1, start: sorted[0], end: sorted[0] };
  let start = sorted[0];
  let length = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (daysBetween(sorted[i - 1], sorted[i]) === 1) {
      length += 1;
    } else {
      start = sorted[i];
      length = 1;
    }
    if (length > best.length) best = { length, start, end: sorted[i] };
  }
  return best;
}

/**
 * The days a restore would cover: from the day after the last run ended up
 * to yesterday (RULES S6). Empty while the streak is alive, and when the
 * last run ended more than `windowDays` ago.
 */
export function restoreGapOf(days: ReadonlySet<IsoDate>, today: IsoDate, windowDays: number): IsoDate[] {
  if (currentStreakOf(days, today) > 0) return [];
  let cursor = addDays(today, -2);
  for (let back = 2; back <= windowDays; back++) {
    if (days.has(cursor)) {
      const gap: IsoDate[] = [];
      for (let d = addDays(cursor, 1); d < today; d = addDays(d, 1)) gap.push(d);
      return gap;
    }
    cursor = addDays(cursor, -1);
  }
  return [];
}

