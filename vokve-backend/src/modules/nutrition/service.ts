import { getConfig } from '../../config/remote.js';
import {
  dietPlanDaySchema,
  dietPlanDaySummarySchema,
  foodItemSchema,
  nutritionDaySchema,
  nutritionDayTotalSchema,
  nutritionProfileSchema,
  plannedMealSchema,
  type DietPlanDay,
  type DietPlanDaySummary,
  type FoodItem,
  type NutritionDay,
  type NutritionDayTotal,
  type NutritionGoals,
  type NutritionPreferences,
  type NutritionProfile,
  type PlannedMeal,
} from '../../contracts/index.js';
import { addDays, localDayOf, type IsoDate } from '../../lib/dates.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { daysBetween } from '../streak/rules.js';
import { DietPlanTemplateModel, FoodEntryModel, FoodItemModel, NutritionProfileModel } from './models.js';

/**
 * Food (RULES §N), on the server: the diary (every food logged, its day
 * fixed when it was eaten), the targets and preferences, the food library,
 * and the diet plan chosen from the preferences. Logging mints no coins
 * (N9).
 */

const DAY_MS = 86_400_000;

const DIET_LABEL: Record<NutritionPreferences['dietType'], string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  eggetarian: 'Eggetarian',
  non_vegetarian: 'Non-vegetarian',
};
const PLAN_LABEL: Record<NutritionPreferences['mealPlan'], string> = {
  balanced: 'Balanced',
  high_protein: 'High protein',
  low_carb: 'Low carb',
  keto: 'Keto',
};

// ─── Profile (RULES N4) ────────────────────────────────────────────────────

export async function getProfile(userId: string): Promise<NutritionProfile> {
  const config = await getConfig();
  const row = await NutritionProfileModel.findById(userId).lean();
  return nutritionProfileSchema.parse({
    goals: row?.goals ?? config.nutrition.defaultGoals,
    preferences: row?.preferences ?? config.nutrition.defaultPreferences,
  });
}

export interface ProfilePatch {
  goals?: Partial<NutritionGoals>;
  preferences?: Partial<NutritionPreferences>;
}

/** Changes the targets or the preferences, field by field; a new plan follows from the preferences at once. */
export async function updateProfile(userId: string, patch: ProfilePatch): Promise<NutritionProfile> {
  const current = await getProfile(userId);
  const next = nutritionProfileSchema.parse({
    goals: { ...current.goals, ...patch.goals },
    preferences: { ...current.preferences, ...patch.preferences },
  });
  await NutritionProfileModel.updateOne({ _id: userId }, { $set: next }, { upsert: true });
  return next;
}

// ─── The diary (RULES N2, N3, N5) ──────────────────────────────────────────

type EntryRow = {
  clientId: string; slot: string; name: string; portion?: string | null; calories: number;
  proteinG?: number | null; carbsG?: number | null; fatsG?: number | null; fiberG?: number | null; loggedAt: Date;
};

