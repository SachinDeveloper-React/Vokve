import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CoinBalanceModel } from '../src/modules/economy/models.js';
import { OrderModel, ShopItemModel } from '../src/modules/commerce/models.js';
import { FoodItemModel } from '../src/modules/nutrition/models.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

/**
 * What the server suggests a member eats next (RULES N12).
 *
 * Three rules, and the tests are in their order because the order is the
 * design. The first is the one the whole feature lives or dies on: a
 * vegetarian shown chicken does not think "poor suggestion", they think
 * the app does not know them — and they are right, and they do not come
 * back to it. So that is a filter and never a score, and it is checked
 * here against a food that would otherwise win on every other measure.
 *
 * The rest is about refusing to say something rather than saying
 * something useless: nothing that does not fit in the day that is left,
 * and nothing at all when the day is done. A shelf of smaller biscuits
 * against 40 kcal remaining is worse than an empty shelf with a reason.
 */

const suggestions = (session: Session) =>
  request(app).get('/v1/nutrition/suggestions').set(authed(session));

const log = (session: Session, body: Record<string, unknown>, key: string) =>
  request(app)
    .post('/v1/nutrition/entries')
    .set({ ...authed(session), 'idempotency-key': key })
    .send(body);

/** A library with one obvious answer per diet, and one trap. */
async function stockLibrary() {
  await FoodItemModel.deleteMany({ ownerUserId: null });
  await FoodItemModel.insertMany([
    {
      _id: 'f-chicken',
      name: 'Chicken Breast',
      portion: '100 g',
      // The densest protein in the library by a distance — so if diet were
      // a score rather than a filter, this would win for everybody.
      calories: 165, proteinG: 31, carbsG: 0, fatsG: 3.6, fiberG: 0,
      dietTypes: ['non_vegetarian'],
      active: true, ownerUserId: null,
    },
    {
      _id: 'f-paneer',
      name: 'Paneer',
      portion: '100 g',
      calories: 265, proteinG: 18, carbsG: 1.2, fatsG: 21, fiberG: 0,
      dietTypes: ['vegetarian', 'eggetarian', 'non_vegetarian'],
      active: true, ownerUserId: null,
    },
    {
      _id: 'f-rice',
      name: 'Rice',
      portion: '1 cup',
      // Untagged: a plain ingredient suits everyone.
      calories: 200, proteinG: 4, carbsG: 45, fatsG: 0.4, fiberG: 1,
      dietTypes: [],
      active: true, ownerUserId: null,
    },
    {
      _id: 'f-feast',
      name: 'Celebration Thali',
      portion: '1 plate',
      calories: 5000, proteinG: 60, carbsG: 200, fatsG: 70, fiberG: 12,
      dietTypes: [],
      active: true, ownerUserId: null,
    },
  ]);
}

const setDiet = (session: Session, dietType: string) =>
  request(app)
    .put('/v1/nutrition/profile')
    .set({ ...authed(session), 'idempotency-key': `diet-${dietType}-${session.userId}` })
    .send({ preferences: { dietType } });

