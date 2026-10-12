import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDays, localDayOf } from '../src/lib/dates.js';
import { FoodEntryModel } from '../src/modules/nutrition/models.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';
import { seed } from '../src/seed/seed.js';

const ZONE = 'Asia/Kolkata';
const today = () => localDayOf(new Date(), ZONE);

const food = (id: string, over: Record<string, unknown> = {}) => ({
  id, slot: 'breakfast', name: 'Oats (Cooked)', portion: '1 Cup (150 g)', calories: 150,
  proteinG: 5, carbsG: 27, fatsG: 3, fiberG: 4, loggedAt: new Date(Date.now() - 60_000).toISOString(), ...over,
});

function save(session: Session, entries: unknown[], key = Math.random().toString(36)) {
  return request(app).post('/v1/nutrition/entries').set({ ...authed(session), 'idempotency-key': key }).send({ entries });
}

describe('nutrition: profile (RULES N4)', () => {
  it('starts on the defaults, and changes field by field within bounds', async () => {
    const session = await signUpAndRegister();
    const first = (await request(app).get('/v1/nutrition/profile').set(authed(session))).body;
    expect(first).toEqual({
      goals: { calories: 2200, proteinG: 120, carbsG: 300, fatsG: 70 },
      preferences: { dietType: 'vegetarian', mealPlan: 'balanced', goal: 'gain_weight' },
      selectedPlanId: null,
    });

    const res = await request(app).put('/v1/nutrition/profile').set(authed(session))
      .send({ goals: { calories: 1900 }, preferences: { mealPlan: 'high_protein' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      goals: { calories: 1900, proteinG: 120, carbsG: 300, fatsG: 70 },
      preferences: { dietType: 'vegetarian', mealPlan: 'high_protein', goal: 'gain_weight' },
      selectedPlanId: null,
    });

    const bad = await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ goals: { calories: 100 } });
    expect(bad.status).toBe(422);
  });
});

describe('nutrition: the diary (RULES N2, N3)', () => {
  it('logs a meal at once, adds it up, and a retried save is the same plate', async () => {
    const session = await signUpAndRegister();
    const meal = [food('f1'), food('f2', { name: '  Banana ', portion: '1 Medium (118 g)', calories: 88.6, proteinG: 1, carbsG: 23, fatsG: 0.3, fiberG: 2.6 })];
    const res = await save(session, meal);
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(today());
    expect(res.body.entries.map((e: { id: string; name: string }) => [e.id, e.name])).toEqual([['f1', 'Oats (Cooked)'], ['f2', 'Banana']]);
    expect(res.body.totals).toEqual({ calories: 239, proteinG: 6, carbsG: 50, fatsG: 3.3, fiberG: 6.6 });
    expect(res.body.goals.calories).toBe(2200);

    // The same foods again, with one more — only the new one is added.
    const again = await save(session, [...meal, food('f3', { slot: 'lunch', name: 'Dal', calories: 180 })]);
    expect(again.status).toBe(200);
    expect(again.body.entries).toHaveLength(3);
    expect(await FoodEntryModel.countDocuments({ userId: session.userId })).toBe(3);
  });

  it('refuses a nameless food, one from too long ago, and an empty save', async () => {
    const session = await signUpAndRegister();
    expect((await save(session, [food('x', { name: '   ' })])).status).toBe(422);
    expect((await save(session, [food('y', { loggedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() })])).status).toBe(422);
    expect((await save(session, [])).status).toBe(422);
  });

  it('takes a food back out; another member’s food is not found', async () => {
    const session = await signUpAndRegister();
    const other = await signUpAndRegister();
    await save(session, [food('f1'), food('f2', { calories: 100 })]);

    const res = await request(app).delete('/v1/nutrition/entries/f1').set(authed(session));
    expect(res.status).toBe(200);
    expect(res.body.totals.calories).toBe(100);
    expect((await request(app).delete('/v1/nutrition/entries/f2').set(authed(other))).status).toBe(404);
  });

  it('reads a day back, and a run of days with every day present', async () => {
    const session = await signUpAndRegister();
    const yesterday = addDays(today(), -1);
    await save(session, [food('f1', { loggedAt: `${yesterday}T03:30:00.000Z`, calories: 400 })]);
    await save(session, [food('f2', { calories: 250 }), food('f3', { calories: 50 })]);

    const day = (await request(app).get(`/v1/nutrition/day?date=${yesterday}`).set(authed(session))).body;
    expect(day).toMatchObject({ date: yesterday, totals: { calories: 400 } });

    const days = (await request(app).get(`/v1/nutrition/days?from=${addDays(today(), -2)}&to=${today()}`).set(authed(session))).body;
    expect(days.map((d: { date: string; items: number; calories: number }) => [d.date, d.items, d.calories])).toEqual([
      [addDays(today(), -2), 0, 0],
      [yesterday, 1, 400],
      [today(), 2, 300],
    ]);
  });
});

