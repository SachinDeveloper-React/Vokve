import { useEffect, useMemo, useState } from 'react';
import { nutritionApi } from '../services/api/endpoints';
import {
  summariseMeals,
  totalsForDay,
  useNutritionStore,
  type DayTotals,
  type MealSummary,
} from '../stores/nutritionStore';
import type {
  DietPlanDay,
  DietPlanDaySummary,
  FoodEntry,
  FoodItem,
  NutritionGoals,
} from '../types/models';
import { toIsoDate } from '../utils/date';
import { useServerRead, type Loaded } from './useServerRead';

export interface NutritionDayView {
  /** False until the server has answered for the day. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** In the order they were logged: the server's, less any taken back, with meals on their way. */
  entries: FoodEntry[];
  totals: DayTotals;
  meals: MealSummary[];
  /** The targets the day is measured against, as the server sent them. */
  goals: NutritionGoals | null;
}

/**
 * One day's food (`GET /nutrition/day`), with this phone's unsent changes
 * laid over it — a meal saved a moment ago is on the day before the server
 * has answered. Asked again whenever the server confirms a change.
 */
export function useNutritionDay(date: string): NutritionDayView {
  const confirmedAt = useNutritionStore(s => s.confirmedAt);
  const outbox = useNutritionStore(s => s.outbox);
  const read = useServerRead(
    `nutrition:day:${date}`,
    () => nutritionApi.day(date),
    confirmedAt,
  );
  const { data, loading, error, reload } = read;

  return useMemo(() => {
    const base = data?.entries ?? [];
    const removed = new Set(
      outbox.flatMap(change => (change.kind === 'remove' ? [change.id] : [])),
    );
    const known = new Set(base.map(entry => entry.id));
    const pending = outbox.flatMap(change =>
      change.kind === 'add'
        ? change.entries.filter(
            entry =>
              !known.has(entry.id) &&
              toIsoDate(new Date(entry.loggedAt)) === date,
          )
        : [],
    );
    const entries = [...base, ...pending]
      .filter(entry => !removed.has(entry.id))
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
    return {
      loaded: data !== null,
      loading,
      error,
      reload,
      entries,
      totals: totalsForDay(entries, date),
      meals: summariseMeals(entries),
      goals: data?.goals ?? null,
    };
  }, [data, date, error, loading, outbox, reload]);
}

const span = (dates: readonly string[]) => {
  const sorted = [...dates].sort();
  return { from: sorted[0], to: sorted[sorted.length - 1] };
};

/**
 * What each of `dates` came to (`GET /nutrition/days`), in the order given
 * and every one present — a day nothing was logged on is zeros, not missing.
 */
export function useNutritionDays(
  dates: readonly string[],
): Loaded<DayTotals[]> {
  const confirmedAt = useNutritionStore(s => s.confirmedAt);
  const { from, to } = span(dates);
  const read = useServerRead(
    dates.length > 0 ? `nutrition:days:${from}:${to}` : null,
    () => nutritionApi.days(from, to),
    confirmedAt,
  );
  const days = useMemo(() => {
    if (read.data === null) return null;
    const byDate = new Map(read.data.map(day => [day.date, day]));
    return dates.map(
      (date): DayTotals => byDate.get(date) ?? totalsForDay([], date),
    );
  }, [dates, read.data]);
  return { ...read, data: days };
}

/** The diet plan for a day (`GET /diet-plan`), asked again when the preferences change. */
export function useDietPlan(date: string): Loaded<DietPlanDay> {
  const preferences = useNutritionStore(s => s.profile?.preferences);
  return useServerRead(
    `diet:${date}`,
    () => nutritionApi.plan(date),
    preferences ? JSON.stringify(preferences) : null,
  );
}

/** A run of days' plans in brief (`GET /diet-plan/days`), in the order given. */
export function useDietPlanDays(
  dates: readonly string[],
): Loaded<DietPlanDaySummary[]> {
  const preferences = useNutritionStore(s => s.profile?.preferences);
  const { from, to } = span(dates);
  const read = useServerRead(
    dates.length > 0 ? `diet:days:${from}:${to}` : null,
    () => nutritionApi.planDays(from, to),
    preferences ? JSON.stringify(preferences) : null,
  );
  const days = useMemo(() => {
    if (read.data === null) return null;
    const byDate = new Map(read.data.map(day => [day.date, day]));
    return dates.map(
      date => byDate.get(date) ?? { date, meals: 0, calories: 0 },
    );
  }, [dates, read.data]);
  return { ...read, data: days };
}

/** `value`, once it has stopped changing for `delayMs`. */
function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return settled;
}

/**
 * The food library, searched by the server (`GET /foods?q=`) once typing
 * pauses. An empty query asks nothing.
 */
export function useFoodSearch(query: string): Loaded<FoodItem[]> {
  const term = useSettled(query.trim(), 250);
  return useServerRead(
    term.length > 0 ? `foods:${term.toLowerCase()}` : null,
    () => nutritionApi.searchFoods(term),
  );
}

/** The add-meal screen's shortcuts (`GET /foods/quick-add`). */
export function useQuickAddFoods(): Loaded<FoodItem[]> {
  return useServerRead('foods:quick-add', () => nutritionApi.quickAddFoods());
}
