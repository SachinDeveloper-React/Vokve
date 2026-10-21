import { plannedMealSchema, type PlannedMeal } from '../../contracts/index.js';
import { getConfig } from '../../config/remote.js';
import { Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { AuditLogModel } from '../platform/models.js';
import { DIET_TYPES, DietPlanModel, FoodEntryModel, FoodItemModel, MEAL_PLANS, NUTRITION_GOALS, NutritionProfileModel } from './models.js';

/**
 * Writing the diet plan library (RULES N10), for the operator rather than the
 * member.
 *
 * A plan is a named programme of days, and it is written and read whole: the
 * admin API takes the whole plan on every save, which is what makes "retire
 * day 3" a single edit the operator can see the result of, rather than a
 * sequence of calls that can half-fail.
 *
 * Every write lands in `audit_log` with the plan before and after it, because
 * a plan is content a thousand members then eat by, and "who changed Tuesday"
 * is the first question asked when one of them complains.
 */

/**
 * One day of a plan, as the admin API takes it. The meals arrive unparsed:
 * the route has already shaped them, and this is where they are turned into
 * the contract the member reads.
 */
export interface AdminPlanDayInput {
  label?: string;
  meals: unknown[];
}

export interface AdminPlanInput {
  name: string;
  description?: string;
  emoji?: string;
  dietTypes: string[];
  mealPlans: string[];
  days: AdminPlanDayInput[];
  sort?: number;
  active?: boolean;
}

/** The whole plan as stored, days and all — the admin view, not the member's. */
export interface AdminPlan {
  id: string;
  name: string;
  description: string;
  emoji: string;
  dietTypes: string[];
  mealPlans: string[];
  days: { label: string; meals: PlannedMeal[] }[];
  active: boolean;
  sort: number;
  updatedBy: string;
  updatedAt: string | null;
}

type PlanRow = {
  _id: string;
  name: string;
  description?: string | null;
  emoji?: string | null;
  dietTypes: string[];
  mealPlans: string[];
  days: unknown[];
  sort?: number;
  active?: boolean;
  updatedBy?: string | null;
  updatedAt?: Date | null;
};

/**
 * Meals are parsed on the way in rather than on the way out: a plan saved
 * with a malformed meal would be refused at read time, which is after the
 * operator has gone, and every member on that plan would see the refusal.
 */
function normaliseDays(days: AdminPlanDayInput[]): { label: string; meals: PlannedMeal[] }[] {
  if (days.length === 0) throw Errors.validation({ days: 'A plan needs at least one day.' });
  return days.map((day, index) => {
    const meals = (day.meals ?? []).map((meal, at) => {
      try {
        // The id is the member-facing one, rebuilt from the plan at read time;
        // whatever an operator sends here is replaced, so a placeholder parses.
        return plannedMealSchema.parse({ ...(meal as object), id: 'pending' });
      } catch {
        throw Errors.validation({ [`days.${index}.meals.${at}`]: 'Check the slot, time, calories and macros.' });
      }
    });
    if (meals.length === 0) throw Errors.validation({ [`days.${index}.meals`]: 'A day needs at least one meal.' });
    return { label: day.label?.trim() ?? '', meals };
  });
}

function toAdminPlan(row: PlanRow): AdminPlan {
  return {
    id: row._id,
    name: row.name,
    description: row.description ?? '',
    emoji: row.emoji ?? '🥗',
    dietTypes: row.dietTypes,
    mealPlans: row.mealPlans,
    days: (row.days ?? []).map(day => {
      const { label, meals } = (day ?? {}) as { label?: string; meals?: PlannedMeal[] };
      return { label: label ?? '', meals: meals ?? [] };
    }),
    sort: row.sort ?? 0,
    active: row.active !== false,
    updatedBy: row.updatedBy ?? 'seed',
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

const audit = (actor: string, action: string, planId: string, before: unknown, after: unknown) =>
  AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action,
    subjectType: 'diet_plan',
    subjectId: planId,
    before,
    after,
  });

/** Every plan, retired ones included — the operator's list, not the member's. */
export async function adminListPlans(): Promise<AdminPlan[]> {
  const rows = await DietPlanModel.find().sort({ sort: 1, _id: 1 }).lean<PlanRow[]>();
  return rows.map(toAdminPlan);
}

export async function adminGetPlan(planId: string): Promise<AdminPlan> {
  const row = await DietPlanModel.findById(planId).lean<PlanRow | null>();
  if (!row) throw Errors.notFound('That diet plan');
  return toAdminPlan(row);
}

export async function adminCreatePlan(actor: string, input: AdminPlanInput): Promise<AdminPlan> {
  const name = input.name.trim();
  if (name.length === 0) throw Errors.validation({ name: 'Give the plan a name.' });
  const row = await DietPlanModel.create({
    _id: newId('plan'),
    name,
    description: input.description?.trim() ?? '',
    emoji: input.emoji ?? '🥗',
    dietTypes: input.dietTypes,
    mealPlans: input.mealPlans,
    days: normaliseDays(input.days),
    sort: input.sort ?? 0,
    active: input.active ?? true,
    updatedBy: actor,
  });
  const plan = toAdminPlan(row.toObject() as PlanRow);
  await audit(actor, 'diet_plan.created', plan.id, null, plan);
  return plan;
}

/** Replaces the whole plan. Fields left out keep what they had. */
export async function adminUpdatePlan(actor: string, planId: string, patch: Partial<AdminPlanInput>): Promise<AdminPlan> {
  const before = await DietPlanModel.findById(planId).lean<PlanRow | null>();
  if (!before) throw Errors.notFound('That diet plan');

  const next: Record<string, unknown> = { updatedBy: actor };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length === 0) throw Errors.validation({ name: 'Give the plan a name.' });
    next.name = name;
  }
  if (patch.description !== undefined) next.description = patch.description.trim();
  if (patch.emoji !== undefined) next.emoji = patch.emoji;
  if (patch.dietTypes !== undefined) next.dietTypes = patch.dietTypes;
  if (patch.mealPlans !== undefined) next.mealPlans = patch.mealPlans;
  if (patch.days !== undefined) next.days = normaliseDays(patch.days);
  if (patch.sort !== undefined) next.sort = patch.sort;
  if (patch.active !== undefined) next.active = patch.active;

  const row = await DietPlanModel.findByIdAndUpdate(planId, { $set: next }, { new: true }).lean<PlanRow | null>();
  if (!row) throw Errors.notFound('That diet plan');
  const plan = toAdminPlan(row);
  // Retiring through an update frees the members on it, exactly as the
  // retire route does: the two paths cannot be allowed to differ.
  if (patch.active === false) await releaseMembers(planId);
  await audit(actor, 'diet_plan.updated', planId, toAdminPlan(before), plan);
  return plan;
}

