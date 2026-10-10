/**
 * Whether a drink about to be logged is believable (RULES Y1b).
 *
 * The failure being prevented is specific: a user taps +1 L a dozen times,
 * the day reads 15 L, and the average, the goal-hit rate and the streak are
 * wrong for a month afterwards. The second failure is real rather than
 * cosmetic — drinking much faster than kidneys can clear is harmful — so the
 * rate is checked on its own and asked about first.
 *
 * What is checked here is the shape of the answer: refuse beats ask, the
 * rate beats the total, only one question is ever raised, and a genuine
 * athlete's six-litre day is never made impossible.
 *
 * @format
 */

import {
  checkWaterAdd,
  litres,
  recentMl,
  type WaterState,
} from '../src/services/hydrationGuard';
import { TEST_WATER_LIMITS } from './helpers/hydration';
import type { HydrationEntry } from '../src/types/models';

const NOW = new Date(2026, 9, 14, 14, 0, 0, 0);

/** A drink `minutesAgo` before the fixed instant. */
const drink = (ml: number, minutesAgo: number): HydrationEntry => ({
  id: `d-${ml}-${minutesAgo}`,
  ml,
  at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
});

const state = (overrides: Partial<WaterState> = {}): WaterState => ({
  consumedMl: 0,
  entries: [],
  limits: TEST_WATER_LIMITS,
  ...overrides,
});

const check = (ml: number, overrides: Partial<WaterState> = {}) =>
  checkWaterAdd(ml, state(overrides), NOW);

/** The verdict's wording — empty for an `ok`, which carries none. */
const why = (ml: number, overrides: Partial<WaterState> = {}): string => {
  const verdict = check(ml, overrides);
  return verdict.kind === 'ok' ? '' : verdict.message;
};

describe('reading amounts the way a person says them', () => {
  test('litres above a litre, millilitres below', () => {
    expect(litres(250)).toBe('250 ml');
    expect(litres(1000)).toBe('1.0 L');
    expect(litres(6400)).toBe('6.4 L');
  });

  test('the rolling window counts only what is inside it', () => {
    const entries = [drink(500, 10), drink(500, 30), drink(500, 90)];

    // The 90-minute-old glass is outside the hour.
    expect(recentMl(entries, 60, NOW)).toBe(1000);
    expect(recentMl(entries, 120, NOW)).toBe(1500);
  });

  test('a drink with an unreadable time is not counted as recent', () => {
    const entries: HydrationEntry[] = [{ id: 'bad', ml: 900, at: 'not a date' }];

    // Better to under-count the window than to refuse on a parse failure.
    expect(recentMl(entries, 60, NOW)).toBe(0);
  });
});

describe('an ordinary day is never in the way', () => {
  test('a glass on an empty day just logs', () => {
    expect(check(250)).toEqual({ kind: 'ok' });
  });

  test('a normal day of sipping never raises a question', () => {
    // 2.5 L over the day, spread out: the commonest case there is.
    const entries = [0, 1, 2, 3, 4].map((n, i) => drink(500, 60 * (i + 2)));
    expect(check(500, { consumedMl: 2500, entries })).toEqual({ kind: 'ok' });
  });
});

describe('a single drink has its own bounds', () => {
  test('too small and too large are refused outright', () => {
    expect(check(5).kind).toBe('refuse');
    expect(check(4000).kind).toBe('refuse');
    expect(why(4000)).toContain('3.0 L');
  });

  test('the bounds themselves are loggable', () => {
    expect(check(TEST_WATER_LIMITS.minMl).kind).toBe('ok');
    // The largest single drink is three litres in one go, which is three
    // times what kidneys clear in an hour — so it is allowed, and asked
    // about. Refusing it would be wrong; waving it through would be worse.
    expect(check(TEST_WATER_LIMITS.maxMl).kind).toBe('confirm');
    expect(why(TEST_WATER_LIMITS.maxMl)).toContain('kidneys');
  });
});

describe('the day has a ceiling', () => {
  test('a drink that would cross it is refused, and says what is left', () => {
    expect(check(500, { consumedMl: 9800 }).kind).toBe('refuse');
    // Something the user can act on, rather than "invalid".
    expect(why(500, { consumedMl: 9800 })).toContain('200 ml');
  });

  test('at the ceiling it stops offering a smaller glass and suggests a doctor', () => {
    expect(check(250, { consumedMl: 10000 }).kind).toBe('refuse');
    expect(why(250, { consumedMl: 10000 })).toContain('doctor');
    expect(why(250, { consumedMl: 10000 })).not.toContain('you can still log');
  });

  test('the drink that lands exactly on the ceiling is allowed', () => {
    // Refusing it would make the stated limit a lie.
    expect(check(1000, { consumedMl: 9000 }).kind).not.toBe('refuse');
  });
});

describe('a high day is asked about, not refused', () => {
  test('crossing the ask threshold raises a question naming the total', () => {
    // An endurance athlete in summer really does drink this much, so the
    // answer is a question, not a refusal.
    expect(check(500, { consumedMl: 4800 }).kind).toBe('confirm');
    expect(why(500, { consumedMl: 4800 })).toContain('5.3 L');
  });

  test('below the threshold nothing is asked', () => {
    expect(check(200, { consumedMl: 4700 }).kind).toBe('ok');
  });

  test('an athlete can still reach six litres, one confirmation at a time', () => {
    expect(check(1000, { consumedMl: 5500 }).kind).toBe('confirm');
  });
});

describe('the rate is the question with medicine behind it', () => {
  test('a litre and a half inside the hour is asked about', () => {
    const entries = [drink(1000, 20)];

    expect(check(600, { consumedMl: 1000, entries }).kind).toBe('confirm');
    expect(why(600, { consumedMl: 1000, entries })).toContain('1.6 L');
    expect(why(600, { consumedMl: 1000, entries })).toContain('kidneys');
  });

  test('the same water spread over hours is not', () => {
    const entries = [drink(1000, 180)];
    expect(check(600, { consumedMl: 1000, entries }).kind).toBe('ok');
  });

  test('it is asked before the daily total, so only one fact is raised', () => {
    // Both would fire: a high day, and the last of it drunk fast.
    const entries = [drink(1000, 15)];

    expect(check(900, { consumedMl: 5200, entries }).kind).toBe('confirm');
    expect(why(900, { consumedMl: 5200, entries })).toContain('kidneys');
    expect(why(900, { consumedMl: 5200, entries })).not.toContain('Tap Log water');
  });

  test('but a refusal still outranks both', () => {
    const entries = [drink(1000, 15)];

    // No point asking about a drink that cannot be logged.
    expect(check(900, { consumedMl: 9900, entries }).kind).toBe('refuse');
  });

  test('the hourly limit itself is not over it', () => {
    const entries = [drink(500, 10)];
    expect(check(500, { consumedMl: 500, entries }).kind).toBe('ok');
  });
});

describe('the limits are the server’s, not the app’s', () => {
  test('a server that moves a threshold moves the behaviour with it', () => {
    const strict = {
      ...TEST_WATER_LIMITS,
      confirmAboveMl: 2000,
      maxDailyMl: 3000,
    };

    // Nothing in the app hard-codes 5 L or 10 L: the same tap is asked
    // about, then refused, purely because the server said so.
    expect(checkWaterAdd(500, { consumedMl: 1800, entries: [], limits: strict }, NOW).kind).toBe(
      'confirm',
    );
    expect(checkWaterAdd(500, { consumedMl: 2800, entries: [], limits: strict }, NOW).kind).toBe(
      'refuse',
    );
  });
});
