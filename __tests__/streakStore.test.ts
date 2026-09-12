/**
 * A streak is arithmetic over a list of days, and every figure the streak
 * screen shows falls out of it — so the checks here are about the edges of
 * that arithmetic: that a streak survives until the day it needs is over,
 * that the record is found across a gap, that a restore only bridges a gap
 * that exists, and that a freeze cannot be spent on a day already earned.
 *
 * @format
 */

import {
  currentStreakOf,
  longestStreakOf,
  restoreGapOf,
  useStreakStore,
} from '../src/stores/streakStore';
import { addDays } from '../src/utils/date';

const TODAY = '2025-05-26';
const d = (daysAgo: number) => addDays(TODAY, -daysAgo);
const run = (from: number, to: number) =>
  Array.from({ length: from - to + 1 }, (_, i) => d(from - i));

describe('currentStreakOf', () => {
  test('counts back from today when today is done', () => {
    expect(currentStreakOf(new Set(run(6, 0)), TODAY)).toBe(7);
  });

  test('is still alive when only today is missing', () => {
    // The day is not over: yesterday's run has not been broken yet.
    expect(currentStreakOf(new Set(run(6, 1)), TODAY)).toBe(6);
  });

  test('is broken once yesterday is missed', () => {
    expect(currentStreakOf(new Set(run(8, 2)), TODAY)).toBe(0);
  });

  test('is zero with nothing recorded', () => {
    expect(currentStreakOf(new Set(), TODAY)).toBe(0);
  });
});

describe('longestStreakOf', () => {
  test('finds the record across a gap, with its dates', () => {
    const days = new Set([...run(25, 11), ...run(6, 0)]);

    expect(longestStreakOf(days)).toEqual({
      length: 15,
      start: d(25),
      end: d(11),
    });
  });

  test('a single day is a run of one', () => {
    expect(longestStreakOf(new Set([TODAY]))).toEqual({
      length: 1,
      start: TODAY,
      end: TODAY,
    });
  });

  test('is null with nothing recorded', () => {
    expect(longestStreakOf(new Set())).toBeNull();
  });

  test('order of the list does not matter', () => {
    const shuffled = new Set([d(0), d(2), d(1)]);
    expect(longestStreakOf(shuffled)?.length).toBe(3);
  });
});

describe('restoreGapOf', () => {
  test('is empty while the streak is alive', () => {
    expect(restoreGapOf(new Set(run(6, 0)), TODAY)).toEqual([]);
  });

  test('is the missed days between the last run and today', () => {
    // Ran up to three days ago, missed the two since.
    expect(restoreGapOf(new Set(run(10, 3)), TODAY)).toEqual([d(2), d(1)]);
  });

  test('gives up on a run that ended too long ago', () => {
    expect(restoreGapOf(new Set(run(20, 12)), TODAY)).toEqual([]);
  });
});

describe('useStreakStore', () => {
  beforeEach(() => {
    useStreakStore.setState({
      completedDays: [],
      protectedDays: [],
      freezesAvailable: 1,
    });
  });

  test('a freeze covers today and is used up', () => {
    expect(useStreakStore.getState().freezeToday()).toBe(true);

    const state = useStreakStore.getState();
    expect(state.freezesAvailable).toBe(0);
    expect(state.protectedDays).toHaveLength(1);
  });

  test('a freeze is refused when none are left', () => {
    useStreakStore.setState({ freezesAvailable: 0 });

    expect(useStreakStore.getState().freezeToday()).toBe(false);
    expect(useStreakStore.getState().protectedDays).toEqual([]);
  });

  test('a freeze is not spent on a day already earned', () => {
    useStreakStore.getState().completeToday();

    expect(useStreakStore.getState().freezeToday()).toBe(false);
    expect(useStreakStore.getState().freezesAvailable).toBe(1);
  });

  test('completing today twice records it once', () => {
    useStreakStore.getState().completeToday();
    useStreakStore.getState().completeToday();

    expect(useStreakStore.getState().completedDays).toHaveLength(1);
  });

  test('a restore changes nothing when there is no gap', () => {
    expect(useStreakStore.getState().restore()).toBe(false);
    expect(useStreakStore.getState().protectedDays).toEqual([]);
  });
});