/** Hands every member who chose this plan back to the server's own choice. */
async function releaseMembers(planId: string): Promise<number> {
  const result = await NutritionProfileModel.updateMany({ selectedPlanId: planId }, { $set: { selectedPlanId: null } });
  return result.modifiedCount ?? 0;
}

/**
 * Retires a plan: it leaves the library and every member who chose it falls
 * back to the server's choice.
 *
 * The row stays, because the audit log and a member's history both point at
 * it, and a plan that vanished would turn "you were following X" into a
 * dangling id. Un-retiring is an update with `active: true`.
 */
export async function adminRetirePlan(actor: string, planId: string): Promise<{ plan: AdminPlan; released: number }> {
  const before = await DietPlanModel.findById(planId).lean<PlanRow | null>();
  if (!before) throw Errors.notFound('That diet plan');
  const row = await DietPlanModel.findByIdAndUpdate(planId, { $set: { active: false, updatedBy: actor } }, { new: true }).lean<PlanRow | null>();
  if (!row) throw Errors.notFound('That diet plan');
  const released = await releaseMembers(planId);
  const plan = toAdminPlan(row);
  await audit(actor, 'diet_plan.retired', planId, toAdminPlan(before), { ...plan, released });
  return { plan, released };
}

/**
 * Deletes a plan outright — the draft nobody ever followed.
 *
 * Retiring is what ending a plan's life looks like: the row stays and a
 * member's history still resolves it. This is the other case, so it is
 * refused the moment the audit trail is not the only thing pointing at it:
 * anybody currently on the plan has to be handed back first, which the
 * delete does by releasing them, but a plan that has been followed is one
 * somebody will ask about.
 */
