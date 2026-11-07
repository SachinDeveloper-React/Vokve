import { describe, expect, it } from 'vitest';
import { ChallengeDefinitionModel } from '../src/modules/challenges/models.js';
import { earnedPeriodsFor } from '../src/modules/economy/earned-for.js';
import { WorkoutModel } from '../src/modules/training/models.js';

/**
 * Which day a ledger row is for (D-92).
 *
 * `createdAt` says when the wallet moved, and for anything that reports
 * late the two are days apart. Four "check completed" rows inside two
 * minutes, all for different days, read as one challenge paying four times
 * — so every screen that draws a row draws the day it is about, from here.
 */
describe('coins: the day a ledger row is for', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const row = (id: string, referenceType: string, referenceId: string) => ({ _id: id, referenceType, referenceId });

  it('reads a day of steps out of its reference', async () => {
    const found = await earnedPeriodsFor([row('a', 'activity_day', '2026-11-02:3')], now);
    expect(found.get('a')).toEqual({ start: '2026-11-02', end: '2026-11-02', label: 'For 2 Nov' });
  });

  it('gives a daily challenge its one day and a weekly one its whole week', async () => {
    await ChallengeDefinitionModel.create([
      { _id: 'ch-check', title: 'check', metric: 'steps', cadence: 'daily', goal: 1_000, rewardCoins: 10 },
      { _id: 'ch-week', title: 'week', metric: 'steps', cadence: 'weekly', goal: 50_000, rewardCoins: 100 },
      { _id: 'ch-month', title: 'month', metric: 'steps', cadence: 'monthly', goal: 200_000, rewardCoins: 500 },
    ]);

    const found = await earnedPeriodsFor(
      [
        row('a', 'challenge', 'ch-check:2026-11-02'),
        row('b', 'challenge', 'ch-week:2026-10-26'),
        row('c', 'challenge', 'ch-month:2026-10-01'),
      ],
      now,
    );
    expect(found.get('a')?.label).toBe('For 2 Nov');
    expect(found.get('b')).toEqual({ start: '2026-10-26', end: '2026-11-01', label: 'For the week of 26 Oct' });
    expect(found.get('c')).toEqual({ start: '2026-10-01', end: '2026-10-31', label: 'For Oct 2026' });
  });

  it('names the week a leaderboard place was won in', async () => {
    const found = await earnedPeriodsFor([row('a', 'leaderboard', '2026-10-26:IN')], now);
    expect(found.get('a')).toEqual({ start: '2026-10-26', end: '2026-11-01', label: 'For the week of 26 Oct' });
  });

  it('follows a reversal back to the day it reverses', async () => {
    await ChallengeDefinitionModel.create({ _id: 'ch-check', title: 'check', metric: 'steps', cadence: 'daily', goal: 1_000, rewardCoins: 10 });
    const found = await earnedPeriodsFor([row('a', 'adjustment', 'reversal:challenge:ch-check:2026-11-02')], now);
    expect(found.get('a')?.label).toBe('For 2 Nov');
  });

  it('reads a workout’s day off the workout', async () => {
    await WorkoutModel.create({
      _id: 'wk-1', userId: 'usr-1', localDay: '2026-10-30', title: 'Push Day',
      startedAt: new Date('2026-10-30T10:00:00Z'), durationMin: 30, caloriesBurned: 200, plausible: true,
    });
    const found = await earnedPeriodsFor([row('a', 'workout', 'wk-1')], now);
    expect(found.get('a')?.label).toBe('For 30 Oct');
  });

  it('carries the year only when it is not this one', async () => {
    const found = await earnedPeriodsFor(
      [row('a', 'activity_day', '2026-11-02:3'), row('b', 'activity_day', '2025-12-31:3')],
      now,
    );
    expect(found.get('a')?.label).toBe('For 2 Nov');
    expect(found.get('b')?.label).toBe('For 31 Dec 2025');
  });

  it('says nothing about a row that is not about a day', async () => {
    const found = await earnedPeriodsFor(
      [
        row('a', 'order', 'ord_1'),
        row('b', 'referral', 'ref_1'),
        row('c', 'achievement', 'a-10k-steps'),
        row('d', 'streak_milestone', '7'),
        row('e', 'manual', 'led_1'),
      ],
      now,
    );
    expect(found.size).toBe(0);
  });

  it('is two reads however many rows are asked about', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(`r${i}`, 'activity_day', `2026-11-0${(i % 9) + 1}:3`));
    const found = await earnedPeriodsFor(rows, now);
    expect(found.size).toBe(50);
  });
});
