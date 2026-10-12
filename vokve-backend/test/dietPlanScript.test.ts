import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DietPlanModel, NutritionProfileModel } from '../src/modules/nutrition/models.js';
import { AuditLogModel } from '../src/modules/platform/models.js';
import {
  importFile,
  list,
  resolve,
  retireSeed,
  runPlans,
  setActive,
  show,
} from '../src/scripts/diet-plans.js';
import { seed } from '../src/seed/seed.js';

/**
 * The operator's own tool. It exists to answer "is the screen showing my plan
 * or the demo one", so what is checked here is what it *prints* as much as
 * what it writes: a report that is wrong is worse than no report.
 */

let written: string[] = [];

beforeEach(async () => {
  written = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    written.push(String(chunk));
    return true;
  });
  await seed();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const printed = () => written.join('');

const planFile = (plans: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), 'vokve-plans-'));
  const path = join(dir, 'plans.json');
  writeFileSync(path, JSON.stringify(plans), 'utf8');
  return path;
};

const samplePlan = (over: Record<string, unknown> = {}) => ({
  id: 'plan-my-veg-week',
  name: 'My Veg Week',
  description: 'Ours, not the seed’s.',
  emoji: '🥗',
  dietTypes: ['vegetarian'],
  mealPlans: ['balanced'],
  days: [
    {
      label: 'Day 1',
      meals: [
        { slot: 'breakfast', time: '08:00', calories: 300, proteinG: 15, carbsG: 40, fatsG: 8, items: [{ name: 'Idli', quantity: '3' }] },
        { slot: 'dinner', time: '20:00', calories: 500, proteinG: 25, carbsG: 50, fatsG: 15, items: [] },
      ],
    },
  ],
  ...over,
});

describe('npm run plans: reading the library', () => {
  it('lists every plan and says which are the shipped demo ones', async () => {
    await list();
    const out = printed();

    expect(out).toContain('plan-everyday-veg');
    expect(out).toContain('Everyday Veg');
    expect(out).toContain('seed (shipped)');
    // The figures a member sees, so the two can be compared.
    expect(out).toMatch(/Everyday Veg\s+yes\s+3\s+\d{3,4}/);
    // And the way out of the demo data.
    expect(out).toContain('3 of these are the demo plans the app shipped with.');
    expect(out).toContain('retire-seed');
  });

  it('marks a plan the operator has written as theirs', async () => {
    await importFile(planFile([samplePlan()]));
    written = [];
    await list();

    expect(printed()).toMatch(/plan-my-veg-week\s+My Veg Week\s+yes\s+1\s+800\s+operator/);
  });

  it('prints one plan as a menu, day by day', async () => {
    await show('plan-everyday-veg');
    const out = printed();

    expect(out).toContain('Everyday Veg');
    expect(out).toContain('3 day rotation');
    expect(out).toContain('Day 1');
    expect(out).toContain('Day 3');
    expect(out).toContain('08:00');
    expect(out).toContain('breakfast');
    // The items, not just the figures — this is the thing a dietitian reads.
    expect(out).toContain('Besan chilla');
  });

  it('says so rather than throwing when the id is not there', async () => {
    await expect(show('plan-nope')).rejects.toThrow('No plan with id plan-nope.');
  });
});

describe('npm run plans: who gets what', () => {
  it('names the plan each kind of member is handed, and why', async () => {
    await resolve();
    const out = printed();

    // The default preferences (vegetarian · balanced, RULES N4).
    expect(out).toMatch(/vegetarian\s+balanced\s+Everyday Veg\s+matches diet type \+ meal plan/);
    expect(out).toMatch(/non_vegetarian\s+high_protein\s+High-Protein Non-Veg/);
    // Keto has no plan written for it: the fallback is named as a fallback.
    expect(out).toMatch(/vegan\s+keto\s+Plant-Based\s+matches the diet type only/);
    expect(out).toContain('have no plan of their own and fall back');
  });

  it('warns loudly when a member would get nothing at all', async () => {
    await DietPlanModel.updateMany({}, { $set: { active: false } });
    await resolve();
    const out = printed();

    expect(out).toContain('NOTHING — the screen will show an error');
  });

  it('follows the library, so an import changes the answer', async () => {
    // A plan of the operator's, sorted ahead of the shipped ones.
    await importFile(planFile([samplePlan({ sort: 0 })]));
    written = [];
    await resolve();

    expect(printed()).toMatch(/vegetarian\s+balanced\s+My Veg Week/);
  });
});