export async function adminDeletePlan(actor: string, planId: string): Promise<{ deleted: true; id: string; released: number }> {
  const before = await DietPlanModel.findById(planId).lean<PlanRow | null>();
  if (!before) throw Errors.notFound('That diet plan');
  const released = await releaseMembers(planId);
  await DietPlanModel.deleteOne({ _id: planId });
  await audit(actor, 'diet_plan.deleted', planId, toAdminPlan(before), { deleted: true, released });
  return { deleted: true, id: planId, released };
}

/**
 * What the nutrition side of the app is actually made of, in one read.
 *
 * The three pages under it — goals, the food library, the plans — each
 * answer their own question; this answers the one before them. A library
 * with no quick-adds, a plan library where every member is on the server's
 * own choice, or defaults nobody has revisited since launch are all things
 * you only see by counting.
 */
export async function adminNutritionOverview() {
  const config = await getConfig();
  const [foods, plans, profiles, planCounts, dietTypes, mealPlans, goals, entries, loggers] = await Promise.all([
    FoodItemModel.aggregate<{ _id: null; total: number; active: number; quickAdd: number }>([
      { $match: { ownerUserId: null } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$active', false] }, 0, 1] } },
          quickAdd: { $sum: { $cond: ['$quickAdd', 1, 0] } },
        },
      },
    ]),
    DietPlanModel.find({}, { name: 1, active: 1, days: 1, dietTypes: 1, mealPlans: 1 }).lean<PlanRow[]>(),
    NutritionProfileModel.countDocuments({}),
    NutritionProfileModel.aggregate<{ _id: string | null; members: number }>([
      { $group: { _id: '$selectedPlanId', members: { $sum: 1 } } },
    ]),
    NutritionProfileModel.aggregate<{ _id: string; members: number }>([
      { $group: { _id: '$preferences.dietType', members: { $sum: 1 } } },
    ]),
    NutritionProfileModel.aggregate<{ _id: string; members: number }>([
      { $group: { _id: '$preferences.mealPlan', members: { $sum: 1 } } },
    ]),
    NutritionProfileModel.aggregate<{ _id: string; members: number; calories: number }>([
      { $group: { _id: '$preferences.goal', members: { $sum: 1 }, calories: { $avg: '$goals.calories' } } },
    ]),
    FoodEntryModel.countDocuments({ deletedAt: null }),
    FoodEntryModel.distinct('userId', { deletedAt: null }),
  ]);

  const countOf = (rows: { _id: string | null; members: number }[], key: string) =>
    rows.find(row => row._id === key)?.members ?? 0;
  const customFoods = await FoodItemModel.countDocuments({ ownerUserId: { $ne: null } });

  return {
    foods: {
      total: foods[0]?.total ?? 0,
      active: foods[0]?.active ?? 0,
      retired: (foods[0]?.total ?? 0) - (foods[0]?.active ?? 0),
      /** The add-meal screen's shortcut tiles (N8). */
      quickAdd: foods[0]?.quickAdd ?? 0,
      /** Members' own foods, which no operator may read or write (N8) — counted, not listed. */
      custom: customFoods,
    },
    plans: {
      total: plans.length,
      active: plans.filter(plan => plan.active !== false).length,
      /** Members who picked a plan by hand; the rest take the server's choice (N10). */
      chosen: planCounts.filter(row => row._id !== null).reduce((sum, row) => sum + row.members, 0),
      serverChoice: countOf(planCounts, null as unknown as string),
      data: plans
        .map(plan => ({
          id: plan._id,
          name: plan.name,
          active: plan.active !== false,
          days: (plan.days ?? []).length,
          members: planCounts.find(row => row._id === plan._id)?.members ?? 0,
        }))
        .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name)),
    },
    members: {
      /** Members who have a nutrition profile at all — everyone else is on the defaults. */
      profiles,
      logging: loggers.length,
      entries,
      dietTypes: DIET_TYPES.map(type => ({ value: type, members: countOf(dietTypes, type) })),
      mealPlans: MEAL_PLANS.map(plan => ({ value: plan, members: countOf(mealPlans, plan) })),
      goals: NUTRITION_GOALS.map(goal => ({
        value: goal,
        members: countOf(goals, goal),
        /** What the members on this goal are actually targeting, on average. */
        averageCalories: Math.round(goals.find(row => row._id === goal)?.calories ?? 0),
      })),
    },
    /** ⚙ `nutrition.*`: what a member starts with, and the limits on logging (N4). */
    defaults: config.nutrition,
  };
}

