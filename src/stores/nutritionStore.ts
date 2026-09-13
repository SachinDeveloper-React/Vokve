import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { seedFoodEntries } from '../constants/seedData';
import { addDays, todayIso } from '../utils/date';
import { dietPlanForDate } from './dietPlanStore';
import type {
  DietType,
  FoodEntry,
  MealPlan,
  MealSlot,
  NutritionGoal,
} from '../types/models';
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

/** How many days of history the app opens with. */
const SEEDED_HISTORY_DAYS = 6;

/**
 * The diary the app starts with: today's plate, and the week before it taken
 * from the diet plan.
 *
 * Derived from the plan rather than seeded row by row, on the premise that a
 * new install has been following it — which is both the cheapest honest story
 * and the one that keeps the history and the plan agreeing with each other.
 * Every entry is a copy, so editing the plan later cannot rewrite what the
 * history says was eaten.
 */
function seedDiary(): Record<string, FoodEntry[]> {
  const diary: Record<string, FoodEntry[]> = { [todayIso()]: seedFoodEntries };

  for (let offset = 1; offset <= SEEDED_HISTORY_DAYS; offset++) {
    const date = addDays(todayIso(), -offset);

    diary[date] = dietPlanForDate(date).map(meal => ({
      id: `seed-${date}-${meal.id}`,
      slot: meal.slot,
      name: meal.items.map(item => item.name).join(', '),
      portion: '',
      calories: meal.calories,
      proteinG: meal.proteinG,
      carbsG: meal.carbsG,
      fatsG: meal.fatsG,
      fiberG: 0,
      loggedAt: `${date}T${meal.time}:00.000Z`,
    }));
  }

  return diary;
}

export interface NutritionGoals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
}

export interface NutritionPreferences {
  dietType: DietType;
  mealPlan: MealPlan;
  goal: NutritionGoal;
}

const DEFAULT_GOALS: NutritionGoals = {
  calories: 2200,
  proteinG: 120,
  carbsG: 300,
  fatsG: 70,
};

const DEFAULT_PREFERENCES: NutritionPreferences = {
  dietType: 'vegetarian',
  mealPlan: 'balanced',
  goal: 'gain_weight',
};

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

interface NutritionState {
  /** Every day's food, keyed by the local date it was eaten on. */
  entriesByDate: Record<string, FoodEntry[]>;
  goals: NutritionGoals;
  preferences: NutritionPreferences;

  addEntry: (entry: FoodEntryDraft) => void;
  /** Logs a whole meal at once — what the add-meal screen saves. */
  addEntries: (entries: FoodEntryDraft[]) => void;
  removeEntry: (id: string) => void;
  setGoals: (goals: Partial<NutritionGoals>) => void;
  setPreferences: (preferences: Partial<NutritionPreferences>) => void;
  reset: () => void;
}

/** The local calendar day a timestamp belongs to. */
function dateOf(loggedAt: string): string {
  const at = new Date(loggedAt);
  if (Number.isNaN(at.getTime())) {
    return today();
  }
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
}

