import {
  Beef,
  Drumstick,
  Dumbbell,
  Egg,
  Equal,
  Flame,
  Leaf,
  Scale,
  Sprout,
  TrendingDown,
  TrendingUp,
  WheatOff,
  type LucideIcon,
} from 'lucide-react-native';
import type { SheetOption } from '../disclosure/OptionSheet';
import type { DietType, MealPlan, NutritionGoal } from '../../types/models';
import {
  DIET_LABEL,
  MEAL_PLAN_LABEL,
  NUTRITION_GOAL_LABEL,
} from './nutritionLabels';
import type { PreferenceKind } from './PreferencesCard';

/**
 * What each option *is*, in one line.
 *
 * Definitions rather than claims: "eat under what the day burns" is what the
 * setting means, where "lose 2kg a month" would be a promise the app is in no
 * position to make and the server never made. Anything that is actually a
 * figure — a calorie target, a macro split — belongs to the profile the server
 * sends, not to a picker's caption.
 */
const DIET_HINT: Record<DietType, string> = {
  vegetarian: 'No meat or fish',
  vegan: 'No animal products at all',
  eggetarian: 'Vegetarian, with eggs',
  non_vegetarian: 'Everything, meat and fish included',
};

const MEAL_PLAN_HINT: Record<MealPlan, string> = {
  balanced: 'An even split across carbs, protein and fats',
  high_protein: 'A larger share of the day from protein',
  low_carb: 'A smaller share of the day from carbs',
  keto: 'Very low carb, most of the day from fats',
};

const NUTRITION_GOAL_HINT: Record<NutritionGoal, string> = {
  lose_weight: 'Eat under what the day burns',
  maintain: 'Hold the weight you are at',
  gain_weight: 'Eat over what the day burns',
  build_muscle: 'A surplus, weighted towards protein',
};

const DIET_ICON: Record<DietType, LucideIcon> = {
  vegetarian: Leaf,
  vegan: Sprout,
  eggetarian: Egg,
  non_vegetarian: Drumstick,
};

const MEAL_PLAN_ICON: Record<MealPlan, LucideIcon> = {
  balanced: Scale,
  high_protein: Beef,
  low_carb: WheatOff,
  keto: Flame,
};

const NUTRITION_GOAL_ICON: Record<NutritionGoal, LucideIcon> = {
  lose_weight: TrendingDown,
  maintain: Equal,
  gain_weight: TrendingUp,
  build_muscle: Dumbbell,
};

/**
 * Turns one of the label maps into the rows a picker lists.
 *
 * The order is the map's own, which is the order the labels were written in —
 * worth keeping rather than sorting, because "Vegetarian, Vegan, Eggetarian,
 * Non-vegetarian" is a deliberate run and alphabetical order would scatter it.
 */
const rowsOf = <T extends string>(
  labels: Record<T, string>,
  hints: Record<T, string>,
  icons: Record<T, LucideIcon>,
): SheetOption<string>[] =>
  (Object.keys(labels) as T[]).map(value => ({
    value,
    label: labels[value],
    helper: hints[value],
    icon: icons[value],
  }));

interface PreferenceSheet {
  title: string;
  /** What the whole choice affects, under the sheet's title. */
  message: string;
  options: SheetOption<string>[];
}

/** Each preference tile's picker: its heading and the rows it offers. */
export const PREFERENCE_SHEET: Record<PreferenceKind, PreferenceSheet> = {
  dietType: {
    title: 'Diet type',
    message: 'What your plan and food suggestions are built around.',
    options: rowsOf(DIET_LABEL, DIET_HINT, DIET_ICON),
  },
  mealPlan: {
    title: 'Meal plan',
    message: 'How the day splits across carbs, protein and fats.',
    options: rowsOf(MEAL_PLAN_LABEL, MEAL_PLAN_HINT, MEAL_PLAN_ICON),
  },
  goal: {
    title: 'Nutrition goal',
    message: 'What the daily targets are working towards.',
    options: rowsOf(
      NUTRITION_GOAL_LABEL,
      NUTRITION_GOAL_HINT,
      NUTRITION_GOAL_ICON,
    ),
  },
};
