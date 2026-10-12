import { getConfig } from '../../config/remote.js';
import {
  dietPlanDaySchema,
  dietPlanDaySummarySchema,
  dietPlanDetailSchema,
  dietPlanSummarySchema,
  foodItemSchema,
  foodLibraryPageSchema,
  nutritionDaySchema,
  nutritionDayTotalSchema,
  nutritionProfileSchema,
  plannedMealSchema,
  type DietPlanDay,
  type DietPlanDaySummary,
  type DietPlanDetail,
  type DietPlanProgramDay,
  type DietPlanSummary,
  type FoodItem,
  type FoodLibraryPage,
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
import { DietPlanModel, FoodEntryModel, FoodItemModel, NutritionProfileModel } from './models.js';

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
    selectedPlanId: row?.selectedPlanId ?? null,
  });
}

export interface ProfilePatch {
  goals?: Partial<NutritionGoals>;
  preferences?: Partial<NutritionPreferences>;
  /** A plan from the library, or null to hand the choice back to the server (RULES N10). */
  selectedPlanId?: string | null;
}

/**
 * Changes the targets, the preferences or the chosen plan, field by field; a
 * new plan follows at once.
 *
 * A plan named here must be one on offer: a member cannot pick a plan that
 * was retired, and silently storing an id that resolves to nothing would show
 * them a chosen plan whose days came from somewhere else.
 */
