import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { HydrationEntry } from '../types/models';
import { mmkvStorage } from './index';

/** Local calendar date, `YYYY-MM-DD`. */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface HydrationState {
  /** The day the count and the log below belong to. */
  date: string;
  consumedMl: number;
  /** Today's drinks, newest first. */
  entries: HydrationEntry[];

  add: (ml: number) => void;
  /**
   * Takes an amount back off the total, newest drink of that size first.
   *
   * Kept alongside `remove` because they answer different questions: this one
   * is "I did not drink that 500", named by amount, where `remove` is "delete
   * this row of the log", named by id.
   */
  undo: (ml: number) => void;
  /** Deletes one logged drink and takes its millilitres off the total. */
  remove: (id: string) => void;
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
 *
 * The total is stored beside the log rather than added up from it on every
 * read, and every mutation writes both together — the pattern the coin ledger
 * uses. That is what stops the figure at the top of the screen and the rows
 * underneath it from ever disagreeing.
 */
export const useHydrationStore = create<HydrationState>()(
  persist(
    (set, get) => ({
      date: today(),
      consumedMl: 0,
      entries: [],

      add: ml =>
        set(state => {
          const amount = Math.round(ml);
          if (amount <= 0) {
            return state;
          }

          const now = today();
          const rolled = state.date !== now;
          const entry: HydrationEntry = {
            id: createId(),
            ml: amount,
            at: new Date().toISOString(),
          };

          return {
            date: now,
            consumedMl: (rolled ? 0 : state.consumedMl) + amount,
            entries: [entry, ...(rolled ? [] : state.entries)],
          };
        }),

      undo: ml =>
        set(state => {
          const now = today();
          const rolled = state.date !== now;
          const base = rolled ? 0 : state.consumedMl;
          const entries = rolled ? [] : state.entries;
          const amount = Math.round(ml);

          // The log only has a row to drop if one of that size was logged
          // today; the total still comes down either way, which is what an
          // undo of a figure the log never saw has to mean.
          const index = entries.findIndex(entry => entry.ml === amount);

          return {
            date: now,
            consumedMl: Math.max(0, base - amount),
            entries:
              index === -1
                ? entries
                : [...entries.slice(0, index), ...entries.slice(index + 1)],
          };
        }),

      remove: id =>
        set(state => {
          const now = today();
          if (state.date !== now) {
            return { date: now, consumedMl: 0, entries: [] };
          }

          const target = state.entries.find(entry => entry.id === id);
          if (target === undefined) {
            return state;
          }

          return {
            date: now,
            consumedMl: Math.max(0, state.consumedMl - target.ml),
            entries: state.entries.filter(entry => entry.id !== id),
          };
        }),

      reset: () => set({ date: today(), consumedMl: 0, entries: [] }),

      todayMl: () => {
        const state = get();
        return state.date === today() ? state.consumedMl : 0;
      },
    }),
    {
      name: 'vokve.hydration',
      storage: createJSONStorage(() => mmkvStorage),
      version: 2,
      partialize: state => ({
        date: state.date,
        consumedMl: state.consumedMl,
        entries: state.entries,
      }),
    },
  ),
);

/**
 * Subscribes to today's total. Reads the fields rather than calling the
 * store's own selector so the component re-renders when they change.
 */
export const useTodayHydration = () =>
  useHydrationStore(state => (state.date === today() ? state.consumedMl : 0));

/**
 * Today's drinks, newest first — empty once the date has rolled over.
 *
 * Returns the stored array itself rather than a filtered copy: a fresh array
 * on every read never compares equal to the last one, and the subscriber would
 * re-render on every store change.
 */
export const useTodayHydrationEntries = (): HydrationEntry[] => {
  const date = useHydrationStore(state => state.date);
  const entries = useHydrationStore(state => state.entries);
  return date === today() ? entries : EMPTY_ENTRIES;
};

/** One shared empty array, for the same referential-stability reason. */
const EMPTY_ENTRIES: HydrationEntry[] = [];
