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
    /** The plan the member picked by hand (RULES N10); null means the server chooses. */
    selectedPlanId: { type: String, default: null },
  },
  { timestamps: true, collection: 'nutrition_profiles', versionKey: false },
);
export const NutritionProfileModel = model('NutritionProfile', nutritionProfileSchema);

/**
 * The food library (RULES N8): global items (`ownerUserId: null`), written by
 * an operator through `/v1/admin/foods`, and each member's own custom foods,
 * which only they ever see. `quickAdd` items are the add-meal screen's
 * shortcuts; `sort` is the order the library is browsed in.
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
    /**
     * Whether it is still offered. Retiring a global food sets this false
     * rather than removing the row: a food already eaten keeps its own copy
     * of the figures (N2), so nothing breaks, but the id is also what an
     * audit entry points at.
     */
    active: { type: Boolean, default: true },
    /** Who last wrote it — an admin key's label, or `seed`. A member's own food is `member`. */
    updatedBy: { type: String, default: 'seed' },
  },
  { timestamps: true, collection: 'food_items', versionKey: false },
);
foodItemSchema.index({ ownerUserId: 1, name: 1 });
foodItemSchema.index({ ownerUserId: 1, active: 1, sort: 1 });
export const FoodItemModel = model('FoodItem', foodItemSchema);

/**
 * The diet plan library (RULES N7, N10): named programmes of several days
 * that an operator writes, each tagged with the diet types and meal plans it
 * suits. A member either picks one by name or lets the server pick from the
 * ones that suit their preferences; either way the days run in rotation.
 *
 * `days` is an array of `{ label?, meals: PlannedMeal[] }` — the meals are
 * kept as written rather than normalised into their own collection, because a
 * plan's day is only ever read whole and a plan is only ever edited whole.
 *
 * Retiring a plan sets `active: false` rather than removing the row: members
 * who picked it have its id on their profile, and a missing plan would leave
 * them with no plan and no explanation.
 */
const dietPlanSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    emoji: { type: String, default: '🥗' },
    dietTypes: { type: [String], enum: DIET_TYPES, default: [] },
    mealPlans: { type: [String], enum: MEAL_PLANS, default: [] },
    days: { type: [Schema.Types.Mixed], required: true },
    sort: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    /** Who last wrote it — an admin key's label, or `seed`. */
    updatedBy: { type: String, default: 'seed' },
  },
  { timestamps: true, collection: 'diet_plans', versionKey: false },
);
dietPlanSchema.index({ active: 1, sort: 1 });
export const DietPlanModel = model('DietPlan', dietPlanSchema);