describe('nutrition: the library (RULES N8)', () => {
  it('finds foods by word prefix, serves the shortcuts, and keeps a custom food to its owner', async () => {
    const session = await signUpAndRegister();
    const other = await signUpAndRegister();

    const oats = (await request(app).get('/v1/foods?q=oat').set(authed(session))).body;
    expect(oats.map((f: { name: string }) => f.name)).toEqual(['Oats (Cooked)']);
    const cooked = (await request(app).get('/v1/foods?q=cook').set(authed(session))).body;
    expect(cooked.map((f: { name: string }) => f.name)).toEqual(['Oats (Cooked)']);
    expect((await request(app).get('/v1/foods?q=ats').set(authed(session))).body).toEqual([]);

    const quick = (await request(app).get('/v1/foods/quick-add').set(authed(session))).body;
    expect(quick.map((f: { id: string }) => f.id)).toEqual(['fl-oats', 'fl-banana', 'fl-egg', 'fl-peanut-butter']);

    const mine = await request(app).post('/v1/foods/custom').set(authed(session))
      .send({ name: 'Masala Oats', portion: '1 Packet', calories: 230, proteinG: 6 });
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ name: 'Masala Oats', emoji: '🍽️', calories: 230 });

    const withMine = (await request(app).get('/v1/foods?q=oat').set(authed(session))).body;
    expect(withMine.map((f: { name: string }) => f.name)).toEqual(['Masala Oats', 'Oats (Cooked)']);
    const theirs = (await request(app).get('/v1/foods?q=masala').set(authed(other))).body;
    expect(theirs).toEqual([]);
  });
});

describe('nutrition: the diet plan (RULES N6, N7)', () => {
  it('cycles through the days that suit the preferences, in clock order', async () => {
    const session = await signUpAndRegister();
    const plan = (await request(app).get(`/v1/diet-plan?date=${today()}`).set(authed(session))).body;
    expect(plan).toMatchObject({
      date: today(), cycleLength: 3, basis: 'Vegetarian · Balanced',
      planId: 'plan-everyday-veg', planName: 'Everyday Veg', chosenByUser: false,
    });
    expect(plan.dayNumber).toBeGreaterThanOrEqual(1);
    expect(plan.meals.map((m: { slot: string }) => m.slot)).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
    expect(plan.totals.calories).toBe(plan.meals.reduce((sum: number, m: { calories: number }) => sum + m.calories, 0));
    // No meat in a vegetarian plan.
    const names = plan.meals.flatMap((m: { items: { name: string }[] }) => m.items.map(i => i.name)).join(' ');
    expect(names).not.toMatch(/chicken|fish/i);

    // The same date is the same plan, however often it is asked for.
    expect((await request(app).get(`/v1/diet-plan?date=${today()}`).set(authed(session))).body.meals)
      .toEqual(plan.meals);

    await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ preferences: { dietType: 'non_vegetarian', mealPlan: 'high_protein' } });
    expect((await request(app).get('/v1/diet-plan').set(authed(session))).body).toMatchObject({
      cycleLength: 2, basis: 'Non-vegetarian · High protein', planName: 'High-Protein Non-Veg',
    });

    // Keto suits no plan: the one written for the diet type stands in.
    await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ preferences: { dietType: 'vegan', mealPlan: 'keto' } });
    expect((await request(app).get('/v1/diet-plan').set(authed(session))).body).toMatchObject({
      cycleLength: 2, planName: 'Plant-Based',
    });
  });

  it('lists a run of days’ plans in brief', async () => {
    const session = await signUpAndRegister();
    const days = (await request(app).get(`/v1/diet-plan/days?from=${today()}&to=${addDays(today(), 6)}`).set(authed(session))).body;
    expect(days).toHaveLength(7);
    expect(days.every((d: { meals: number; calories: number }) => d.meals === 4 && d.calories > 0)).toBe(true);
  });
});

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

