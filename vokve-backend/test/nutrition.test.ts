import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDays, localDayOf } from '../src/lib/dates.js';
import { FoodEntryModel } from '../src/modules/nutrition/models.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

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
    });

    const res = await request(app).put('/v1/nutrition/profile').set(authed(session))
      .send({ goals: { calories: 1900 }, preferences: { mealPlan: 'high_protein' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      goals: { calories: 1900, proteinG: 120, carbsG: 300, fatsG: 70 },
      preferences: { dietType: 'vegetarian', mealPlan: 'high_protein', goal: 'gain_weight' },
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
    expect(plan).toMatchObject({ date: today(), cycleLength: 4, basis: 'Vegetarian · Balanced' });
    expect(plan.meals.map((m: { slot: string }) => m.slot)).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
    expect(plan.totals.calories).toBe(plan.meals.reduce((sum: number, m: { calories: number }) => sum + m.calories, 0));
    // No meat in a vegetarian plan.
    const names = plan.meals.flatMap((m: { items: { name: string }[] }) => m.items.map(i => i.name)).join(' ');
    expect(names).not.toMatch(/chicken|fish/i);

    // The same date is the same plan, however often it is asked for.
    expect((await request(app).get(`/v1/diet-plan?date=${today()}`).set(authed(session))).body.meals)
      .toEqual(plan.meals);

    await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ preferences: { dietType: 'non_vegetarian', mealPlan: 'high_protein' } });
    expect((await request(app).get('/v1/diet-plan').set(authed(session))).body).toMatchObject({ cycleLength: 3, basis: 'Non-vegetarian · High protein' });

    // Keto has no vegan days: the vegan ones stand in.
    await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ preferences: { dietType: 'vegan', mealPlan: 'keto' } });
    expect((await request(app).get('/v1/diet-plan').set(authed(session))).body.cycleLength).toBe(2);
  });

  it('lists a run of days’ plans in brief', async () => {
    const session = await signUpAndRegister();
    const days = (await request(app).get(`/v1/diet-plan/days?from=${today()}&to=${addDays(today(), 6)}`).set(authed(session))).body;
    expect(days).toHaveLength(7);
    expect(days.every((d: { meals: number; calories: number }) => d.meals === 4 && d.calories > 0)).toBe(true);
  });
});
