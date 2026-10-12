import { readFileSync } from 'node:fs';
import { DIET_TYPES, MEAL_PLANS } from '../modules/nutrition/models.js';
import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { DietPlanModel, NutritionProfileModel } from '../modules/nutrition/models.js';
import { adminPlanFileEntry, type AdminPlanFileEntry } from '../modules/nutrition/admin.schemas.js';
import {
  perDayOf,
  planForPreferences,
  programDaysOf,
  type PlanRow,
} from '../modules/nutrition/service.js';
import { AuditLogModel } from '../modules/platform/models.js';
import type { DietType, MealPlan } from '../contracts/index.js';

/**
 * The diet plan library, from the operator's own terminal (RULES N7, N10).
 *
 * The HTTP API is the same job over the wire; this exists because the first
 * thing an operator needs is not to write one plan but to get the shipped
 * demo ones out of the way and see what is actually behind the screen — which
 * plan a vegetarian on a balanced plan is being given, and whether it is one
 * of theirs or one of the seed's.
 *
 *   npm run plans list                 every plan, and who wrote it
 *   npm run plans show <id>            one plan's days, as a menu
 *   npm run plans resolve              which plan each kind of member gets
 *   npm run plans import <file.json>   add or replace plans from a file
 *   npm run plans retire <id>          out of the library (members fall back)
 *   npm run plans restore <id>         back into it
 *   npm run plans retire-seed          retire the three the app shipped with
 *
 * Every write goes through the same collection and the same audit log as the
 * API, as `operator` rather than `admin`, so the log says which door it came
 * through.
 */

const ACTOR = 'operator';

const pad = (text: string, width: number) =>
  text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);

/** stdout rather than the logger: this is a report for a person, not an event. */
const say = (line = '') => process.stdout.write(`${line}\n`);

const audit = (action: string, planId: string, before: unknown, after: unknown) =>
  AuditLogModel.create({
    actorType: 'admin',
    actorId: ACTOR,
    action,
    subjectType: 'diet_plan',
    subjectId: planId,
    before,
    after,
  });

const writtenBy = (row: PlanRow & { updatedBy?: string | null }) => {
  const by = row.updatedBy ?? 'seed';
  return by === 'seed' ? 'seed (shipped)' : by;
};

export async function list(): Promise<void> {
  const rows = await DietPlanModel.find().sort({ sort: 1, _id: 1 }).lean<(PlanRow & { updatedBy?: string; sort?: number })[]>();
  if (rows.length === 0) {
    say('The library is empty. `npm run plans import <file.json>` puts plans in it.');
    return;
  }

  say(`${rows.length} plan(s):`);
  say();
  say(`${pad('id', 26)}${pad('name', 22)}${pad('on?', 5)}${pad('days', 6)}${pad('kcal/day', 10)}${pad('written by', 16)}suits`);
  say('─'.repeat(118));
  for (const row of rows) {
    const days = programDaysOf(row);
    const perDay = perDayOf(days);
    const suits = `${row.dietTypes.join('|')} × ${row.mealPlans.join('|')}`;
    say(
      pad(row._id, 26) +
        pad(row.name, 22) +
        pad(row.active === false ? 'no' : 'yes', 5) +
        pad(String(days.length), 6) +
        pad(String(perDay.calories), 10) +
        pad(writtenBy(row), 16) +
        suits,
    );
  }

  const seeded = rows.filter(row => (row.updatedBy ?? 'seed') === 'seed' && row.active !== false);
  if (seeded.length > 0) {
    say();
    say(`${seeded.length} of these are the demo plans the app shipped with.`);
    say('`npm run plans retire-seed` takes them out, so only your own are on offer.');
  }
}

export async function show(planId: string): Promise<void> {
  const row = await DietPlanModel.findById(planId).lean<PlanRow | null>();
  if (!row) throw new Error(`No plan with id ${planId}.`);
  const days = programDaysOf(row);
  const perDay = perDayOf(days);

  say(`${row.emoji ?? '🥗'}  ${row.name}${row.active === false ? '   [retired]' : ''}`);
  if (row.description) say(row.description);
  say(`For: ${row.dietTypes.join(', ')} · ${row.mealPlans.join(', ')}`);
  say(`${days.length} day rotation · about ${perDay.calories} kcal a day`);

  for (const day of days) {
    say();
    say(`── ${day.label || `Day ${day.dayNumber}`} · ${day.totals.calories} kcal`);
    for (const meal of day.meals) {
      say(`   ${meal.time}  ${pad(meal.slot, 10)}${String(meal.calories)} kcal   ${meal.items.map(item => `${item.name}${item.quantity ? ` (${item.quantity})` : ''}`).join(', ')}`);
    }
  }
}

/**
 * Who gets what. Every combination a member can be in, and the plan the
 * server would hand them — the answer to "is this working?" that no amount of
 * reading the collection gives you.
 */