const planBody = (over: Record<string, unknown> = {}) => ({
  name: 'Office Lunch Plan',
  description: 'Two days built around what a canteen actually serves.',
  emoji: '🍱',
  dietTypes: ['vegetarian'],
  mealPlans: ['balanced'],
  days: [
    { label: 'Day one', meals: [{ slot: 'breakfast', time: '08:00', calories: 300, proteinG: 15, carbsG: 40, fatsG: 8, items: [{ name: 'Idli', quantity: '3' }] }] },
    { meals: [{ slot: 'lunch', time: '13:00', calories: 500, proteinG: 20, carbsG: 70, fatsG: 12, items: [] }] },
  ],
  ...over,
});

describe('nutrition: choosing a diet plan (RULES N10)', () => {
  it('lists the library with the suiting plans first, and says which is in force', async () => {
    const session = await signUpAndRegister();
    const plans = (await request(app).get('/v1/diet-plans').set(authed(session))).body;
    expect(plans.map((p: { id: string }) => p.id)).toEqual([
      'plan-everyday-veg', 'plan-high-protein-nonveg', 'plan-plant-based',
    ]);
    expect(plans[0]).toMatchObject({
      name: 'Everyday Veg', dayCount: 3, mealsPerDay: 4, suitsPreferences: true, selected: false,
    });
    expect(plans[0].perDay.calories).toBeGreaterThan(0);
    // The others are still listed — a vegetarian may read a plan written for someone else.
    expect(plans[1]).toMatchObject({ suitsPreferences: false });
  });

  it('reads a plan whole, every day of it in clock order', async () => {
    const session = await signUpAndRegister();
    const plan = (await request(app).get('/v1/diet-plans/plan-plant-based').set(authed(session))).body;
    expect(plan).toMatchObject({ id: 'plan-plant-based', name: 'Plant-Based', dayCount: 2 });
    expect(plan.days.map((d: { dayNumber: number }) => d.dayNumber)).toEqual([1, 2]);
    for (const day of plan.days) {
      expect(day.meals.map((m: { slot: string }) => m.slot)).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
      expect(day.totals.calories).toBe(day.meals.reduce((sum: number, m: { calories: number }) => sum + m.calories, 0));
    }
    // Meal ids are unique across the whole plan, not just within a day.
    const ids = plan.days.flatMap((d: { meals: { id: string }[] }) => d.meals.map(m => m.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a chosen plan outranks the preferences, and null hands the choice back', async () => {
    const session = await signUpAndRegister();
    const chosen = await request(app).put('/v1/nutrition/profile').set(authed(session))
      .send({ selectedPlanId: 'plan-high-protein-nonveg' });
    expect(chosen.status).toBe(200);
    expect(chosen.body.selectedPlanId).toBe('plan-high-protein-nonveg');

    const plan = (await request(app).get('/v1/diet-plan').set(authed(session))).body;
    expect(plan).toMatchObject({ planId: 'plan-high-protein-nonveg', planName: 'High-Protein Non-Veg', chosenByUser: true, cycleLength: 2 });
    // The basis still describes the preferences — it is not a second claim about the plan.
    expect(plan.basis).toBe('Vegetarian · Balanced');

    // Changing a preference leaves the choice alone (N10).
    await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ preferences: { dietType: 'vegan' } });
    expect((await request(app).get('/v1/diet-plan').set(authed(session))).body.planId).toBe('plan-high-protein-nonveg');

    const listed = (await request(app).get('/v1/diet-plans').set(authed(session))).body;
    expect(listed.find((p: { id: string }) => p.id === 'plan-high-protein-nonveg').selected).toBe(true);

    const released = await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ selectedPlanId: null });
    expect(released.body.selectedPlanId).toBeNull();
    expect((await request(app).get('/v1/diet-plan').set(authed(session))).body).toMatchObject({
      planId: 'plan-plant-based', chosenByUser: false,
    });
  });

  it('refuses a plan that is not on offer', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ selectedPlanId: 'plan-nope' });
    expect(res.status).toBe(404);
    expect((await request(app).get('/v1/nutrition/profile').set(authed(session))).body.selectedPlanId).toBeNull();
    expect((await request(app).get('/v1/diet-plans/plan-nope').set(authed(session))).body.error.code).toBe('NOT_FOUND');
  });
});