describe('npm run plans: writing', () => {
  it('imports a file, and re-importing it replaces rather than duplicates', async () => {
    const path = planFile([samplePlan()]);
    await importFile(path);

    const first = await DietPlanModel.findById('plan-my-veg-week').lean();
    expect(first).toMatchObject({ name: 'My Veg Week', updatedBy: 'operator', active: true });
    expect(await DietPlanModel.countDocuments({ name: 'My Veg Week' })).toBe(1);
    expect(printed()).toContain('added');

    written = [];
    await importFile(planFile([samplePlan({ name: 'My Veg Week v2' })]));

    expect(await DietPlanModel.countDocuments({ _id: 'plan-my-veg-week' })).toBe(1);
    expect(await DietPlanModel.findById('plan-my-veg-week').lean()).toMatchObject({
      name: 'My Veg Week v2',
    });
    expect(printed()).toContain('replaced');
  });

  it('gives a plan with no id an id of its own', async () => {
    const withoutId = { ...samplePlan() };
    delete (withoutId as { id?: string }).id;
    await importFile(planFile([withoutId]));

    const row = await DietPlanModel.findOne({ name: 'My Veg Week' }).lean();
    expect(row?._id).toMatch(/^plan_/);
  });

  it('refuses a file it cannot use, naming the field', async () => {
    const bad = planFile([samplePlan({ days: [{ meals: [{ slot: 'brunch', time: '08:00', calories: 300 }] }] })]);
    await expect(importFile(bad)).rejects.toThrow(/Plan 1 .* days\.0\.meals\.0\.slot/s);

    const noDays = planFile([samplePlan({ days: [] })]);
    await expect(importFile(noDays)).rejects.toThrow(/days/);

    // And nothing was written: a half-imported file is worse than none.
    expect(await DietPlanModel.countDocuments({ name: 'My Veg Week' })).toBe(0);
  });

  it('records every write in the audit log, as the operator', async () => {
    await importFile(planFile([samplePlan()]));

    const entries = await AuditLogModel.find({ subjectId: 'plan-my-veg-week' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorType: 'admin',
      actorId: 'operator',
      action: 'diet_plan.created',
      subjectType: 'diet_plan',
    });
  });
});

describe('npm run plans: retiring', () => {
  it('retiring frees every member who had chosen it', async () => {
    await NutritionProfileModel.create({
      _id: 'user-1',
      goals: { calories: 2200, proteinG: 120, carbsG: 300, fatsG: 70 },
      preferences: { dietType: 'vegetarian', mealPlan: 'balanced', goal: 'maintain' },
      selectedPlanId: 'plan-everyday-veg',
    });

    await setActive('plan-everyday-veg', false);

    expect(await DietPlanModel.findById('plan-everyday-veg').lean()).toMatchObject({ active: false });
    expect(await NutritionProfileModel.findById('user-1').lean()).toMatchObject({ selectedPlanId: null });
    const out = printed();
    expect(out).toContain('Out of the library: Everyday Veg');
    expect(out).toContain("1 member(s) were following it and are back on the server's own choice.");
  });

  it('restore puts it back without touching anybody’s choice', async () => {
    await setActive('plan-everyday-veg', false);
    written = [];
    await setActive('plan-everyday-veg', true);

    expect(await DietPlanModel.findById('plan-everyday-veg').lean()).toMatchObject({ active: true });
    expect(printed()).toContain('Back in the library: Everyday Veg');
  });

  it('retire-seed refuses to leave the library empty', async () => {
    await retireSeed();

    const out = printed();
    expect(out).toContain('Retiring all of them would leave members with no plan at all');
    expect(await DietPlanModel.countDocuments({ active: true })).toBe(3);
  });

  it('retire-seed clears the demo plans once there is one of your own', async () => {
    await importFile(planFile([samplePlan()]));
    written = [];
    await retireSeed();

    const active = await DietPlanModel.find({ active: true }).lean();
    expect(active.map(row => row._id)).toEqual(['plan-my-veg-week']);
    // And it does not touch the operator's own plan.
    expect(printed()).not.toContain('My Veg Week');
  });

  it('a plan retired this way stays retired through a re-seed', async () => {
    await importFile(planFile([samplePlan()]));
    await retireSeed();

    await seed();

    expect(await DietPlanModel.findById('plan-everyday-veg').lean()).toMatchObject({ active: false });
  });
});

describe('npm run plans: the command line itself', () => {
  it('prints what it can do when asked for nothing', async () => {
    await runPlans([]);
    expect(printed()).toContain('npm run plans list');
    expect(printed()).toContain('npm run plans retire-seed');
  });

  it('asks which plan when a command needs one', async () => {
    await expect(runPlans(['show'])).rejects.toThrow('Which plan?');
    await expect(runPlans(['import'])).rejects.toThrow('Which file?');
  });

  it('routes each command to its own job', async () => {
    await runPlans(['list']);
    expect(printed()).toContain('plan-everyday-veg');

    written = [];
    await runPlans(['resolve']);
    expect(printed()).toContain('What the server chooses');
  });
});