// ─── The food library (RULES N8, N11) ──────────────────────────────────────

/**
 * Writing the global food library, for the operator: the rows a member
 * searches, browses and quick-adds from — "Chapati · 1 piece (40 g) · 104
 * kcal".
 *
 * Only global rows (`ownerUserId: null`) are reachable here. A member's own
 * custom food is private to them (N8), and an admin API that could read or
 * rewrite it would make that promise untrue.
 *
 * A logged food keeps its own copy of the figures (N2), so correcting a row
 * here never rewrites what anybody already ate — which is why an operator can
 * fix a wrong calorie count without a migration.
 */

export interface AdminFoodInput {
  name: string;
  portion: string;
  emoji?: string;
  calories: number;
  proteinG?: number;
  carbsG?: number;
  fatsG?: number;
  fiberG?: number;
  /** One of the add-meal screen's shortcut tiles. */
  quickAdd?: boolean;
  sort?: number;
  active?: boolean;
}

export interface AdminFood extends Required<Omit<AdminFoodInput, 'emoji'>> {
  id: string;
  emoji: string;
  updatedBy: string;
  updatedAt: string | null;
}

type FoodRow = {
  _id: string;
  name: string;
  portion: string;
  emoji?: string | null;
  calories: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatsG?: number | null;
  fiberG?: number | null;
  quickAdd?: boolean;
  sort?: number;
  active?: boolean;
  updatedBy?: string | null;
  updatedAt?: Date | null;
};

function toAdminFood(row: FoodRow): AdminFood {
  return {
    id: row._id,
    name: row.name,
    portion: row.portion,
    emoji: row.emoji ?? '🍽️',
    calories: row.calories,
    proteinG: row.proteinG ?? 0,
    carbsG: row.carbsG ?? 0,
    fatsG: row.fatsG ?? 0,
    fiberG: row.fiberG ?? 0,
    quickAdd: row.quickAdd === true,
    sort: row.sort ?? 0,
    active: row.active !== false,
    updatedBy: row.updatedBy ?? 'seed',
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

const auditFood = (actor: string, action: string, foodId: string, before: unknown, after: unknown) =>
  AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action,
    subjectType: 'food_item',
    subjectId: foodId,
    before,
    after,
  });

/** Rounds what is stored the same way a member's own food is (RULES N3). */
function foodFigures(input: Partial<AdminFoodInput>): Record<string, unknown> {
  const figures: Record<string, unknown> = {};
  if (input.calories !== undefined) figures.calories = Math.max(0, Math.round(input.calories));
  for (const macro of ['proteinG', 'carbsG', 'fatsG', 'fiberG'] as const) {
    if (input[macro] !== undefined) figures[macro] = Math.max(0, input[macro]!);
  }
  return figures;
}

export interface AdminFoodQuery {
  q?: string;
  cursor?: string;
  limit?: number;
}

/**
 * The global library in pages, retired rows included — the operator's list.
 * The cursor is where the last page ended, as everywhere else here.
 */
