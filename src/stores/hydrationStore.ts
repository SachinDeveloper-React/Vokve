import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvStorage } from './index';

/** Local calendar date, `YYYY-MM-DD`. */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

interface HydrationState {
  /** The day the count below belongs to. */
  date: string;
  consumedMl: number;

  add: (ml: number) => void;
  undo: (ml: number) => void;
  reset: () => void;
  /** Millilitres logged today, zero once the date has rolled over. */
  todayMl: () => number;
}

/**
 * Water logged today.
 *
 * The stored date is what makes the rollover work: the count is persisted with
 * the day it belongs to and is treated as zero once that day has passed, so
 * yesterday's total never appears as this morning's progress. Clearing on a
 * timer instead would miss the rollover whenever the app was not running.
 */
export const useHydrationStore = create<HydrationState>()(
  persist(
    (set, get) => ({
      date: today(),
      consumedMl: 0,

      add: ml =>
        set(state => {
          const now = today();
          const base = state.date === now ? state.consumedMl : 0;
          return { date: now, consumedMl: Math.max(0, base + ml) };
        }),

      undo: ml =>
        set(state => {
          const now = today();
          const base = state.date === now ? state.consumedMl : 0;
          return { date: now, consumedMl: Math.max(0, base - ml) };
        }),

      reset: () => set({ date: today(), consumedMl: 0 }),

      todayMl: () => {
        const state = get();
        return state.date === today() ? state.consumedMl : 0;
      },
    }),
    {
      name: 'vokve.hydration',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: state => ({ date: state.date, consumedMl: state.consumedMl }),
    },
  ),
);

/**
 * Subscribes to today's total. Reads the fields rather than calling the
 * store's own selector so the component re-renders when they change.
 */
export const useTodayHydration = () =>
  useHydrationStore(state =>
    state.date === today() ? state.consumedMl : 0,
  );