describe('nutrition: the admin diet plan API (RULES N10)', () => {
  it('turns a member away, with or without a token', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get('/v1/admin/diet-plans')).status).toBe(401);
    expect((await request(app).get('/v1/admin/diet-plans').set(authed(session))).status).toBe(401);
    expect((await request(app).get('/v1/admin/diet-plans').set({ 'x-admin-key': 'wrong' })).status).toBe(401);
    expect((await request(app).post('/v1/admin/diet-plans').send(planBody())).status).toBe(401);
  });

  it('creates a plan a member can then see and choose', async () => {
    const session = await signUpAndRegister();
    const created = await request(app).post('/v1/admin/diet-plans').set(ADMIN).send(planBody());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Office Lunch Plan', active: true, updatedBy: 'admin' });
    const id = created.body.id;

    const listed = (await request(app).get('/v1/diet-plans').set(authed(session))).body;
    expect(listed.find((p: { id: string }) => p.id === id)).toMatchObject({
      name: 'Office Lunch Plan', dayCount: 2, suitsPreferences: true,
    });

    const detail = (await request(app).get(`/v1/diet-plans/${id}`).set(authed(session))).body;
    expect(detail.days[0]).toMatchObject({ dayNumber: 1, label: 'Day one' });
    expect(detail.days[0].meals[0]).toMatchObject({ slot: 'breakfast', time: '08:00', calories: 300 });

    const chosen = await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ selectedPlanId: id });
    expect(chosen.status).toBe(200);
    expect((await request(app).get('/v1/diet-plan').set(authed(session))).body).toMatchObject({
      planId: id, planName: 'Office Lunch Plan', cycleLength: 2, chosenByUser: true,
    });
  });

  it('refuses a plan with no days, no meals or a malformed meal', async () => {
    expect((await request(app).post('/v1/admin/diet-plans').set(ADMIN).send(planBody({ days: [] }))).status).toBe(422);
    expect((await request(app).post('/v1/admin/diet-plans').set(ADMIN).send(planBody({ days: [{ meals: [] }] }))).status).toBe(422);
    expect((await request(app).post('/v1/admin/diet-plans').set(ADMIN)
      .send(planBody({ days: [{ meals: [{ slot: 'brunch', time: '08:00', calories: 300 }] }] }))).status).toBe(422);
    expect((await request(app).post('/v1/admin/diet-plans').set(ADMIN)
      .send(planBody({ days: [{ meals: [{ slot: 'breakfast', time: '8am', calories: 300 }] }] }))).status).toBe(422);
    expect((await request(app).post('/v1/admin/diet-plans').set(ADMIN).send(planBody({ dietTypes: [] }))).status).toBe(422);
  });

  it('edits a plan, and the member’s day follows at once', async () => {
    const session = await signUpAndRegister();
    const id = (await request(app).post('/v1/admin/diet-plans').set(ADMIN).send(planBody())).body.id;
    await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ selectedPlanId: id });

    const edited = await request(app).put(`/v1/admin/diet-plans/${id}`).set(ADMIN).send({
      name: 'Canteen Plan',
      days: [{ meals: [{ slot: 'dinner', time: '20:00', calories: 450, proteinG: 25, carbsG: 50, fatsG: 10, items: [] }] }],
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: 'Canteen Plan', description: 'Two days built around what a canteen actually serves.' });

    const day = (await request(app).get('/v1/diet-plan').set(authed(session))).body;
    expect(day).toMatchObject({ planName: 'Canteen Plan', cycleLength: 1, dayNumber: 1 });
    expect(day.meals).toHaveLength(1);
    expect(day.totals.calories).toBe(450);
  });

  it('retiring a plan takes it out of the library and frees the members on it', async () => {
    const session = await signUpAndRegister();
    const id = (await request(app).post('/v1/admin/diet-plans').set(ADMIN).send(planBody())).body.id;
    await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ selectedPlanId: id });

    const retired = await request(app).delete(`/v1/admin/diet-plans/${id}`).set(ADMIN);
    expect(retired.status).toBe(200);
    expect(retired.body).toMatchObject({ released: 1 });
    expect(retired.body.plan).toMatchObject({ active: false });

    // Out of the library, and the member is back on the server's own choice.
    const listed = (await request(app).get('/v1/diet-plans').set(authed(session))).body;
    expect(listed.some((p: { id: string }) => p.id === id)).toBe(false);
    expect((await request(app).get('/v1/nutrition/profile').set(authed(session))).body.selectedPlanId).toBeNull();
    expect((await request(app).get('/v1/diet-plan').set(authed(session))).body).toMatchObject({
      planId: 'plan-everyday-veg', chosenByUser: false,
    });
    // And it cannot be chosen again while it is retired.
    expect((await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ selectedPlanId: id })).status).toBe(404);

    // The operator still sees it, and can put it back.
    const all = (await request(app).get('/v1/admin/diet-plans').set(ADMIN)).body;
    expect(all.find((p: { id: string }) => p.id === id)).toMatchObject({ active: false });
    await request(app).put(`/v1/admin/diet-plans/${id}`).set(ADMIN).send({ active: true });
    expect((await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ selectedPlanId: id })).status).toBe(200);
  });
});