export async function adminListFoods(query: AdminFoodQuery): Promise<{ data: AdminFood[]; nextCursor: string | null; total: number }> {
  const words = (query.q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const filter: Record<string, unknown> = words.length === 0
    ? { ownerUserId: null }
    : { ownerUserId: null, $and: words.map(word => ({ name: { $regex: escapeName(word), $options: 'i' } })) };

  const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
  const offset = cursorOffset(query.cursor);
  const [total, rows] = await Promise.all([
    FoodItemModel.countDocuments(filter),
    FoodItemModel.find(filter).sort({ sort: 1, name: 1, _id: 1 }).skip(offset).limit(limit).lean<FoodRow[]>(),
  ]);
  const end = offset + rows.length;
  return {
    data: rows.map(toAdminFood),
    nextCursor: end < total ? offsetCursor(end) : null,
    total,
  };
}

const escapeName = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cursorOffset = (cursor?: string) => {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString('utf8').replace(/^offset:/, ''));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};
const offsetCursor = (offset: number) => Buffer.from(`offset:${offset}`, 'utf8').toString('base64url');

export async function adminGetFood(foodId: string): Promise<AdminFood> {
  const row = await FoodItemModel.findOne({ _id: foodId, ownerUserId: null }).lean<FoodRow | null>();
  if (!row) throw Errors.notFound('That food');
  return toAdminFood(row);
}

export async function adminCreateFood(actor: string, input: AdminFoodInput): Promise<AdminFood> {
  const name = input.name.trim();
  if (name.length === 0) throw Errors.validation({ name: 'Give the food a name.' });
  const row = await FoodItemModel.create({
    _id: newId('food'),
    name,
    portion: input.portion.trim() || '1 serving',
    emoji: input.emoji ?? '🍽️',
    ...foodFigures({ ...input, calories: input.calories }),
    ownerUserId: null,
    quickAdd: input.quickAdd === true,
    sort: input.sort ?? 0,
    active: input.active ?? true,
    updatedBy: actor,
  });
  const food = toAdminFood(row.toObject() as FoodRow);
  await auditFood(actor, 'food_item.created', food.id, null, food);
  return food;
}

/** Adds up to `foods.length` rows in one call — a whole list pasted in at once. */
export async function adminCreateFoods(actor: string, foods: AdminFoodInput[]): Promise<AdminFood[]> {
  const created: AdminFood[] = [];
  for (const input of foods) {
    created.push(await adminCreateFood(actor, input));
  }
  return created;
}

export async function adminUpdateFood(actor: string, foodId: string, patch: Partial<AdminFoodInput>): Promise<AdminFood> {
  const before = await FoodItemModel.findOne({ _id: foodId, ownerUserId: null }).lean<FoodRow | null>();
  if (!before) throw Errors.notFound('That food');

  const next: Record<string, unknown> = { updatedBy: actor, ...foodFigures(patch) };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length === 0) throw Errors.validation({ name: 'Give the food a name.' });
    next.name = name;
  }
  if (patch.portion !== undefined) next.portion = patch.portion.trim() || '1 serving';
  if (patch.emoji !== undefined) next.emoji = patch.emoji;
  if (patch.quickAdd !== undefined) next.quickAdd = patch.quickAdd;
  if (patch.sort !== undefined) next.sort = patch.sort;
  if (patch.active !== undefined) next.active = patch.active;

  const row = await FoodItemModel.findByIdAndUpdate(foodId, { $set: next }, { new: true }).lean<FoodRow | null>();
  if (!row) throw Errors.notFound('That food');
  const food = toAdminFood(row);
  await auditFood(actor, 'food_item.updated', foodId, toAdminFood(before), food);
  return food;
}

/**
 * The spreadsheet case: a list of foods written somewhere else, imported
 * whole and imported again next month with three figures corrected.
 *
 * Matched **by name**, case-folded, among the global rows. A spreadsheet
 * has no ids in it — the operator typed "Chapati", not `food_7f3a` — so the
 * name is the only key the two sides share, and matching on it is what
 * makes a second upload an edit rather than a second Chapati. A row whose
 * name is already in the library is updated in place, which keeps its id,
 * and so keeps the audit trail pointing at one food rather than two.
 *
 * `dryRun` answers the same thing without writing: what the panel shows
 * before anybody presses the button.
 */
export interface AdminFoodImportRow extends AdminFoodInput {
  /** The sheet's own row number, so a refusal can name the line to fix. */
  line?: number;
}

export interface AdminFoodImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  /** Rows the sheet repeated: the last one wins, as a later correction should. */
  duplicates: number;
  failed: { line: number | null; name: string; reason: string }[];
  data: AdminFood[];
}

