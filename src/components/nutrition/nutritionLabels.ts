import type {
  DietType,
  MealPlan,
  MealSlot,
  NutritionGoal,
} from '../../types/models';

/**
 * How each stored value is written on screen.
 *
 * Maps rather than prettified enum values: "non_vegetarian" cleaned up by code
 * reads as "Non Vegetarian", and the difference between that and the label a
 * designer chose is exactly the kind of thing nobody notices until it ships.
 */
export const DIET_LABEL: Record<DietType, string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  eggetarian: 'Eggetarian',
  non_vegetarian: 'Non-vegetarian',
};

export const MEAL_PLAN_LABEL: Record<MealPlan, string> = {
  balanced: 'Balanced Plan',
  high_protein: 'High Protein',
  low_carb: 'Low Carb',
  keto: 'Keto',
};

export const NUTRITION_GOAL_LABEL: Record<NutritionGoal, string> = {
  lose_weight: 'Weight Loss',
  maintain: 'Maintain',
  gain_weight: 'Weight Gain',
  build_muscle: 'Build Muscle',
};

interface MealPresentation {
  label: string;
  /** The glyph on the row — sunrise through moon, as the day runs. */
  emoji: string;
}

export const MEAL_STYLE: Record<MealSlot, MealPresentation> = {
  breakfast: { label: 'Breakfast', emoji: '🌅' },
  lunch: { label: 'Lunch', emoji: '☀️' },
  snack: { label: 'Evening Snack', emoji: '☕' },
  dinner: { label: 'Dinner', emoji: '🌙' },
};
