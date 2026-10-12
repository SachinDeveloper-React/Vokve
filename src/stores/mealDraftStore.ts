import { create } from 'zustand';
import type { FoodItem } from '../types/models';

/** One row of the meal being assembled, with a key of its own. */
export interface DraftFood {
  /** So two helpings of the same food can be taken off separately. */
  key: string;
  name: string;
  portion: string;
  emoji: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
  fiberG: number;
}

/** What a food added by hand carries; the rest is filled in here. */
export interface CustomDraftFood {
  name: string;
  portion: string;
  emoji?: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
  fiberG: number;
}

interface MealDraftState {
  /** In the order they were added. Nothing here has reached the diary. */
  foods: DraftFood[];
  /** Adds a food from the library, the search or the quick-add row. */
  add: (item: FoodItem) => void;
  addCustom: (food: CustomDraftFood) => void;
  remove: (key: string) => void;
  /** Empties the draft — what opening the Add Meal screen does. */
  clear: () => void;
}

let count = 0;
const nextKey = () => {
  count += 1;
  return `draft-${count}`;
};

/**
 * The meal being assembled, before Save Meal sends it (RULES N2).
 *
 * A store rather than the Add Meal screen's own state, because two screens
 * now add to one meal: the Add Meal screen itself and the food library it
 * opens. Passing the picks back through navigation params would make the
 * library's work depend on a screen it cannot see, and a user who added six
 * foods and tapped Back would lose them.
 *
 * Deliberately **not persisted**. An unsaved meal is a decision in progress,
 * not a record; the diary's own outbox (`nutritionStore`) is what survives a
 * restart, and it only ever holds meals the user actually saved. The Add Meal
 * screen clears this on the way in, so a meal abandoned yesterday is not
 * sitting in tomorrow's breakfast.
 */
export const useMealDraftStore = create<MealDraftState>()((set, get) => ({
  foods: [],

  add: item =>
    set(state => ({
      foods: [
        ...state.foods,
        {
          key: nextKey(),
          name: item.name,
          portion: item.portion,
          emoji: item.emoji,
          calories: item.calories,
          proteinG: item.proteinG,
          carbsG: item.carbsG,
          fatsG: item.fatsG,
          fiberG: item.fiberG,
        },
      ],
    })),

  addCustom: food =>
    set(state => ({
      foods: [
        ...state.foods,
        { key: nextKey(), emoji: food.emoji ?? '🍽️', ...food },
      ],
    })),

  remove: key =>
    set(state => ({ foods: state.foods.filter(food => food.key !== key) })),

  clear: () => {
    if (get().foods.length > 0) {
      set({ foods: [] });
    }
  },
}));

export const useMealDraftFoods = () => useMealDraftStore(s => s.foods);
export const useMealDraftCount = () => useMealDraftStore(s => s.foods.length);