export async function adminImportFoods(
  actor: string,
  rows: AdminFoodImportRow[],
  options: { dryRun?: boolean } = {},
): Promise<AdminFoodImportResult> {
  const dryRun = options.dryRun === true;
  const existing = await FoodItemModel.find({ ownerUserId: null }, { name: 1 }).lean<{ _id: string; name: string }[]>();
  const idOfName = new Map(existing.map(row => [row.name.trim().toLowerCase(), row._id]));

  const failed: AdminFoodImportResult['failed'] = [];
  const data: AdminFood[] = [];
  let created = 0;
  let updated = 0;
  let duplicates = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    const name = (row.name ?? '').trim();
    const key = name.toLowerCase();
    if (name.length === 0) {
      failed.push({ line: row.line ?? null, name: '', reason: 'No name — a food is its name.' });
      continue;
    }
    if (!Number.isFinite(row.calories)) {
      failed.push({ line: row.line ?? null, name, reason: 'Calories is not a number.' });
      continue;
    }
    if (seen.has(key)) duplicates += 1;
    seen.add(key);

    const input: AdminFoodInput = {
      name,
      portion: row.portion,
      emoji: row.emoji,
      calories: row.calories,
      proteinG: row.proteinG,
      carbsG: row.carbsG,
      fatsG: row.fatsG,
      fiberG: row.fiberG,
      quickAdd: row.quickAdd,
      sort: row.sort,
      active: row.active,
    };
    const id = idOfName.get(key);
    try {
      if (dryRun) {
        if (id) updated += 1;
        else created += 1;
        continue;
      }
      if (id) {
        data.push(await adminUpdateFood(actor, id, input));
        updated += 1;
      } else {
        const food = await adminCreateFood(actor, input);
        // A sheet that names the same food twice is one food: the second
        // row updates the first rather than adding a twin.
        idOfName.set(key, food.id);
        data.push(food);
        created += 1;
      }
    } catch (error) {
      failed.push({
        line: row.line ?? null,
        name,
        reason: error instanceof Error ? error.message : 'Refused.',
      });
    }
  }

  if (!dryRun) {
    await auditFood(actor, 'food_item.imported', 'import', null, {
      created,
      updated,
      duplicates,
      failed: failed.length,
      names: data.slice(0, 50).map(food => food.name),
    });
  }

  return { dryRun, created, updated, duplicates, failed, data };
}

/**
 * Deletes a food outright — the mistake case: a row imported from the wrong
 * column, a duplicate, a test row.
 *
 * Safe to do, which is why it is here at all: what a member ate keeps its
 * own copy of every figure (N2), so nothing they logged changes and nothing
 * dangles. Retiring is still the right answer for a food that was real and
 * is not offered any more — it keeps the id the audit log names.
 */
export async function adminDeleteFood(actor: string, foodId: string): Promise<{ deleted: true; id: string }> {
  const before = await FoodItemModel.findOne({ _id: foodId, ownerUserId: null }).lean<FoodRow | null>();
  if (!before) throw Errors.notFound('That food');
  await FoodItemModel.deleteOne({ _id: foodId, ownerUserId: null });
  await auditFood(actor, 'food_item.deleted', foodId, toAdminFood(before), { deleted: true });
  return { deleted: true, id: foodId };
}

/**
 * Retires a food: out of search, out of the quick-add row, out of the
 * library. The row stays, because what a member already ate points at it and
 * the audit log does too. `{"active": true}` puts it back.
 */
export async function adminRetireFood(actor: string, foodId: string): Promise<AdminFood> {
  const before = await FoodItemModel.findOne({ _id: foodId, ownerUserId: null }).lean<FoodRow | null>();
  if (!before) throw Errors.notFound('That food');
  const row = await FoodItemModel.findByIdAndUpdate(
    foodId,
    { $set: { active: false, quickAdd: false, updatedBy: actor } },
    { new: true },
  ).lean<FoodRow | null>();
  if (!row) throw Errors.notFound('That food');
  const food = toAdminFood(row);
  await auditFood(actor, 'food_item.retired', foodId, toAdminFood(before), food);
  return food;
}
