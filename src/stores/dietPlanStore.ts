import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { dietPlanRotation } from '../constants/seedData';
import type { MealSlot, PlannedItem, PlannedMeal } from '../types/models';
import { fromIsoDate, type IsoDate } from '../utils/date';
import { minutesOf } from './remindersStore';
import { mmkvStorage } from './index';

/** The hour each slot is planned for, when a new meal does not name one. */
const DEFAULT_TIME: Record<MealSlot, string> = {
  breakfast: '08:00',
  lunch: '13:00',
  snack: '17:00',
  dinner: '20:00',
};

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const byTime = (a: PlannedMeal, b: PlannedMeal) =>
  minutesOf(a.time) - minutesOf(b.time);

/**
 * Which day of the rotation a date falls on.
 *
 * Counted from the epoch in whole local days, so the cycle is the same however
 * the user pages through it: walking forward three days and back three lands
 * on the same plan, which a counter advanced per visit would not.
 */
export function rotationIndexOf(date: IsoDate, cycle: number): number {
  const days = Math.floor(fromIsoDate(date).getTime() / 86_400_000);
  return ((days % cycle) + cycle) % cycle;
}

/** The prescribed meals for a date, before anything the user has added. */
export function dietPlanForDate(date: IsoDate): PlannedMeal[] {
  const cycle = dietPlanRotation.length;
  if (cycle === 0) {
    return [];
  }
  return dietPlanRotation[rotationIndexOf(date, cycle)];
}

interface DietPlanState {
  /**
   * Meals the user has added, by date. The rotation is the plan; this is what
   * they changed about a particular day, which is why it is the only part
   * that persists.
   */
  extras: Record<IsoDate, PlannedMeal[]>;

  addMeal: (
    date: IsoDate,
    meal: {
      slot: MealSlot;
      calories: number;
      items: PlannedItem[];
      time?: string;
    },
  ) => void;
  removeMeal: (date: IsoDate, id: string) => void;
  reset: () => void;
}

/**
 * The user's own additions to the diet plan.
 *
 * The rotation itself is not stored: it is the plan the app ships with, and
 * copying it into storage would mean a user who installed in May kept eating
 * May's plan after it was rewritten.
 */
export const useDietPlanStore = create<DietPlanState>()(
  persist(
    set => ({
      extras: {},

      addMeal: (date, { slot, calories, items, time }) =>
        set(state => {
          const kcal = Math.max(0, Math.round(calories));
          if (kcal === 0) {
            return state;
          }

          const meal: PlannedMeal = {
            id: createId(),
            slot,
            time: time ?? DEFAULT_TIME[slot],
            calories: kcal,
            proteinG: 0,
            carbsG: 0,
            fatsG: 0,
            items,
          };

          return {
            extras: {
              ...state.extras,
              [date]: [...(state.extras[date] ?? []), meal],
            },
          };
        }),

      removeMeal: (date, id) =>
        set(state => ({
          extras: {
            ...state.extras,
            [date]: (state.extras[date] ?? []).filter(meal => meal.id !== id),
          },
        })),

      reset: () => set({ extras: {} }),
    }),
    {
      name: 'vokve.dietPlan',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
    },
  ),
);

/** A day's plan: the rotation's meals plus anything added to that date. */
export const usePlanForDate = (date: IsoDate): PlannedMeal[] => {
  const extras = useDietPlanStore(s => s.extras[date]);

  return useMemo(
    () => [...dietPlanForDate(date), ...(extras ?? [])].sort(byTime),
    [date, extras],
  );
};

export interface PlanTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
}

export function totalsOf(meals: PlannedMeal[]): PlanTotals {
  return meals.reduce<PlanTotals>(
    (total, meal) => ({
      calories: total.calories + meal.calories,
      proteinG: total.proteinG + meal.proteinG,
      carbsG: total.carbsG + meal.carbsG,
      fatsG: total.fatsG + meal.fatsG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatsG: 0 },
  );
}

/** What a day's plan adds up to. */
export const usePlanTotals = (date: IsoDate): PlanTotals => {
  const meals = usePlanForDate(date);
  return useMemo(() => totalsOf(meals), [meals]);
};