/** Fills a draft out into an entry. Returns null for one with no name. */
function toEntry(draft: FoodEntryDraft): FoodEntry | null {
  const name = draft.name.trim();
  if (name.length === 0) {
    return null;
  }

  return {
    id: createId(),
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
 * Every day's food, the targets it is measured against, and how the user eats.
 *
 * Entries are the only thing stored about a meal: its item count, its calories
 * and the time it started are all counted from them. A meal that carried its
 * own total could be edited apart from the food inside it, and the screen
 * states both within a line of each other.
 *
 * Food is bucketed by the day it was eaten rather than kept as "today's list"
 * with a stored date. The two behave the same at midnight — yesterday's dinner
 * never shows up as this morning's breakfast — but a bucket per day is what
 * lets the add-meal screen log something against the day it actually happened
 * on, which is a thing users do the morning after.
 */
export const useNutritionStore = create<NutritionState>()(
  persist(
    set => ({
      entriesByDate: seedDiary(),
      goals: DEFAULT_GOALS,
      preferences: DEFAULT_PREFERENCES,

      addEntry: draft =>
        set(state => {
          const entry = toEntry(draft);
          if (entry === null) {
            return state;
          }

          const date = dateOf(entry.loggedAt);

          return {
            entriesByDate: {
              ...state.entriesByDate,
              [date]: [...(state.entriesByDate[date] ?? []), entry],
            },
          };
        }),

      addEntries: drafts =>
        set(state => {
          const entries = drafts
            .map(toEntry)
            .filter((entry): entry is FoodEntry => entry !== null);

          if (entries.length === 0) {
            return state;
          }

          // Grouped before writing, so a meal logged across midnight lands on
          // both days rather than all of it on the first one's bucket.
          const next = { ...state.entriesByDate };
          for (const entry of entries) {
            const date = dateOf(entry.loggedAt);
            next[date] = [...(next[date] ?? []), entry];
          }

          return { entriesByDate: next };
        }),

      removeEntry: id =>
        set(state => {
          const next: Record<string, FoodEntry[]> = {};
          for (const [date, entries] of Object.entries(state.entriesByDate)) {
            next[date] = entries.filter(entry => entry.id !== id);
          }
          return { entriesByDate: next };
        }),

      setGoals: goals =>
        set(state => ({ goals: { ...state.goals, ...goals } })),

      setPreferences: preferences =>
        set(state => ({
          preferences: { ...state.preferences, ...preferences },
        })),

      reset: () =>
        set({
          entriesByDate: seedDiary(),
          goals: DEFAULT_GOALS,
          preferences: DEFAULT_PREFERENCES,
        }),
    }),
    {
      name: 'vokve.nutrition',
      storage: createJSONStorage(() => mmkvStorage),
      version: 3,
    },
  ),
);

export const useNutritionGoals = () => useNutritionStore(s => s.goals);
export const useNutritionPreferences = () =>
  useNutritionStore(s => s.preferences);

/** One shared empty array, so a day with no food keeps a stable reference. */
const EMPTY_ENTRIES: FoodEntry[] = [];

/** The food logged on a given day. Defaults to today's. */
export const useFoodEntriesOn = (date: string): FoodEntry[] =>
  useNutritionStore(s => s.entriesByDate[date] ?? EMPTY_ENTRIES);

export const useTodayFoodEntries = (): FoodEntry[] => useFoodEntriesOn(today());

export interface NutritionTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
}

/**
 * Everything eaten today, added up.
 *
 * Memoised over the entries rather than derived in the selector: a fresh
 * object never compares equal to the last one, and the subscriber would
 * re-render on every store read.
 */
export const useNutritionTotals = (): NutritionTotals => {
  const entries = useTodayFoodEntries();

  return useMemo(
    () =>
      entries.reduce<NutritionTotals>(
        (total, entry) => ({
          calories: total.calories + entry.calories,
          proteinG: total.proteinG + entry.proteinG,
          carbsG: total.carbsG + entry.carbsG,
          fatsG: total.fatsG + entry.fatsG,
        }),
        { calories: 0, proteinG: 0, carbsG: 0, fatsG: 0 },
      ),
    [entries],
  );
};

export interface DayTotals extends NutritionTotals {
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

/**
 * A run of days and what each one came to, in the order given.
 *
 * Every date asked for comes back, empty ones included: a history that skipped
 * the days nothing was logged would quietly rewrite a week off as a week that
 * did not happen.
 */
export const useDayTotals = (dates: string[]): DayTotals[] => {
  const entriesByDate = useNutritionStore(s => s.entriesByDate);

  return useMemo(
    () =>
      dates.map(date => totalsForDay(entriesByDate[date] ?? [], date)),
    [dates, entriesByDate],
  );
};

/** The meals of one day, counted the way the day's own card counts them. */
export const useMealSummariesOn = (date: string): MealSummary[] => {
  const entries = useFoodEntriesOn(date);
  return useMemo(() => summariseMeals(entries), [entries]);
};

export interface MealSummary {
  slot: MealSlot;
  items: number;
  calories: number;
  /** When the meal started — the first thing logged in it. Null when empty. */
  startedAt: string | null;
  /** The names of what was in it, in the order they were logged. */
  names: string[];
}

/** The order the meals are eaten in, which is the order they are drawn in. */
export const MEAL_ORDER: readonly MealSlot[] = [
  'breakfast',
  'lunch',
  'snack',
  'dinner',
];

/**
 * Each meal's item count, calories and start time, counted from the entries.
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
      /** What was in it, for a history row that has no space for the items. */
      names: meal.map(entry => entry.name),
    };
  });
}

export const useMealSummaries = (): MealSummary[] => {
  const entries = useTodayFoodEntries();
  return useMemo(() => summariseMeals(entries), [entries]);
};
