import { Schema, model } from 'mongoose';

export const MEAL_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
export const DIET_TYPES = ['vegetarian', 'vegan', 'eggetarian', 'non_vegetarian'] as const;
export const MEAL_PLANS = ['balanced', 'high_protein', 'low_carb', 'keto'] as const;
export const NUTRITION_GOALS = ['lose_weight', 'maintain', 'gain_weight', 'build_muscle'] as const;

/**
 * One thing eaten (RULES N2, N3). The id is the app's own, so a save retried
 * after a dropped connection is the same food, not a second plate. Its
 * figures are a copy — editing the library later cannot rewrite what was
 * eaten. Deleting keeps the row (D3).
 */
const foodEntrySchema = new Schema(
  {
    _id: { type: String, required: true }, // `${userId}:${clientId}`
    userId: { type: String, required: true },
    clientId: { type: String, required: true },
    slot: { type: String, enum: MEAL_SLOTS, required: true },
    name: { type: String, required: true },
    portion: { type: String, default: '' },
    calories: { type: Number, required: true, min: 0 },
    proteinG: { type: Number, default: 0, min: 0 },
    carbsG: { type: Number, default: 0, min: 0 },
    fatsG: { type: Number, default: 0, min: 0 },
    fiberG: { type: Number, default: 0, min: 0 },
    loggedAt: { type: Date, required: true },
    localDay: { type: String, required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'food_entries', versionKey: false },
);
foodEntrySchema.index({ userId: 1, localDay: 1 });
export const FoodEntryModel = model('FoodEntry', foodEntrySchema);

/** A member's targets and preferences (RULES N4), one per member. */
const nutritionProfileSchema = new Schema(
  {
    _id: { type: String, required: true }, // userId
    goals: {
      calories: { type: Number, required: true },
      proteinG: { type: Number, required: true },
      carbsG: { type: Number, required: true },
      fatsG: { type: Number, required: true },
    },
    preferences: {
      dietType: { type: String, enum: DIET_TYPES, required: true },
      mealPlan: { type: String, enum: MEAL_PLANS, required: true },
      goal: { type: String, enum: NUTRITION_GOALS, required: true },
    },
  },
  { timestamps: true, collection: 'nutrition_profiles', versionKey: false },
);
export const NutritionProfileModel = model('NutritionProfile', nutritionProfileSchema);

/**
 * The food library (RULES N8): global items (`ownerUserId: null`) and each
 * member's own custom foods, which only they ever see. `quickAdd` items are
 * the add-meal screen's shortcuts.
 */
const foodItemSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    portion: { type: String, required: true },
    emoji: { type: String, default: '🍽️' },
    calories: { type: Number, required: true, min: 0 },
    proteinG: { type: Number, default: 0, min: 0 },
    carbsG: { type: Number, default: 0, min: 0 },
    fatsG: { type: Number, default: 0, min: 0 },
    fiberG: { type: Number, default: 0, min: 0 },
    ownerUserId: { type: String, default: null },
    quickAdd: { type: Boolean, default: false },
    sort: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'food_items', versionKey: false },
);
foodItemSchema.index({ ownerUserId: 1, name: 1 });
export const FoodItemModel = model('FoodItem', foodItemSchema);

/**
 * The diet plan's curated days (RULES N7): each suits some diet types and
 * meal plans, and a member's plan cycles through the days that suit them.
 * The placeholder for real plan generation.
 */
const dietPlanTemplateSchema = new Schema(
  {
    _id: { type: String, required: true },
    dietTypes: { type: [String], enum: DIET_TYPES, default: [] },
    mealPlans: { type: [String], enum: MEAL_PLANS, default: [] },
    meals: { type: Schema.Types.Mixed, required: true },
    sort: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'diet_plan_templates', versionKey: false },
);
export const DietPlanTemplateModel = model('DietPlanTemplate', dietPlanTemplateSchema);