describe('suggesting the next food', () => {
  it('never suggests what the member does not eat, however well it scores', async () => {
    const session = await signUpAndRegister();
    await stockLibrary();
    await setDiet(session, 'vegetarian');

    const response = await suggestions(session);

    expect(response.status).toBe(200);
    const names = response.body.data.map((row: { food: { name: string } }) => row.food.name);
    // Chicken is the best protein per calorie in the library and is still
    // not here. That is a filter doing its job, not a score losing.
    expect(names).not.toContain('Chicken Breast');
    expect(names).toContain('Paneer');
    // And an untagged plain ingredient suits everyone.
    expect(names).toContain('Rice');
  });

  it('offers the meat to somebody who eats it', async () => {
    const session = await signUpAndRegister();
    await stockLibrary();
    await setDiet(session, 'non_vegetarian');

    const response = await suggestions(session);
    const names = response.body.data.map((row: { food: { name: string } }) => row.food.name);
    expect(names).toContain('Chicken Breast');
  });

  it('answers the macro that is furthest behind, and says so', async () => {
    const session = await signUpAndRegister();
    await stockLibrary();
    await setDiet(session, 'non_vegetarian');

    const response = await suggestions(session);

    // Nothing has been eaten, so every macro is a full target behind —
    // protein is the largest *share* and the reason says which.
    expect(response.body.data[0].gap).toBe('protein');
    expect(response.body.data[0].reason).toMatch(/protein/);
    // Densest protein per calorie first.
    expect(response.body.data[0].food.name).toBe('Chicken Breast');
  });

  it('never suggests what does not fit in what is left', async () => {
    const session = await signUpAndRegister();
    await stockLibrary();
    const response = await suggestions(session);

    const names = response.body.data.map((row: { food: { name: string } }) => row.food.name);
    // Five thousand calories against a 2,200 kcal day: refused because it
    // does not fit what is left, plus the little slack the rules allow.
    expect(names).not.toContain('Celebration Thali');
  });

  it('says the day is done rather than offering a smaller biscuit', async () => {
    const session = await signUpAndRegister();
    await stockLibrary();

    // Eat the day. The goal is the seeded default; one large entry covers it.
    const ate = await log(
      session,
      {
        entries: [
          {
            id: 'e-1',
            slot: 'lunch',
            name: 'A very big lunch',
            calories: 2400,
            proteinG: 150,
            carbsG: 400,
            fatsG: 150,
            // The day it lands on is the server's, from the request's zone.
            loggedAt: new Date().toISOString(),
          },
        ],
      },
      'eat-the-day',
    );
    expect(ate.status).toBe(200);

    const response = await suggestions(session);

    expect(response.body.data).toEqual([]);
    expect(response.body.note).toMatch(/calorie goal/i);
    expect(response.body.remaining.calories).toBeLessThanOrEqual(0);
  });

  it('says so when the library has nothing this member may eat', async () => {
    const session = await signUpAndRegister();
    await FoodItemModel.deleteMany({ ownerUserId: null });
    await FoodItemModel.create({
      _id: 'f-only-meat',
      name: 'Mutton',
      portion: '100 g',
      calories: 250, proteinG: 25, carbsG: 0, fatsG: 17, fiberG: 0,
      dietTypes: ['non_vegetarian'],
      active: true, ownerUserId: null,
    });
    await setDiet(session, 'vegan');

    const response = await suggestions(session);

    // An empty shelf with no explanation reads as a bug.
    expect(response.body.data).toEqual([]);
    expect(response.body.note).toBeTruthy();
  });

  it('never pushes a member their own custom food back at them', async () => {
    const session = await signUpAndRegister();
    await stockLibrary();
    await FoodItemModel.create({
      _id: 'f-mine',
      name: 'Nani ka halwa',
      portion: '1 bowl',
      calories: 180, proteinG: 40, carbsG: 10, fatsG: 2, fiberG: 0,
      dietTypes: [],
      active: true,
      ownerUserId: session.userId,
    });

    const response = await suggestions(session);
    const names = response.body.data.map((row: { food: { name: string } }) => row.food.name);
    // Densest protein in the library, and still not ours to suggest: a
    // member's own food is theirs to log, not something to be sold back.
    expect(names).not.toContain('Nani ka halwa');
  });
});

describe('what the shop puts in front of somebody', () => {
  const shopSuggestions = (session: Session) =>
    request(app).get('/v1/shop/suggestions').set(authed(session));

  it('shows what they can afford first, without hiding what they cannot', async () => {
    const session = await signUpAndRegister();
    await ShopItemModel.deleteMany({});
    await ShopItemModel.insertMany([
      { _id: 'cheap-band', title: 'Resistance Band', price: 29900, coinPrice: 50, category: 'gym', active: true },
      { _id: 'dear-treadmill', title: 'Treadmill', price: 4999900, coinPrice: 90_000, category: 'gym', active: true },
    ]);
    await CoinBalanceModel.updateOne(
      { _id: session.userId },
      { $set: { balanceMc: 100_000 } }, // 100 coins
      { upsert: true },
    );

    const response = await shopSuggestions(session);

    expect(response.status).toBe(200);
    const ids = response.body.data.map((row: { itemId: string }) => row.itemId);
    // Affordability sorts, it does not filter: a shelf that hid the
    // treadmill would be deciding for them that they will never save up.
    expect(ids).toContain('dear-treadmill');
    expect(ids[0]).toBe('cheap-band');
    expect(response.body.data[0].affordable).toBe(true);
    expect(response.body.data[0].reason).toMatch(/coins cover this/i);
  });

  it('never recommends what they already own', async () => {
    const session = await signUpAndRegister();
    await ShopItemModel.deleteMany({});
    await ShopItemModel.insertMany([
      { _id: 'owned-bottle', title: 'Bottle', price: 49900, coinPrice: 80, category: 'gym', active: true },
      { _id: 'new-mat', title: 'Mat', price: 99900, coinPrice: 160, category: 'gym', active: true },
    ]);
    // Written straight in rather than bought through the till: what is
    // being checked is what the shelf does with an order that exists, not
    // the checkout, which has tests of its own.
    await OrderModel.collection.insertOne({
      _id: 'ord-1' as never,
      userId: session.userId,
      status: 'placed',
      number: 'VK-TEST-1',
      subtotal: 49900,
      total: 49900,
      payable: 49900,
      addressSnapshot: { label: 'Home', line1: 'A street', city: 'Pune', state: 'MH', pincode: '411001' },
      items: [{ itemId: 'owned-bottle', title: 'Bottle', quantity: 1, price: 49900 }],
      createdAt: new Date(),
    } as never);

    const response = await shopSuggestions(session);
    const ids = response.body.data.map((row: { itemId: string }) => row.itemId);

    // A shelf that recommends the bottle they bought last week is a shelf
    // that has not been paying attention.
    expect(ids).not.toContain('owned-bottle');
    expect(ids).toContain('new-mat');
    // And what they did buy shapes what they are shown.
    expect(response.body.data[0].reason).toMatch(/bought from gym/i);
  });
});
