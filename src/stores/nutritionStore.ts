import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { NutritionProfilePatch } from '../services/api/contracts';
import { nutritionApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type {
  FoodEntry,
  MealSlot,
  NutritionGoals,
  NutritionPreferences,
  NutritionProfile,
} from '../types/models';
import { logger } from '../utils/logger';
import { uuid } from '../utils/uuid';
import { mmkvStorage } from './index';

/** How old the profile may be before a screen coming into view asks again. */
export const NUTRITION_STALE_AFTER_MS = 5 * 60_000;

/** What the caller hands over to log something; the rest is filled in here. */
export interface FoodEntryDraft {
  slot: MealSlot;
  name: string;
  calories: number;
  portion?: string;
  proteinG?: number;
  carbsG?: number;
  fatsG?: number;
  fiberG?: number;
  /** ISO-8601. Defaults to now, and decides which day the entry lands on. */
  loggedAt?: string;
}

/** A meal saved or a food taken back here that the server has not confirmed yet. */
export type NutritionChange =
  | { kind: 'add'; entries: FoodEntry[] }
  | { kind: 'remove'; id: string };

interface NutritionState {
  /** The targets and preferences, as the server holds them; null until the first sync. */
  profile: NutritionProfile | null;
  /** Changes waiting for the server, oldest first — persisted, so a meal logged offline is kept. */
  outbox: NutritionChange[];
  /**
   * When the server last confirmed a change. The day and range reads ask
   * again when it moves, so a meal saved on one screen is on the next.
   */
  confirmedAt: string | null;
  syncedAt: string | null;
  isSyncing: boolean;
  /** Why the last exchange failed; cleared by the next that succeeds. */
  syncError: string | null;

  /** Sends what is waiting, then asks for the profile. Resolves either way. */
  hydrateFromServer: () => Promise<void>;
  refreshIfStale: () => Promise<void>;
  /** Logs a whole meal at once — what the add-meal screen saves (RULES N2). */
  addEntries: (entries: FoodEntryDraft[]) => void;
  removeEntry: (id: string) => void;
  setGoals: (goals: Partial<NutritionGoals>) => void;
  setPreferences: (preferences: Partial<NutritionPreferences>) => void;
  /** Sends the waiting changes in order; stops at the first that cannot go yet. */
  flush: () => Promise<void>;
  reset: () => void;
}

/** One flush at a time: two would send the same meal twice. */
let flushing: Promise<void> | null = null;

/** The newest profile save: an older answer arriving late must not undo a newer edit. */
let latestProfileSave = 0;

const isPermanent = (status: number | null) => status === 404 || status === 422;

/** Fills a draft out into an entry with its own id. Null for one with no name (RULES N3). */
function toEntry(draft: FoodEntryDraft): FoodEntry | null {
  const name = draft.name.trim();
  if (name.length === 0) {
    return null;
  }
  return {
    id: uuid(),
    slot: draft.slot,
    name,
    portion: draft.portion ?? '',
    calories: Math.max(0, Math.round(draft.calories)),
    proteinG: Math.max(0, draft.proteinG ?? 0),
    carbsG: Math.max(0, draft.carbsG ?? 0),
    fatsG: Math.max(0, draft.fatsG ?? 0),
    fiberG: Math.max(0, draft.fiberG ?? 0),
    loggedAt: draft.loggedAt ?? new Date().toISOString(),
  };
}

/**
 * The food diary's seam with the server (RULES §N).
 *
 * The diary itself is the server's: days and ranges are read through
 * `useNutritionDay` / `useNutritionDays`. What lives here is the profile —
 * the targets and preferences — and an outbox: a saved meal goes into it
 * and is shown at once over the day it belongs to, then sent with each
 * food's own id, so a retry is the same plate.
 */
export const useNutritionStore = create<NutritionState>()(
  persist(
    (set, get) => {
      const saveProfile = (patch: NutritionProfilePatch) => {
        const current = get().profile;
        if (current === null) {
          return;
        }
        set({
          profile: {
            goals: { ...current.goals, ...patch.goals },
            preferences: { ...current.preferences, ...patch.preferences },
          },
        });
        const save = (latestProfileSave += 1);
        nutritionApi
          .updateProfile(patch, { idempotencyKey: uuid() })
          .then(profile => {
            if (save === latestProfileSave) {
              set({ profile, syncError: null });
            }
          })
          .catch(error => {
            const apiError = toApiError(error);
            logger.warn('nutritionStore', 'Profile save failed', apiError);
            set({ syncError: apiError.message });
            if (save === latestProfileSave) {
              get().hydrateFromServer();
            }
          });
      };

      return {
        profile: null,
        outbox: [],
        confirmedAt: null,
        syncedAt: null,
        isSyncing: false,
        syncError: null,

        hydrateFromServer: async () => {
          if (get().isSyncing) {
            return;
          }
          set({ isSyncing: true });
          await get().flush();
          const save = latestProfileSave;
          try {
            const profile = await nutritionApi.profile();
            if (save === latestProfileSave) {
              set({
                profile,
                syncedAt: new Date().toISOString(),
                syncError: null,
              });
            }
            set({ isSyncing: false });
          } catch (error) {
            const apiError = toApiError(error);
            logger.warn('nutritionStore', 'Nutrition sync failed', apiError);
            set({ isSyncing: false, syncError: apiError.message });
          }
        },

        refreshIfStale: async () => {
          const { syncedAt, isSyncing, hydrateFromServer } = get();
          if (isSyncing) {
            return;
          }
          const age = syncedAt
            ? Date.now() - new Date(syncedAt).getTime()
            : Infinity;
          if (age < NUTRITION_STALE_AFTER_MS) {
            return;
          }
          await hydrateFromServer();
        },

        addEntries: drafts => {
          const entries = drafts
            .map(toEntry)
            .filter((entry): entry is FoodEntry => entry !== null);
          if (entries.length === 0) {
            return;
          }
          set(state => ({
            outbox: [...state.outbox, { kind: 'add', entries }],
          }));
          get().flush();
        },

        removeEntry: id => {
          set(state => {
            // A food still waiting to go is simply not sent.
            const index = state.outbox.findIndex(
              change =>
                change.kind === 'add' &&
                change.entries.some(entry => entry.id === id),
            );
            if (index > 0 || (index === 0 && flushing === null)) {
              const change = state.outbox[index] as Extract<
                NutritionChange,
                { kind: 'add' }
              >;
              const rest = change.entries.filter(entry => entry.id !== id);
              return {
                outbox: state.outbox.flatMap((entry, at) =>
                  at !== index
                    ? [entry]
                    : rest.length > 0
                    ? [{ kind: 'add' as const, entries: rest }]
                    : [],
                ),
              };
            }
            return { outbox: [...state.outbox, { kind: 'remove', id }] };
          });
          get().flush();
        },

        setGoals: goals => saveProfile({ goals }),
        setPreferences: preferences => saveProfile({ preferences }),

        flush: () => {
          if (flushing) {
            return flushing;
          }
          flushing = (async () => {
            try {
              for (;;) {
                const change = get().outbox[0];
                if (change === undefined) {
                  return;
                }
                try {
                  if (change.kind === 'add') {
                    await nutritionApi.log(change.entries, {
                      idempotencyKey: `meal:${change.entries[0].id}`,
                    });
                  } else {
                    await nutritionApi.remove(change.id, {
                      idempotencyKey: `food-remove:${change.id}`,
                    });
                  }
                  set(state => ({
                    outbox: state.outbox.filter(entry => entry !== change),
                    confirmedAt: new Date().toISOString(),
                    syncError: null,
                  }));
                } catch (error) {
                  const apiError = toApiError(error);
                  if (!isPermanent(apiError.status)) {
                    set({ syncError: apiError.message });
                    return;
                  }
                  logger.warn(
                    'nutritionStore',
                    'A food change was refused',
                    apiError,
                  );
                  set(state => ({
                    outbox: state.outbox.filter(entry => entry !== change),
                    confirmedAt: new Date().toISOString(),
                  }));
                }
              }
            } finally {
              flushing = null;
            }
          })();
          return flushing;
        },

        reset: () =>
          set({
            profile: null,
            outbox: [],
            confirmedAt: null,
            syncedAt: null,
            isSyncing: false,
            syncError: null,
          }),
      };
    },
    {
      name: 'vokve.nutrition',
      storage: createJSONStorage(() => mmkvStorage),
      // v4: the server's diary. A v3 store held a diary made on the phone —
      // seeded with a plate nobody ate — and is dropped for the server's.
      version: 4,
      migrate: () => ({
        profile: null,
        outbox: [],
        confirmedAt: null,
        syncedAt: null,
      }),
      partialize: state => ({
        profile: state.profile,
        outbox: state.outbox,
        confirmedAt: state.confirmedAt,
        syncedAt: state.syncedAt,
      }),
    },
  ),
);

export const useNutritionProfile = () => useNutritionStore(s => s.profile);
export const useNutritionGoals = () =>
  useNutritionStore(s => s.profile?.goals ?? null);
export const useNutritionPreferences = () =>
  useNutritionStore(s => s.profile?.preferences ?? null);

export interface MacroTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
}