export async function resolve(): Promise<void> {
  const WHY = {
    both: 'matches diet type + meal plan',
    diet_type: 'matches the diet type only',
    any: 'nothing matches — first plan on the shelf',
  } as const;

  say('What the server chooses for a member who has not picked a plan:');
  say();
  say(`${pad('diet type', 16)}${pad('meal plan', 14)}${pad('plan', 24)}why`);
  say('─'.repeat(90));

  const gaps: string[] = [];
  for (const dietType of DIET_TYPES as readonly DietType[]) {
    for (const mealPlan of MEAL_PLANS as readonly MealPlan[]) {
      const chosen = await planForPreferences({ dietType, mealPlan, goal: 'maintain' });
      if (chosen === null) {
        say(pad(dietType, 16) + pad(mealPlan, 14) + pad('—', 24) + 'NOTHING — the screen will show an error');
        gaps.push(`${dietType} × ${mealPlan}`);
        continue;
      }
      if (chosen.basis !== 'both') gaps.push(`${dietType} × ${mealPlan}`);
      say(pad(dietType, 16) + pad(mealPlan, 14) + pad(chosen.row.name, 24) + WHY[chosen.basis]);
    }
  }

  say();
  if (gaps.length === 0) {
    say('Every kind of member has a plan written for them.');
    return;
  }
  say(`${gaps.length} combination(s) have no plan of their own and fall back:`);
  say(`  ${gaps.join(', ')}`);
  say('A member can still pick any plan by hand; this is only the default.');
}

export async function importFile(path: string): Promise<void> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const entries: unknown[] = Array.isArray(parsed)
    ? parsed
    : (parsed as { plans?: unknown[] }).plans ?? [parsed];

  const plans: AdminPlanFileEntry[] = entries.map((entry, index) => {
    const result = adminPlanFileEntry.safeParse(entry);
    if (!result.success) {
      const issues = result.error.issues
        .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`Plan ${index + 1} in ${path} is not usable — ${issues}`);
    }
    return result.data;
  });

  say(`${plans.length} plan(s) in ${path}.`);
  for (const plan of plans) {
    const id = plan.id ?? newId('plan');
    const before = await DietPlanModel.findById(id).lean<PlanRow | null>();
    const fields = { ...plan };
    delete fields.id;
    await DietPlanModel.updateOne(
      { _id: id },
      {
        $set: {
          ...fields,
          description: fields.description ?? '',
          emoji: fields.emoji ?? '🥗',
          sort: fields.sort ?? 0,
          active: fields.active ?? true,
          updatedBy: ACTOR,
        },
      },
      { upsert: true },
    );
    await audit(before ? 'diet_plan.updated' : 'diet_plan.created', id, before, { id, ...fields });
    say(`  ${before ? 'replaced' : 'added  '}  ${pad(id, 26)}${plan.name}  (${plan.days.length} day${plan.days.length === 1 ? '' : 's'})`);
  }
  say();
  say('`npm run plans resolve` says which members now get which of them.');
}

/** Retiring frees every member who had chosen it, exactly as the API does. */
export async function setActive(planId: string, active: boolean): Promise<void> {
  const before = await DietPlanModel.findById(planId).lean<PlanRow | null>();
  if (!before) throw new Error(`No plan with id ${planId}.`);
  await DietPlanModel.updateOne({ _id: planId }, { $set: { active, updatedBy: ACTOR } });
  let released = 0;
  if (!active) {
    const result = await NutritionProfileModel.updateMany(
      { selectedPlanId: planId },
      { $set: { selectedPlanId: null } },
    );
    released = result.modifiedCount ?? 0;
  }
  await audit(active ? 'diet_plan.updated' : 'diet_plan.retired', planId, before, { active, released });
  say(`${active ? 'Back in the library' : 'Out of the library'}: ${before.name}`);
  if (!active && released > 0) {
    say(`${released} member(s) were following it and are back on the server's own choice.`);
  }
}

export async function retireSeed(): Promise<void> {
  const rows = await DietPlanModel.find({ active: true }).lean<(PlanRow & { updatedBy?: string })[]>();
  const shipped = rows.filter(row => (row.updatedBy ?? 'seed') === 'seed');
  if (shipped.length === 0) {
    say('No shipped demo plans are on offer. Nothing to do.');
    return;
  }
  const mine = rows.length - shipped.length;
  if (mine === 0) {
    say('These are the only plans in the library:');
    for (const row of shipped) say(`  ${row.name}`);
    say();
    say('Retiring all of them would leave members with no plan at all and the');
    say('Diet Plan screen with an error. Import your own first, then run this.');
    return;
  }
  for (const row of shipped) await setActive(row._id, false);
}

const USAGE = `Usage:
  npm run plans list
  npm run plans show <id>
  npm run plans resolve
  npm run plans import <file.json>
  npm run plans retire <id>
  npm run plans restore <id>
  npm run plans retire-seed`;

/** One command, so a test can run the tool rather than a copy of it. */
export async function runPlans(argv: readonly string[]): Promise<void> {
  const [command, argument] = argv;
  switch (command) {
    case 'list':
      return list();
    case 'show':
      if (!argument) throw new Error('Which plan? `npm run plans show <id>`');
      return show(argument);
    case 'resolve':
      return resolve();
    case 'import':
      if (!argument) throw new Error('Which file? `npm run plans import diet-plans.json`');
      return importFile(argument);
    case 'retire':
      if (!argument) throw new Error('Which plan? `npm run plans retire <id>`');
      return setActive(argument, false);
    case 'restore':
      if (!argument) throw new Error('Which plan? `npm run plans restore <id>`');
      return setActive(argument, true);
    case 'retire-seed':
      return retireSeed();
    default:
      say(USAGE);
      return;
  }
}

// Only when run as a script. Imported — by a test, say — it connects to
// nothing and runs nothing of its own.
const isEntry =
  process.argv[1]?.endsWith('diet-plans.ts') || process.argv[1]?.endsWith('diet-plans.js');
if (isEntry) {
  connectMongo()
    .then(() => runPlans(process.argv.slice(2)))
    .catch(err => {
      logger.error({ err: err instanceof Error ? err.message : err }, 'plans failed');
      process.exitCode = 1;
    })
    .finally(disconnectMongo);
}