export async function updateProfile(userId: string, patch: ProfilePatch): Promise<NutritionProfile> {
  const current = await getProfile(userId);
  if (typeof patch.selectedPlanId === 'string') {
    const exists = await DietPlanModel.exists({ _id: patch.selectedPlanId, active: true });
    if (!exists) throw Errors.notFound('That diet plan');
  }
  const next = nutritionProfileSchema.parse({
    goals: { ...current.goals, ...patch.goals },
    preferences: { ...current.preferences, ...patch.preferences },
    selectedPlanId: patch.selectedPlanId === undefined ? current.selectedPlanId : patch.selectedPlanId,
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

/** What a member may see: everyone's foods and their own, and nothing retired. */
const visibleTo = (userId: string) => ({
  active: { $ne: false },
  $or: [{ ownerUserId: null }, { ownerUserId: userId }],
});

/** Every word typed must start a word of the name — a typed "chap" finds "Chapati". */
function nameFilter(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  return words.map(word => ({ name: { $regex: `(^|\\s|\\()${escapeRegex(word)}`, $options: 'i' } }));
}

/**
 * Searches the library a member can see — everyone's foods and their own
 * custom ones — by word prefix. Their own foods come first.
 */
export async function searchFoods(userId: string, query: string, limit?: number): Promise<FoodItem[]> {
  const config = await getConfig();
  const words = nameFilter(query);
  const filter = words.length === 0 ? visibleTo(userId) : { $and: [visibleTo(userId), ...words] };
  const rows = await FoodItemModel.find(filter)
    .sort({ ownerUserId: -1, sort: 1, name: 1 })
    .limit(Math.min(limit ?? config.nutrition.searchLimit, config.nutrition.searchLimit))
    .lean();
  return rows.map(toFood);
}

/** The add-meal screen's shortcuts. */
export async function quickAddFoods(): Promise<FoodItem[]> {
  const rows = await FoodItemModel.find({ ownerUserId: null, quickAdd: true, active: { $ne: false } })
    .sort({ sort: 1, name: 1 })
    .lean();
  return rows.map(toFood);
}

/**
 * The library is ordered server-side and read in pages, so the cursor is
 * simply where the last page ended — the same scheme the catalogue uses.
 */
const offsetOf = (cursor?: string) => {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString('utf8').replace(/^offset:/, ''));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};
const cursorFor = (offset: number) => Buffer.from(`offset:${offset}`, 'utf8').toString('base64url');

export interface FoodLibraryQuery {
  q?: string;
  cursor?: string;
  limit?: number;
}

/**
 * A page of the whole library, for browsing it (RULES N8): the member's own
 * foods first, then everyone's, in the order an operator put them in.
 *
 * Paged rather than capped like the search, because this answers "show me
 * everything" — a list that silently stopped at twenty-five would be a
 * library with no way to reach the twenty-sixth food.
 */
export async function listFoodLibrary(userId: string, query: FoodLibraryQuery): Promise<FoodLibraryPage> {
  const config = await getConfig();
  const words = nameFilter(query.q ?? '');
  const filter = words.length === 0 ? visibleTo(userId) : { $and: [visibleTo(userId), ...words] };
  const limit = Math.min(Math.max(1, query.limit ?? config.nutrition.libraryPageSize), config.nutrition.libraryPageSize);
  const offset = offsetOf(query.cursor);

  const [total, rows] = await Promise.all([
    FoodItemModel.countDocuments(filter),
    FoodItemModel.find(filter)
      .sort({ ownerUserId: -1, sort: 1, name: 1, _id: 1 })
      .skip(offset)
      .limit(limit)
      .lean(),
  ]);
  const end = offset + rows.length;
  return foodLibraryPageSchema.parse({
    data: rows.map(toFood),
    nextCursor: end < total ? cursorFor(end) : null,
    total,
  });
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

// ─── The diet plan library (RULES N6, N7, N10) ─────────────────────────────

const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

function totalsOf(meals: PlannedMeal[]) {
  return {
    calories: meals.reduce((sum, m) => sum + m.calories, 0),
    proteinG: round1(meals.reduce((sum, m) => sum + m.proteinG, 0)),
    carbsG: round1(meals.reduce((sum, m) => sum + m.carbsG, 0)),
    fatsG: round1(meals.reduce((sum, m) => sum + m.fatsG, 0)),
    fiberG: 0,
  };
}

/** A plan row as Mongo holds it — `days` is written by hand, so it is read as unknown. */
export type PlanRow = {
  _id: string;
  name: string;
  description?: string | null;
  emoji?: string | null;
  dietTypes: string[];
  mealPlans: string[];
  days: unknown[];
  active?: boolean;
};

/**
 * A plan's days, parsed and put in clock order, numbered from 1.
 *
 * Meal ids are built from the plan and the day as well as the slot: two days
 * of one plan both have a breakfast, and ids that collided would make a list
 * key that is not a key.
 */
export function programDaysOf(row: PlanRow): DietPlanProgramDay[] {
  return row.days.map((day, index) => {
    const { label, meals } = (day ?? {}) as { label?: string; meals?: unknown[] };
    const parsed = (meals ?? [])
      .map(meal =>
        plannedMealSchema.parse({
          ...(meal as object),
          id: `${row._id}-d${index + 1}-${(meal as { slot: string }).slot}`,
        }),
      )
      .sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
    return {
      dayNumber: index + 1,
      label: label ?? '',
      meals: parsed,
      totals: totalsOf(parsed),
    };
  });
}

/** What an average day of the plan comes to — what the library row states. */
export function perDayOf(days: DietPlanProgramDay[]) {
  const count = Math.max(1, days.length);
  const sum = (pick: (day: DietPlanProgramDay) => number) => round1(days.reduce((total, day) => total + pick(day), 0) / count);
  return {
    calories: Math.round(days.reduce((total, day) => total + day.totals.calories, 0) / count),
    proteinG: sum(day => day.totals.proteinG),
    carbsG: sum(day => day.totals.carbsG),
    fatsG: sum(day => day.totals.fatsG),
    fiberG: 0,
  };
}

const suits = (row: PlanRow, preferences: NutritionPreferences) =>
  row.dietTypes.includes(preferences.dietType) && row.mealPlans.includes(preferences.mealPlan);

function toSummary(row: PlanRow, preferences: NutritionPreferences, selectedPlanId: string | null): DietPlanSummary {
  const days = programDaysOf(row);
  return dietPlanSummarySchema.parse({
    id: row._id,
    name: row.name,
    description: row.description ?? '',
    emoji: row.emoji ?? '🥗',
    dietTypes: row.dietTypes,
    mealPlans: row.mealPlans,
    dayCount: Math.max(1, days.length),
    mealsPerDay: days.length > 0 ? Math.round(days.reduce((total, day) => total + day.meals.length, 0) / days.length) : 0,
    perDay: perDayOf(days),
    suitsPreferences: suits(row, preferences),
    selected: row._id === selectedPlanId,
  });
}

/**
 * The plans on offer (RULES N10): the ones that suit the member first, then
 * the rest — a library that hid the others would leave a vegetarian unable to
 * see what else exists, and the tag on each row already says who it is for.
 */
export async function listDietPlans(userId: string): Promise<DietPlanSummary[]> {
  const { preferences, selectedPlanId } = await getProfile(userId);
  const rows = await DietPlanModel.find({ active: true }).sort({ sort: 1, _id: 1 }).lean<PlanRow[]>();
  return rows
    .map(row => toSummary(row, preferences, selectedPlanId))
    .sort((a, b) => Number(b.suitsPreferences) - Number(a.suitsPreferences));
}

/**
 * One plan with every day of it. A member's own chosen plan is readable even
 * once it is retired, so the screen can still name what they are following.
 */
export async function getDietPlanDetail(userId: string, planId: string): Promise<DietPlanDetail> {
  const { preferences, selectedPlanId } = await getProfile(userId);
  const row = await DietPlanModel.findById(planId).lean<PlanRow | null>();
  if (!row || (row.active === false && row._id !== selectedPlanId)) throw Errors.notFound('That diet plan');
  return dietPlanDetailSchema.parse({
    ...toSummary(row, preferences, selectedPlanId),
    days: programDaysOf(row),
  });
}

/**
 * Which plan the server would choose for a set of preferences, and why: the
 * first that suits both, else their diet type alone, else any — a plan that
 * suits less well beats no plan.
 *
 * Exported because the operator's script answers "who gets what" with it. A
 * second copy of this rule in a tool would be a tool that lies the first time
 * either copy changes.
 */
export async function planForPreferences(
  preferences: NutritionPreferences,
): Promise<{ row: PlanRow; basis: 'both' | 'diet_type' | 'any' } | null> {
  const rows = await DietPlanModel.find({ active: true }).sort({ sort: 1, _id: 1 }).lean<PlanRow[]>();
  const both = rows.find(candidate => suits(candidate, preferences));
  if (both) return { row: both, basis: 'both' };
  const byDiet = rows.find(candidate => candidate.dietTypes.includes(preferences.dietType));
  if (byDiet) return { row: byDiet, basis: 'diet_type' };
  return rows[0] ? { row: rows[0], basis: 'any' } : null;
}

/** The plan in force for a member: the one they picked, else the server's choice. */
async function planInForce(profile: NutritionProfile): Promise<{ row: PlanRow; chosenByUser: boolean } | null> {
  if (profile.selectedPlanId !== null) {
    const chosen = await DietPlanModel.findById(profile.selectedPlanId).lean<PlanRow | null>();
    if (chosen && chosen.active !== false) return { row: chosen, chosenByUser: true };
  }
  const chosen = await planForPreferences(profile.preferences);
  return chosen ? { row: chosen.row, chosenByUser: false } : null;
}

/** Which of `cycle` days a date falls on — the same however the user pages through. */
function cycleIndexOf(date: IsoDate, cycle: number): number {
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
  return ((days % cycle) + cycle) % cycle;
}

/** The plan for one day: the plan in force, its days in rotation, chosen by date (N6, N7, N10). */
export async function getDietPlan(userId: string, date: IsoDate): Promise<DietPlanDay> {
  const profile = await getProfile(userId);
  const inForce = await planInForce(profile);
  if (inForce === null) throw Errors.notFound('A diet plan');
  const days = programDaysOf(inForce.row);
  if (days.length === 0) throw Errors.notFound('A diet plan');
  const day = days[cycleIndexOf(date, days.length)];
  return dietPlanDaySchema.parse({
    date,
    meals: day.meals,
    totals: day.totals,
    cycleLength: days.length,
    basis: `${DIET_LABEL[profile.preferences.dietType]} · ${PLAN_LABEL[profile.preferences.mealPlan]}`,
    planId: inForce.row._id,
    planName: inForce.row.name,
    dayNumber: day.dayNumber,
    chosenByUser: inForce.chosenByUser,
  });
}

/** A run of days' plans in brief, for the week ahead and the week behind. */
export async function getDietPlanDays(userId: string, from: IsoDate, to: IsoDate): Promise<DietPlanDaySummary[]> {
  if (daysBetween(from, to) < 0) throw Errors.validation({ to: 'Must not be before from.' });
  if (daysBetween(from, to) > 62) throw new ApiError(422, 'RANGE_TOO_LONG', 'Ask for two months at most.');
  const profile = await getProfile(userId);
  const inForce = await planInForce(profile);
  const days = inForce ? programDaysOf(inForce.row) : [];
  const out: DietPlanDaySummary[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const planned = days.length > 0 ? days[cycleIndexOf(day, days.length)] : null;
    out.push(dietPlanDaySummarySchema.parse({
      date: day,
      meals: planned?.meals.length ?? 0,
      calories: planned?.totals.calories ?? 0,
    }));
  }
  return out;
}