const foodBody = (over: Record<string, unknown> = {}) => ({
  name: 'Chapati', portion: '1 piece (40 g)', emoji: '🫓',
  calories: 104, proteinG: 3, carbsG: 20, fatsG: 1.5, fiberG: 2,
  ...over,
});

describe('nutrition: browsing the food library (RULES N8)', () => {
  it('pages through the whole library, the member’s own foods first', async () => {
    const session = await signUpAndRegister();
    const first = (await request(app).get('/v1/foods/library?limit=5').set(authed(session))).body;
    expect(first.data).toHaveLength(5);
    expect(first.total).toBeGreaterThan(5);
    expect(first.nextCursor).toBeTruthy();

    const second = (await request(app).get(`/v1/foods/library?limit=5&cursor=${encodeURIComponent(first.nextCursor)}`).set(authed(session))).body;
    expect(second.data).toHaveLength(5);
    // A page is the next five, not the same five again.
    expect(second.data.map((f: { id: string }) => f.id)).not.toEqual(first.data.map((f: { id: string }) => f.id));
    expect(second.total).toBe(first.total);

    // Walking to the end gives every row once and then stops.
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const url: string = `/v1/foods/library?limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const body = (await request(app).get(url).set(authed(session))).body as {
        data: { id: string }[];
        nextCursor: string | null;
      };
      for (const food of body.data) seen.add(food.id);
      cursor = body.nextCursor;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull();
    expect(seen.size).toBe(first.total);

    // Their own custom food leads the list.
    await request(app).post('/v1/foods/custom').set(authed(session))
      .send({ name: 'Aloo Paratha', portion: '1 piece', calories: 300 });
    const mine = (await request(app).get('/v1/foods/library?limit=5').set(authed(session))).body;
    expect(mine.data[0].name).toBe('Aloo Paratha');
    expect(mine.total).toBe(first.total + 1);
  });

  it('narrows the library by word prefix, and keeps another member’s food out', async () => {
    const session = await signUpAndRegister();
    const other = await signUpAndRegister();
    await request(app).post('/v1/foods/custom').set(authed(other))
      .send({ name: 'Secret Shake', portion: '1 glass', calories: 200 });

    const found = (await request(app).get('/v1/foods/library?q=oat').set(authed(session))).body;
    expect(found.total).toBe(found.data.length);
    expect(found.data.every((f: { name: string }) => /oat/i.test(f.name))).toBe(true);

    const hidden = (await request(app).get('/v1/foods/library?q=secret').set(authed(session))).body;
    expect(hidden.data).toEqual([]);
    expect(hidden.total).toBe(0);
  });
});

describe('nutrition: the admin food API (RULES N8, N11)', () => {
  it('turns a member away', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get('/v1/admin/foods')).status).toBe(401);
    expect((await request(app).get('/v1/admin/foods').set(authed(session))).status).toBe(401);
    expect((await request(app).post('/v1/admin/foods').send(foodBody())).status).toBe(401);
  });

  it('adds a food a member can then search, browse and quick-add', async () => {
    const session = await signUpAndRegister();
    const created = await request(app).post('/v1/admin/foods').set(ADMIN).send(foodBody({ quickAdd: true, sort: 20 }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Chapati', portion: '1 piece (40 g)', calories: 104, quickAdd: true, active: true, updatedBy: 'admin' });
    const id = created.body.id;

    const searched = (await request(app).get('/v1/foods?q=chap').set(authed(session))).body;
    expect(searched.map((f: { id: string }) => f.id)).toContain(id);

    const browsed = (await request(app).get('/v1/foods/library?q=chapati').set(authed(session))).body;
    expect(browsed.data[0]).toMatchObject({ id, name: 'Chapati', calories: 104, proteinG: 3 });

    const shortcuts = (await request(app).get('/v1/foods/quick-add').set(authed(session))).body;
    expect(shortcuts.map((f: { id: string }) => f.id)).toContain(id);
  });

  it('adds a whole list in one call', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).post('/v1/admin/foods').set(ADMIN).send({
      foods: [
        foodBody(),
        foodBody({ name: 'Orange', portion: '1 medium (130 g)', emoji: '🍊', calories: 62, proteinG: 1.2, carbsG: 15, fatsG: 0.2, fiberG: 3 }),
        foodBody({ name: 'Idli', portion: '2 pieces', emoji: '🍚', calories: 116 }),
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.map((f: { name: string }) => f.name)).toEqual(['Chapati', 'Orange', 'Idli']);

    const browsed = (await request(app).get('/v1/foods/library?q=orange').set(authed(session))).body;
    expect(browsed.data[0]).toMatchObject({ name: 'Orange', calories: 62 });
  });

  it('refuses a nameless food, a portionless one and absurd figures', async () => {
    expect((await request(app).post('/v1/admin/foods').set(ADMIN).send(foodBody({ name: '  ' }))).status).toBe(422);
    expect((await request(app).post('/v1/admin/foods').set(ADMIN).send(foodBody({ portion: '' }))).status).toBe(422);
    expect((await request(app).post('/v1/admin/foods').set(ADMIN).send(foodBody({ calories: -5 }))).status).toBe(422);
    expect((await request(app).post('/v1/admin/foods').set(ADMIN).send(foodBody({ proteinG: 5000 }))).status).toBe(422);
  });

  it('corrects a food without rewriting what was already eaten', async () => {
    const session = await signUpAndRegister();
    const id = (await request(app).post('/v1/admin/foods').set(ADMIN).send(foodBody())).body.id;

    // A member eats it as it stands.
    await save(session, [food('chapati-1', { name: 'Chapati', portion: '1 piece (40 g)', calories: 104, proteinG: 3, carbsG: 20, fatsG: 1.5, fiberG: 2 })]);

    const fixed = await request(app).put(`/v1/admin/foods/${id}`).set(ADMIN).send({ calories: 120, name: 'Chapati (medium)' });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ name: 'Chapati (medium)', calories: 120, portion: '1 piece (40 g)' });

    // The diary keeps the figures of the day it was eaten (N2).
    const day = (await request(app).get('/v1/nutrition/day').set(authed(session))).body;
    expect(day.entries.find((e: { id: string }) => e.id === 'chapati-1')).toMatchObject({ name: 'Chapati', calories: 104 });
  });

  it('retiring a food takes it out of search, the shortcuts and the library', async () => {
    const session = await signUpAndRegister();
    const id = (await request(app).post('/v1/admin/foods').set(ADMIN).send(foodBody({ quickAdd: true }))).body.id;
    expect((await request(app).get('/v1/foods/quick-add').set(authed(session))).body.map((f: { id: string }) => f.id)).toContain(id);

    const retired = await request(app).delete(`/v1/admin/foods/${id}`).set(ADMIN);
    expect(retired.status).toBe(200);
    expect(retired.body).toMatchObject({ active: false, quickAdd: false });

    expect((await request(app).get('/v1/foods?q=chap').set(authed(session))).body).toEqual([]);
    expect((await request(app).get('/v1/foods/library?q=chapati').set(authed(session))).body.data).toEqual([]);
    expect((await request(app).get('/v1/foods/quick-add').set(authed(session))).body.map((f: { id: string }) => f.id)).not.toContain(id);

    // The operator still sees it and can put it back.
    const all = (await request(app).get('/v1/admin/foods?q=chapati').set(ADMIN)).body;
    expect(all.data[0]).toMatchObject({ id, active: false });
    await request(app).put(`/v1/admin/foods/${id}`).set(ADMIN).send({ active: true });
    expect((await request(app).get('/v1/foods/library?q=chapati').set(authed(session))).body.data[0].id).toBe(id);
  });

  it('cannot see or touch a member’s private food (N8)', async () => {
    const session = await signUpAndRegister();
    const mine = (await request(app).post('/v1/foods/custom').set(authed(session))
      .send({ name: 'Nani ka Halwa', portion: '1 bowl', calories: 250 })).body;

    const listed = (await request(app).get('/v1/admin/foods?q=halwa').set(ADMIN)).body;
    expect(listed.data).toEqual([]);
    expect((await request(app).get(`/v1/admin/foods/${mine.id}`).set(ADMIN)).status).toBe(404);
    expect((await request(app).put(`/v1/admin/foods/${mine.id}`).set(ADMIN).send({ calories: 1 })).status).toBe(404);
    expect((await request(app).delete(`/v1/admin/foods/${mine.id}`).set(ADMIN)).status).toBe(404);

    // Still the member's own, untouched.
    expect((await request(app).get('/v1/foods?q=halwa').set(authed(session))).body[0]).toMatchObject({ calories: 250 });
  });

  it('pages the operator’s own list', async () => {
    await signUpAndRegister(); // seeds the shipped library
    const page = (await request(app).get('/v1/admin/foods?limit=4').set(ADMIN)).body;
    expect(page.data).toHaveLength(4);
    expect(page.total).toBeGreaterThan(4);
    const next = (await request(app).get(`/v1/admin/foods?limit=4&cursor=${encodeURIComponent(page.nextCursor)}`).set(ADMIN)).body;
    expect(next.data.map((f: { id: string }) => f.id)).not.toEqual(page.data.map((f: { id: string }) => f.id));
  });
});

describe('nutrition: the seed and the operator', () => {
  it('a re-seed restores the shipped plans but never an operator’s own edit', async () => {
    const session = await signUpAndRegister(); // seeds
    const shipped = (await request(app).get('/v1/admin/diet-plans').set(ADMIN)).body;
    expect(shipped.map((p: { id: string }) => p.id)).toContain('plan-everyday-veg');
    expect(shipped.every((p: { updatedBy: string }) => p.updatedBy === 'seed')).toBe(true);

    // The operator rewrites one of them, and retires another.
    await request(app).put('/v1/admin/diet-plans/plan-everyday-veg').set(ADMIN)
      .send({ name: 'Our Veg Week', description: 'Written by us.' });
    await request(app).delete('/v1/admin/diet-plans/plan-plant-based').set(ADMIN);

    // And a deploy re-seeds, as every deploy does.
    await seed();

    const after = (await request(app).get('/v1/admin/diet-plans').set(ADMIN)).body;
    const byId = new Map(after.map((p: { id: string }) => [p.id, p]));
    // Theirs stands.
    expect(byId.get('plan-everyday-veg')).toMatchObject({
      name: 'Our Veg Week', description: 'Written by us.', updatedBy: 'admin',
    });
    // One they only retired is still retired — the seed does not put it back on the shelf.
    expect(byId.get('plan-plant-based')).toMatchObject({ active: false });
    // One they never touched is the seed's to keep current.
    expect(byId.get('plan-high-protein-nonveg')).toMatchObject({
      name: 'High-Protein Non-Veg', updatedBy: 'seed',
    });

    // And the member sees the operator's wording, not the seed's.
    const plans = (await request(app).get('/v1/diet-plans').set(authed(session))).body;
    expect(plans.map((p: { name: string }) => p.name)).toContain('Our Veg Week');
    expect(plans.map((p: { id: string }) => p.id)).not.toContain('plan-plant-based');
  });

  it('the same holds for a food the operator has corrected', async () => {
    const session = await signUpAndRegister();
    await request(app).put('/v1/admin/foods/fl-roti').set(ADMIN)
      .send({ name: 'Chapati', calories: 120 });

    await seed();

    const corrected = (await request(app).get('/v1/foods?q=chapati').set(authed(session))).body;
    expect(corrected[0]).toMatchObject({ name: 'Chapati', calories: 120 });
    // An untouched one is still the seed's.
    const oats = (await request(app).get('/v1/foods?q=oats').set(authed(session))).body;
    expect(oats[0]).toMatchObject({ name: 'Oats (Cooked)', calories: 150 });
  });
});