export interface DayTotals extends MacroTotals {
  date: string;
  /** How many things were logged that day, across every meal. */
  items: number;
}

/** What one day's diary adds up to. */
export function totalsForDay(entries: FoodEntry[], date: string): DayTotals {
  return entries.reduce<DayTotals>(
    (total, entry) => ({
      date,
      items: total.items + 1,
      calories: total.calories + entry.calories,
      proteinG: total.proteinG + entry.proteinG,
      carbsG: total.carbsG + entry.carbsG,
      fatsG: total.fatsG + entry.fatsG,
    }),
    { date, items: 0, calories: 0, proteinG: 0, carbsG: 0, fatsG: 0 },
  );
}

export interface MealSummary {
  slot: MealSlot;
  items: number;
  calories: number;
  /** When the meal started — the first thing logged in it. Null when empty. */
  startedAt: string | null;
  /** The names of what was in it, in the order they were logged. */
  names: string[];
}

/** The order the meals are eaten in, which is the order they are drawn in (RULES N1). */
export const MEAL_ORDER: readonly MealSlot[] = [
  'breakfast',
  'lunch',
  'snack',
  'dinner',
];

/**
 * Each meal's item count, calories and start time, counted from the entries
 * (RULES N5).
 *
 * Every slot is returned, empty ones included: a day with no dinner logged yet
 * still has a dinner row to add food to, and hiding it would hide the control.
 */
export function summariseMeals(entries: FoodEntry[]): MealSummary[] {
  return MEAL_ORDER.map(slot => {
    const meal = entries.filter(entry => entry.slot === slot);

    return {
      slot,
      items: meal.length,
      calories: meal.reduce((sum, entry) => sum + entry.calories, 0),
      startedAt:
        meal.length === 0
          ? null
          : meal
              .map(entry => entry.loggedAt)
              .sort((a, b) => a.localeCompare(b))[0],
      names: meal.map(entry => entry.name),
    };
  });
}
