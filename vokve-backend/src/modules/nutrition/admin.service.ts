import { plannedMealSchema, type PlannedMeal } from '../../contracts/index.js';
import { Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { AuditLogModel } from '../platform/models.js';
import { DietPlanModel, FoodItemModel, NutritionProfileModel } from './models.js';

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
