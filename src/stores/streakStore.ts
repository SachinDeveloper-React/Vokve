import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { seedStreak } from '../constants/seedData';
import { addDays, daysBetween, todayIso, type IsoDate } from '../utils/date';
import { mmkvStorage } from './index';

/** Coins a restore costs. Charged by the screen, through the coins store. */
export const STREAK_RESTORE_COST = 50;

/** A missed run older than this cannot be restored — it is a new start. */
export const RESTORE_WINDOW_DAYS = 7;

export interface StreakRun {
  length: number;
  start: IsoDate;
  end: IsoDate;
}

interface StreakState {
  /** Days with a completed workout, `YYYY-MM-DD`, in no particular order. */
  completedDays: IsoDate[];
  /**
   * Days a freeze or a restore covered. They count towards a streak exactly
   * as a completed day does, but the calendar draws them differently — a
   * user should be able to see which days they actually earned.
   */
  protectedDays: IsoDate[];
  freezesAvailable: number;

  completeToday: () => void;
  /**
   * Spends a freeze on today, so tonight's midnight cannot break the streak.
   * Returns false, and spends nothing, if none are left or today is already
   * covered.
   */
  freezeToday: () => boolean;
  /**
   * Bridges the gap between the last run and today with protected days, so
   * the run continues. Returns false, and changes nothing, when there is no
   * gap to bridge — the coins must not be charged in that case, which is why
   * the caller checks `canRestore` before spending them.
   */
  restore: () => boolean;
  reset: () => void;
}

/** Every day that counts towards a streak, deduplicated. */
function countingDays(state: Pick<StreakState, 'completedDays' | 'protectedDays'>) {
  return new Set([...state.completedDays, ...state.protectedDays]);
}

/**
 * The run that ends today — or yesterday, since a streak is not broken
 * until the day it needed is over.
 */
export function currentStreakOf(
  days: Set<IsoDate>,
  today: IsoDate = todayIso(),
): number {
  let cursor = days.has(today) ? today : addDays(today, -1);
  let length = 0;
  while (days.has(cursor)) {
    length += 1;
    cursor = addDays(cursor, -1);
  }
  return length;
}

/** The longest unbroken run on record, or null when nothing is recorded. */
export function longestStreakOf(days: Set<IsoDate>): StreakRun | null {
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
    if (length > best.length) {
      best = { length, start, end: sorted[i] };
    }
  }
  return best;
}

/**
 * The days a restore would have to cover: from the day after the most
 * recent run ended, up to yesterday. Empty when the streak is alive, or when
 * the last run is too old to be worth reviving.
 */
export function restoreGapOf(
  days: Set<IsoDate>,
  today: IsoDate = todayIso(),
): IsoDate[] {
  if (currentStreakOf(days, today) > 0) return [];

  // Walk back from the day before yesterday to find where the last run ended.
  let cursor = addDays(today, -2);
  for (let back = 2; back <= RESTORE_WINDOW_DAYS; back++) {
    if (days.has(cursor)) {
      const gap: IsoDate[] = [];
      for (let d = addDays(cursor, 1); d < today; d = addDays(d, 1)) {
        gap.push(d);
      }
      return gap;
    }
    cursor = addDays(cursor, -1);
  }
  return [];
}

/**
 * Consecutive days of training.
 *
 * Both streak figures are derived from the day list on every read rather than
 * stored beside it, so a day added or removed can never leave a stale count
 * behind. The user record's `streakDays` is the server's number for the same
 * thing; this store is the client's, and the one every screen reads.
 */
export const useStreakStore = create<StreakState>()(
  persist(
    (set, get) => ({
      completedDays: seedStreak.completedDays,
      protectedDays: seedStreak.protectedDays,
      freezesAvailable: seedStreak.freezesAvailable,

      completeToday: () =>
        set(state => {
          const today = todayIso();
          if (state.completedDays.includes(today)) return state;
          return { completedDays: [...state.completedDays, today] };
        }),

      freezeToday: () => {
        const state = get();
        const today = todayIso();
        if (state.freezesAvailable <= 0 || countingDays(state).has(today)) {
          return false;
        }
        set({
          freezesAvailable: state.freezesAvailable - 1,
          protectedDays: [...state.protectedDays, today],
        });
        return true;
      },

      restore: () => {
        const state = get();
        const gap = restoreGapOf(countingDays(state));
        if (gap.length === 0) return false;
        set({ protectedDays: [...state.protectedDays, ...gap] });
        return true;
      },

      reset: () =>
        set({
          completedDays: seedStreak.completedDays,
          protectedDays: seedStreak.protectedDays,
          freezesAvailable: seedStreak.freezesAvailable,
        }),
    }),
    {
      name: 'vokve.streak',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: state => ({
        completedDays: state.completedDays,
        protectedDays: state.protectedDays,
        freezesAvailable: state.freezesAvailable,
      }),
    },
  ),
);

// ─── Selectors ───────────────────────────────────────────────────────────────
//
// Each subscribes to the raw day lists and derives with `useMemo`, the way the
// coin summaries do: a selector that built a fresh object on every call would
// never compare equal to its last result and would re-render without end.

export const useCompletedDays = () => useStreakStore(s => s.completedDays);
export const useProtectedDays = () => useStreakStore(s => s.protectedDays);
export const useFreezesAvailable = () => useStreakStore(s => s.freezesAvailable);

/** Every day that counts, as a set the calendar and the figures share. */
export const useCountingDays = (): Set<IsoDate> => {
  const completed = useCompletedDays();
  const protectedDays = useProtectedDays();
  return useMemo(
    () => countingDays({ completedDays: completed, protectedDays }),
    [completed, protectedDays],
  );
};

export const useCurrentStreak = (): number => {
  const days = useCountingDays();
  return useMemo(() => currentStreakOf(days), [days]);
};

export const useLongestStreak = (): StreakRun | null => {
  const days = useCountingDays();
  return useMemo(() => longestStreakOf(days), [days]);
};

export const useCanRestore = (): boolean => {
  const days = useCountingDays();
  return useMemo(() => restoreGapOf(days).length > 0, [days]);
};

/** Whether today is already covered — by a workout or a freeze. */
export const useIsTodayCovered = (): boolean => {
  const days = useCountingDays();
  return useMemo(() => days.has(todayIso()), [days]);
};