function toEntry(row: EntryRow) {
  return {
    id: row.clientId,
    slot: row.slot,
    name: row.name,
    portion: row.portion ?? '',
    calories: row.calories,
    proteinG: row.proteinG ?? 0,
    carbsG: row.carbsG ?? 0,
    fatsG: row.fatsG ?? 0,
    fiberG: row.fiberG ?? 0,
    loggedAt: row.loggedAt.toISOString(),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** One day's food, in the order it was logged, with what it adds up to. */
export async function getNutritionDay(userId: string, localDay: IsoDate): Promise<NutritionDay> {
  const [rows, profile] = await Promise.all([
    FoodEntryModel.find({ userId, localDay, deletedAt: null }).sort({ loggedAt: 1, _id: 1 }).lean(),
    getProfile(userId),
  ]);
  const entries = rows.map(toEntry);
  return nutritionDaySchema.parse({
    date: localDay,
    entries,
    totals: {
      calories: entries.reduce((sum, e) => sum + e.calories, 0),
      proteinG: round1(entries.reduce((sum, e) => sum + e.proteinG, 0)),
      carbsG: round1(entries.reduce((sum, e) => sum + e.carbsG, 0)),
      fatsG: round1(entries.reduce((sum, e) => sum + e.fatsG, 0)),
      fiberG: round1(entries.reduce((sum, e) => sum + e.fiberG, 0)),
    },
    goals: profile.goals,
  });
}

export interface EntryInput {
  id: string;
  slot: 'breakfast' | 'lunch' | 'snack' | 'dinner';
  name: string;
  portion?: string;
  calories: number;
  proteinG?: number;
  carbsG?: number;
  fatsG?: number;
  fiberG?: number;
  loggedAt: string;
}

/**
 * Logs a meal's foods at once (RULES N2): each lands on the local day of its
 * own `loggedAt` in the caller's zone. Names are trimmed and must say
 * something; calories are whole and macros never negative (N3). An id
 * already logged is left as it was — a retried save is the same plate.
 * Answers the day of the first food.
 */
export async function logFoods(userId: string, inputs: EntryInput[], timeZone: string, now = new Date()): Promise<NutritionDay> {
  const config = await getConfig();
  if (inputs.length === 0) throw Errors.validation({ entries: 'Add at least one food.' });
  if (inputs.length > config.nutrition.maxEntriesPerSave) {
    throw Errors.validation({ entries: `Save at most ${config.nutrition.maxEntriesPerSave} foods at once.` });
  }

  const rows = inputs.map((input, index) => {
    const name = input.name.trim();
    if (name.length === 0) throw Errors.validation({ [`entries.${index}.name`]: 'Say what it was.' });
    const loggedAt = new Date(input.loggedAt);
    if (Number.isNaN(loggedAt.getTime())) throw Errors.validation({ [`entries.${index}.loggedAt`]: 'Use an ISO-8601 time.' });
    if (loggedAt.getTime() > now.getTime() + DAY_MS) throw Errors.validation({ [`entries.${index}.loggedAt`]: 'That time is still to come.' });
    if (now.getTime() - loggedAt.getTime() > config.nutrition.maxAgeDays * DAY_MS) {
      throw Errors.validation({ [`entries.${index}.loggedAt`]: `Only the last ${config.nutrition.maxAgeDays} days can be logged.` });
    }
    return {
      _id: `${userId}:${input.id}`,
      userId,
      clientId: input.id,
      slot: input.slot,
      name,
      portion: (input.portion ?? '').trim(),
      calories: Math.max(0, Math.round(input.calories)),
      proteinG: Math.max(0, input.proteinG ?? 0),
      carbsG: Math.max(0, input.carbsG ?? 0),
      fatsG: Math.max(0, input.fatsG ?? 0),
      fiberG: Math.max(0, input.fiberG ?? 0),
      loggedAt,
      localDay: localDayOf(loggedAt, timeZone),
    };
  });

  try {
    await FoodEntryModel.insertMany(rows, { ordered: false });
  } catch (err) {
    // Some of these were logged already: those stay as they were.
    const failure = err as { code?: number; writeErrors?: { code?: number; err?: { code?: number } }[] };
    const duplicateOnly = failure.writeErrors
      ? failure.writeErrors.every(e => (e.code ?? e.err?.code) === 11000)
      : failure.code === 11000;
    if (!duplicateOnly) throw err;
  }
  return getNutritionDay(userId, rows[0].localDay);
}

/** Takes a food back out of its day. Another member's food is not found (RULES X8). */
export async function deleteFood(userId: string, id: string): Promise<NutritionDay> {
  const row = await FoodEntryModel.findOneAndUpdate({ _id: `${userId}:${id}` }, { $set: { deletedAt: new Date() } }, { new: true }).lean();
  if (!row) throw Errors.notFound('That food');
  return getNutritionDay(userId, row.localDay);
}

/** What each day from `from` to `to` came to, every day present — a day with nothing logged is zeros. */
export async function getNutritionDays(userId: string, from: IsoDate, to: IsoDate): Promise<NutritionDayTotal[]> {
  if (daysBetween(from, to) < 0) throw Errors.validation({ to: 'Must not be before from.' });
  if (daysBetween(from, to) > 366) throw new ApiError(422, 'RANGE_TOO_LONG', 'Ask for a year at most.');
  const rows = await FoodEntryModel.aggregate<{ _id: string; items: number; calories: number; proteinG: number; carbsG: number; fatsG: number }>([
    { $match: { userId, deletedAt: null, localDay: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: '$localDay',
        items: { $sum: 1 },
        calories: { $sum: '$calories' },
        proteinG: { $sum: '$proteinG' },
        carbsG: { $sum: '$carbsG' },
        fatsG: { $sum: '$fatsG' },
      },
    },
  ]);
  const byDay = new Map(rows.map(row => [row._id, row]));
  const days: NutritionDayTotal[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const row = byDay.get(day);
    days.push(nutritionDayTotalSchema.parse({
      date: day,
      items: row?.items ?? 0,
      calories: row?.calories ?? 0,
      proteinG: round1(row?.proteinG ?? 0),
      carbsG: round1(row?.carbsG ?? 0),
      fatsG: round1(row?.fatsG ?? 0),
    }));
  }
  return days;
}

// ─── The library (RULES N8) ────────────────────────────────────────────────

function toFood(row: { _id: string; name: string; portion: string; emoji?: string | null; calories: number; proteinG?: number | null; carbsG?: number | null; fatsG?: number | null; fiberG?: number | null }): FoodItem {
  return foodItemSchema.parse({
    id: row._id, name: row.name, portion: row.portion, emoji: row.emoji ?? '🍽️', calories: row.calories,
    proteinG: row.proteinG ?? 0, carbsG: row.carbsG ?? 0, fatsG: row.fatsG ?? 0, fiberG: row.fiberG ?? 0,
  });
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Searches the library a member can see — everyone's foods and their own
 * custom ones — by word prefix: every word typed must start a word of the
 * name. Their own foods come first.
 */
export async function searchFoods(userId: string, query: string, limit?: number): Promise<FoodItem[]> {
  const config = await getConfig();
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = { $or: [{ ownerUserId: null }, { ownerUserId: userId }] };
  const filter = words.length === 0
    ? visible
    : { $and: [visible, ...words.map(word => ({ name: { $regex: `(^|\\s|\\()${escapeRegex(word)}`, $options: 'i' } }))] };
  const rows = await FoodItemModel.find(filter)
    .sort({ ownerUserId: -1, sort: 1, name: 1 })
    .limit(Math.min(limit ?? config.nutrition.searchLimit, config.nutrition.searchLimit))
    .lean();
  return rows.map(toFood);
}

/** The add-meal screen's shortcuts. */
export async function quickAddFoods(): Promise<FoodItem[]> {
  const rows = await FoodItemModel.find({ ownerUserId: null, quickAdd: true }).sort({ sort: 1, name: 1 }).lean();
  return rows.map(toFood);
}

export interface CustomFoodInput {
  name: string;
  portion: string;
  emoji?: string;
  calories: number;
  proteinG?: number;
  carbsG?: number;
  fatsG?: number;
  fiberG?: number;
}

/** A member's own food, private to them (RULES N8). */
export async function createCustomFood(userId: string, input: CustomFoodInput): Promise<FoodItem> {
  const name = input.name.trim();
  if (name.length === 0) throw Errors.validation({ name: 'Give it a name.' });
  const row = await FoodItemModel.create({
    _id: newId('food'),
    name,
    portion: input.portion.trim() || '1 serving',
    emoji: input.emoji ?? '🍽️',
    calories: Math.max(0, Math.round(input.calories)),
    proteinG: Math.max(0, input.proteinG ?? 0),
    carbsG: Math.max(0, input.carbsG ?? 0),
    fatsG: Math.max(0, input.fatsG ?? 0),
    fiberG: Math.max(0, input.fiberG ?? 0),
    ownerUserId: userId,
  });
  return toFood(row.toObject());
}

// ─── The diet plan (RULES N6, N7) ──────────────────────────────────────────

const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * The days that suit a member's preferences: those made for both their diet
 * type and meal plan; failing that, their diet type alone; failing that,
 * all of them — a plan that suits less well beats no plan.
 */
async function templatesFor(preferences: NutritionPreferences) {
  const all = await DietPlanTemplateModel.find({ active: true }).sort({ sort: 1, _id: 1 }).lean();
  const both = all.filter(t => t.dietTypes.includes(preferences.dietType) && t.mealPlans.includes(preferences.mealPlan));
  if (both.length > 0) return both;
  const diet = all.filter(t => t.dietTypes.includes(preferences.dietType));
  return diet.length > 0 ? diet : all;
}

/** Which of `cycle` days a date falls on — the same however the user pages through. */
function cycleIndexOf(date: IsoDate, cycle: number): number {
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
  return ((days % cycle) + cycle) % cycle;
}

function totalsOf(meals: PlannedMeal[]) {
  return {
    calories: meals.reduce((sum, m) => sum + m.calories, 0),
    proteinG: meals.reduce((sum, m) => sum + m.proteinG, 0),
    carbsG: meals.reduce((sum, m) => sum + m.carbsG, 0),
    fatsG: meals.reduce((sum, m) => sum + m.fatsG, 0),
    fiberG: 0,
  };
}

/** The plan for one day: the suiting days in rotation, chosen by date (N6, N7). */
export async function getDietPlan(userId: string, date: IsoDate): Promise<DietPlanDay> {
  const { preferences } = await getProfile(userId);
  const templates = await templatesFor(preferences);
  if (templates.length === 0) throw Errors.notFound('A diet plan');
  const template = templates[cycleIndexOf(date, templates.length)];
  const meals = (template.meals as unknown[])
    .map(meal => plannedMealSchema.parse({ ...(meal as object), id: `${template._id}-${(meal as { slot: string }).slot}` }))
    .sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
  return dietPlanDaySchema.parse({
    date,
    meals,
    totals: totalsOf(meals),
    cycleLength: templates.length,
    basis: `${DIET_LABEL[preferences.dietType]} · ${PLAN_LABEL[preferences.mealPlan]}`,
  });
}

/** A run of days' plans in brief, for the week ahead and the week behind. */
export async function getDietPlanDays(userId: string, from: IsoDate, to: IsoDate): Promise<DietPlanDaySummary[]> {
  if (daysBetween(from, to) < 0) throw Errors.validation({ to: 'Must not be before from.' });
  if (daysBetween(from, to) > 62) throw new ApiError(422, 'RANGE_TOO_LONG', 'Ask for two months at most.');
  const { preferences } = await getProfile(userId);
  const templates = await templatesFor(preferences);
  const days: DietPlanDaySummary[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const template = templates.length > 0 ? templates[cycleIndexOf(day, templates.length)] : null;
    const meals = (template?.meals as { calories: number }[] | undefined) ?? [];
    days.push(dietPlanDaySummarySchema.parse({
      date: day,
      meals: meals.length,
      calories: meals.reduce((sum, m) => sum + m.calories, 0),
    }));
  }
  return days;
}
