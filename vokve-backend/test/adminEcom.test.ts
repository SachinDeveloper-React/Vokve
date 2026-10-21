import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  CartModel,
  CouponModel,
  CouponUsageModel,
  OrderModel,
  ReviewModel,
  ShopCategoryModel,
  ShopInventoryModel,
  ShopItemModel,
  WishlistModel,
} from '../src/modules/commerce/models.js';
import { UserModel } from '../src/modules/identity/models.js';
import { seed } from '../src/seed/seed.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

/** A member who can review and whose basket is worth looking at. */
async function member(): Promise<Session> {
  const session = await signUpAndRegister();
  await UserModel.updateOne(
    { _id: session.userId },
    { $set: { phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(), name: 'Asha Verma' } },
  );
  return session;
}

/**
 * Puts something in a basket the way the app does.
 *
 * Several seeded items come in colours and the till refuses a line without
 * one (`COLOR_REQUIRED`), so the choice is made here rather than in every
 * test — and the status is asserted, because a basket test whose basket was
 * never filled otherwise fails somewhere else entirely.
 */
async function addToBasket(
  session: Session,
  itemId: string,
  quantity = 1,
  extra: { size?: string; color?: string } = {},
) {
  const response = await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId, quantity, ...extra });
  expect(response.status).toBe(200);
  return response.body;
}

/** Their review of something, asserted likewise. */
async function review(session: Session, itemId: string, rating: number, body: string) {
  const response = await request(app).put(`/v1/shop/items/${itemId}/reviews/me`).set(authed(session)).send({ rating, body });
  expect(response.status).toBe(200);
  return response.body;
}

/** An order holding `itemId`, written straight in: the till's own path is tested elsewhere. */
async function orderFor(userId: string, id: string, itemId: string, overrides: Record<string, unknown> = {}) {
  return OrderModel.create({
    _id: id,
    number: `VKV${id}`,
    userId,
    status: 'delivered',
    subtotal: 79_900,
    total: 79_900,
    payable: 79_900,
    items: [{ itemId, title: 'VOKVE Training Tee', quantity: 2, price: 79_900, coinsUsed: 0, moneyPaid: 79_900 }],
    addressSnapshot: {
      id: 'adr_1', label: 'Home', name: 'Asha', phone: '+919876543210', line1: '12 MG Road', line2: '',
      city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', country: 'IN', isDefault: true,
    },
    payment: { provider: 'mock', method: 'upi', status: 'paid', amount: 79_900, paidAt: new Date() },
    events: [{ from: null, to: 'placed', actor: 'user', at: new Date() }],
    ...overrides,
  });
}

describe('admin: coupons (RULES R16)', () => {
  it('answers the admin key alone', async () => {
    expect((await request(app).get('/v1/admin/shop/coupons')).status).toBe(401);
  });

  it('lists what each coupon has actually given away', async () => {
    const session = await member();
    await orderFor(session.userId, 'ord_welcome', 'tee', {
      coupon: { code: 'WELCOME10', title: '10% off, up to ₹150', discount: 7_990 },
      discount: 7_990,
    });
    await CouponModel.updateOne({ _id: 'WELCOME10' }, { $set: { redemptions: 1 } });

    const list = await request(app).get('/v1/admin/shop/coupons').set(ADMIN);
    expect(list.status).toBe(200);
    expect(list.body.shop.couponsEnabled).toBe(true);

    const welcome = list.body.data.find((row: { code: string }) => row.code === 'WELCOME10');
    expect(welcome).toMatchObject({
      kind: 'percent',
      value: 10,
      maxDiscount: 15_000,
      redemptions: 1,
      state: 'live',
      // Summed from the orders' own snapshots, not recomputed.
      given: 7_990,
      orders: 1,
      // It has been used, so it is not a delete.
      deletable: false,
    });

    const unused = list.body.data.find((row: { code: string }) => row.code === 'FIT50');
    expect(unused).toMatchObject({ kind: 'flat', value: 5_000, redemptions: 0, deletable: true, remaining: null });
    expect(list.body.totals).toMatchObject({ redemptions: 1, given: 7_990 });
  });

  it('creates one, and refuses the three a form would happily write', async () => {
    const created = await request(app)
      .post('/v1/admin/shop/coupons')
      .set(ADMIN)
      .send({
        code: 'summer20',
        title: '20% off, up to ₹300',
        kind: 'percent',
        value: 20,
        maxDiscount: 30_000,
        minSubtotal: 99_900,
        perUserLimit: 2,
        maxRedemptions: 500,
        note: 'June campaign',
      });
    expect(created.status).toBe(201);
    // Stored upper-case, which is how the till looks a code up.
    expect(created.body.coupon).toMatchObject({ code: 'SUMMER20', state: 'live', remaining: 500, perUserLimit: 2 });
    expect(await CouponModel.exists({ _id: 'SUMMER20' })).toBeTruthy();

    const tooMuch = await request(app)
      .post('/v1/admin/shop/coupons')
      .set(ADMIN)
      .send({ code: 'HALFOFF', title: 'Half off', kind: 'percent', value: 150 });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.details.value).toMatch(/1–100%/);

    // A cap on a flat coupon is applied by the till as well, so ₹200 off
    // with a ₹50 cap is ₹50 off — a campaign nobody meant to run.
    const cappedFlat = await request(app)
      .post('/v1/admin/shop/coupons')
      .set(ADMIN)
      .send({ code: 'FLAT200', title: '₹200 off', kind: 'flat', value: 20_000, maxDiscount: 5_000 });
    expect(cappedFlat.status).toBe(422);
    expect(cappedFlat.body.error.details.maxDiscount).toMatch(/cap belongs to a percent/);

    const backwards = await request(app)
      .post('/v1/admin/shop/coupons')
      .set(ADMIN)
      .send({
        code: 'TIMEWARP',
        title: 'Closes before it opens',
        kind: 'flat',
        value: 1_000,
        startsAt: '2026-12-01T00:00:00.000Z',
        endsAt: '2026-11-01T00:00:00.000Z',
      });
    expect(backwards.status).toBe(422);
    expect(backwards.body.error.details.endsAt).toMatch(/close before it opened/);
  });

  it('refuses a ceiling below what has already been claimed', async () => {
    // The shelf and the starter coupons; every test starts with an empty database.
    await seed();
    await CouponModel.updateOne({ _id: 'FIT50' }, { $set: { redemptions: 12 } });
    const patched = await request(app)
      .put('/v1/admin/shop/coupons/FIT50')
      .set(ADMIN)
      .send({ maxRedemptions: 5 });
    expect(patched.status).toBe(422);
    expect(patched.body.error.details.maxRedemptions).toMatch(/already claimed/);
  });

  it('clears the stale cap when a percent coupon becomes a flat one', async () => {
    // The shelf and the starter coupons; every test starts with an empty database.
    await seed();
    const patched = await request(app)
      .put('/v1/admin/shop/coupons/WELCOME10')
      .set(ADMIN)
      .send({ kind: 'flat', value: 10_000, title: '₹100 off' });
    expect(patched.status).toBe(200);
    // Left behind, `checkCoupon` would have applied it: ₹100 off, capped at ₹150.
    expect(patched.body.coupon).toMatchObject({ kind: 'flat', value: 10_000, maxDiscount: null });
  });

  it('switches a campaign off without touching anything that holds it', async () => {
    const session = await member();
    await orderFor(session.userId, 'ord_fit', 'tee', {
      coupon: { code: 'FIT50', title: '₹50 off', discount: 5_000 },
    });

    const off = await request(app).put('/v1/admin/shop/coupons/FIT50/active').set(ADMIN).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.coupon).toMatchObject({ active: false, state: 'inactive' });
    expect(off.body.orders).toHaveLength(1);

    const on = await request(app).put('/v1/admin/shop/coupons/FIT50/active').set(ADMIN).send({ active: true });
    expect(on.body.coupon).toMatchObject({ active: true, state: 'live' });
  });

  it('deletes a coupon nothing used, and refuses one that was used', async () => {
    const session = await member();

    // A basket is keeping the code so that it comes back when the basket
    // qualifies (RULES R14) — and would keep failing its check silently.
    await CartModel.create({ _id: session.userId, lines: [{ itemId: 'tee', quantity: 1, size: 'M' }], couponCode: 'FIT50' });

    const gone = await request(app).delete('/v1/admin/shop/coupons/FIT50').set(ADMIN).send({ note: 'never ran' });
    expect(gone.status).toBe(200);
    expect(gone.body).toMatchObject({ deleted: true, code: 'FIT50', basketsCleared: 1 });
    expect(await CartModel.findById(session.userId).lean()).toMatchObject({ couponCode: null });

    await CouponModel.updateOne({ _id: 'WELCOME10' }, { $set: { redemptions: 3 } });
    await CouponUsageModel.create({ _id: `WELCOME10:${session.userId}`, code: 'WELCOME10', userId: session.userId, count: 1 });
    const refused = await request(app).delete('/v1/admin/shop/coupons/WELCOME10').set(ADMIN).send({});
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.code).toMatch(/Switch it off instead/);
    expect(await CouponModel.exists({ _id: 'WELCOME10' })).toBeTruthy();
  });

  it('finds the four states the till refuses a coupon in', async () => {
    // The shelf and the starter coupons; every test starts with an empty database.
    await seed();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await request(app).post('/v1/admin/shop/coupons').set(ADMIN)
      .send({ code: 'LATER', title: 'Not yet', kind: 'flat', value: 1_000, startsAt: future });
    await request(app).post('/v1/admin/shop/coupons').set(ADMIN)
      .send({ code: 'OVER', title: 'Done', kind: 'flat', value: 1_000, endsAt: past });
    await request(app).post('/v1/admin/shop/coupons').set(ADMIN)
      .send({ code: 'GONE', title: 'Claimed', kind: 'flat', value: 1_000, maxRedemptions: 2 });
    await CouponModel.updateOne({ _id: 'GONE' }, { $set: { redemptions: 2 } });
    await request(app).put('/v1/admin/shop/coupons/FIT50/active').set(ADMIN).send({ active: false });

    const state = async (value: string) =>
      (await request(app).get('/v1/admin/shop/coupons').query({ state: value }).set(ADMIN)).body.data.map(
        (row: { code: string }) => row.code,
      );

    expect(await state('scheduled')).toEqual(['LATER']);
    expect(await state('expired')).toEqual(['OVER']);
    expect(await state('exhausted')).toEqual(['GONE']);
    expect(await state('inactive')).toEqual(['FIT50']);
    expect(await state('live')).toEqual(expect.arrayContaining(['WELCOME10']));
    expect(await state('live')).not.toEqual(expect.arrayContaining(['LATER', 'OVER', 'GONE', 'FIT50']));
  });
});

describe('admin: the shelf by category', () => {
  it('says what each category is carrying, with its subcategories', async () => {
    const session = await member();
    await orderFor(session.userId, 'ord_tee', 'tee');
    await WishlistModel.create({ _id: `${session.userId}:hoodie`, userId: session.userId, itemId: 'hoodie' });

    const page = await request(app).get('/v1/admin/shop/categories').set(ADMIN);
    expect(page.status).toBe(200);
    // Rows now, not an enum — each one carrying what the app draws it with.
    expect(page.body.data.map((row: { category: string }) => row.category)).toEqual([
      'clothing',
      'gym',
      'sports',
      'accessories',
    ]);
    expect(page.body.data[0]).toMatchObject({ category: 'clothing', name: 'Clothes', icon: 'shirt' });

    const clothing = page.body.data.find((row: { category: string }) => row.category === 'clothing');
    expect(clothing.items).toBeGreaterThan(0);
    expect(clothing).toMatchObject({ unitsSold: 2, goodsSold: 159_800, wanted: 1 });
    expect(clothing.stockValue).toBeGreaterThan(0);

    const tshirts = clothing.subcategories.find((row: { name: string }) => row.name === 'T-shirts');
    expect(tshirts).toMatchObject({ items: 2, unitsSold: 2 });
    expect(page.body.totals.items).toBeGreaterThanOrEqual(clothing.items);
  });

  it('renames a subcategory, merges two, and leaves items unfiled', async () => {
    // The shelf and the starter coupons; every test starts with an empty database.
    await seed();
    const renamed = await request(app)
      .put('/v1/admin/shop/categories/subcategory')
      .set(ADMIN)
      .send({ category: 'clothing', from: 'T-shirts', to: 'Tees' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ moved: 2, mergedWith: null });
    expect(await ShopItemModel.countDocuments({ category: 'clothing', subcategory: 'Tees' })).toBe(2);

    // Renaming onto a name already in use is how two shelves are merged.
    const merged = await request(app)
      .put('/v1/admin/shop/categories/subcategory')
      .set(ADMIN)
      .send({ category: 'clothing', from: 'Tops', to: 'Tees' });
    expect(merged.status).toBe(200);
    expect(merged.body.mergedWith).toBe(2);
    expect(await ShopItemModel.countDocuments({ category: 'clothing', subcategory: 'Tees' })).toBe(3);

    const cleared = await request(app)
      .put('/v1/admin/shop/categories/subcategory')
      .set(ADMIN)
      .send({ category: 'clothing', from: 'Tees', to: null });
    expect(cleared.body.moved).toBe(3);
    const clothing = cleared.body.data.find((row: { category: string }) => row.category === 'clothing');
    expect(clothing.unfiled).toBeGreaterThanOrEqual(3);

    const missing = await request(app)
      .put('/v1/admin/shop/categories/subcategory')
      .set(ADMIN)
      .send({ category: 'clothing', from: 'Nothing', to: 'Something' });
    expect(missing.status).toBe(404);
  });

  it('moves a handful of items onto another shelf and names the slugs it did not find', async () => {
    // The shelf and the starter coupons; every test starts with an empty database.
    await seed();
    // The subcategory has to exist on the shelf they are moving to: a
    // dropdown in the panel is a convenience, and this route is also
    // called by hand.
    const unknown = await request(app)
      .post('/v1/admin/shop/categories/move')
      .set(ADMIN)
      .send({ ids: ['tee'], category: 'sports', subcategory: 'Kit' });
    expect(unknown.status).toBe(422);

    await request(app).post('/v1/admin/shop/categories/sports/subcategories').set(ADMIN).send({ name: 'Kit' });
    const moved = await request(app)
      .post('/v1/admin/shop/categories/move')
      .set(ADMIN)
      .send({ ids: ['tee', 'cap', 'not-a-thing'], category: 'sports', subcategory: 'Kit' });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ moved: 2, missing: ['not-a-thing'] });
    expect(await ShopItemModel.findById('tee').lean()).toMatchObject({ category: 'sports', subcategory: 'Kit' });
  });
});

describe('admin: writing the shelves themselves (RULES R9)', () => {
  it('adds a shelf, slugs its name, and lists an item on it', async () => {
    await seed();
    const added = await request(app)
      .post('/v1/admin/shop/categories')
      .set(ADMIN)
      .send({ name: 'Yoga & Pilates', icon: 'heart', description: 'Mats, blocks and straps.' });
    expect(added.status).toBe(201);
    expect(added.body.slug).toBe('yoga-pilates');
    const shelf = added.body.data.find((row: { category: string }) => row.category === 'yoga-pilates');
    expect(shelf).toMatchObject({ name: 'Yoga & Pilates', icon: 'heart', items: 0, subcategories: [] });

    // A second shelf by that slug is refused rather than quietly merged:
    // the slug is what every item carries.
    const again = await request(app).post('/v1/admin/shop/categories').set(ADMIN).send({ name: 'Yoga & Pilates' });
    expect(again.status).toBe(422);

    // An item may only be filed under a shelf that exists, and under a
    // subcategory that shelf lists.
    const stray = await request(app)
      .post('/v1/admin/shop/items')
      .set(ADMIN)
      .send({ id: 'yoga-block', title: 'Cork Yoga Block', price: 49900, category: 'yoga-pilates', subcategory: 'Blocks' });
    expect(stray.status).toBe(422);

    await request(app).post('/v1/admin/shop/categories/yoga-pilates/subcategories').set(ADMIN).send({ name: 'Blocks' });
    const listed = await request(app)
      .post('/v1/admin/shop/items')
      .set(ADMIN)
      .send({ id: 'yoga-block', title: 'Cork Yoga Block', price: 49900, category: 'yoga-pilates', subcategory: 'Blocks', onHand: 10 });
    expect(listed.status).toBe(201);
    expect(listed.body.item).toMatchObject({ category: 'yoga-pilates', subcategory: 'Blocks' });

    // And the app is told about it, with the label and icon to draw it with.
    const session = await member();
    const shelves = await request(app).get('/v1/shop/categories').set(authed(session));
    expect(shelves.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: 'yoga-pilates', label: 'Yoga & Pilates', icon: 'heart', count: 1 })]),
    );
  });

  it('renames a shelf without re-keying it, and retires one instead of deleting it', async () => {
    await seed();
    const renamed = await request(app).put('/v1/admin/shop/categories/clothing').set(ADMIN).send({ name: 'Apparel', sort: 9 });
    expect(renamed.status).toBe(200);
    const shelf = renamed.body.data.find((row: { category: string }) => row.category === 'clothing');
    expect(shelf).toMatchObject({ category: 'clothing', name: 'Apparel', sort: 9 });
    // The items did not move: the slug is the key and the label is what a member reads.
    expect(await ShopItemModel.countDocuments({ category: 'clothing' })).toBeGreaterThan(0);

    const session = await member();
    await request(app).put('/v1/admin/shop/categories/clothing').set(ADMIN).send({ active: false });
    const shelves = await request(app).get('/v1/shop/categories').set(authed(session));
    expect(shelves.body.data.map((row: { category: string }) => row.category)).not.toContain('clothing');
  });

  it('refuses to delete a shelf with items on it until it is told where they go', async () => {
    await seed();
    const held = await request(app).delete('/v1/admin/shop/categories/gym').set(ADMIN).send({});
    expect(held.status).toBe(422);
    expect(JSON.stringify(held.body)).toMatch(/retire/i);

    const items = await ShopItemModel.countDocuments({ category: 'gym' });
    const gone = await request(app).delete('/v1/admin/shop/categories/gym').set(ADMIN).send({ moveTo: 'accessories' });
    expect(gone.status).toBe(200);
    expect(gone.body).toMatchObject({ deleted: true, moved: items, movedTo: 'accessories' });
    expect(await ShopItemModel.countDocuments({ category: 'gym' })).toBe(0);
    // They arrive unfiled: the name they were filed under was the old shelf's.
    expect(await ShopItemModel.countDocuments({ category: 'accessories', subcategory: null })).toBe(items);
    expect(gone.body.data.map((row: { category: string }) => row.category)).not.toContain('gym');
  });

  it('renames a subcategory across its items, merges two, and says where a deleted one’s items went', async () => {
    await seed();
    const renamed = await request(app)
      .put('/v1/admin/shop/categories/clothing/subcategories/T-shirts')
      .set(ADMIN)
      .send({ name: 'Tees' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ moved: 2, mergedWith: null });
    expect(await ShopItemModel.countDocuments({ category: 'clothing', subcategory: 'Tees' })).toBe(2);

    const merged = await request(app)
      .put('/v1/admin/shop/categories/clothing/subcategories/Tops')
      .set(ADMIN)
      .send({ name: 'Tees' });
    expect(merged.body.mergedWith).toBe('Tees');
    expect(await ShopItemModel.countDocuments({ category: 'clothing', subcategory: 'Tees' })).toBe(3);
    const clothing = merged.body.data.find((row: { category: string }) => row.category === 'clothing');
    expect(clothing.subcategories.filter((sub: { name: string }) => sub.name === 'Tees')).toHaveLength(1);
    expect(clothing.subcategories.map((sub: { name: string }) => sub.name)).not.toContain('Tops');

    const reassigned = await request(app)
      .delete('/v1/admin/shop/categories/clothing/subcategories/Tees')
      .set(ADMIN)
      .send({ reassignTo: 'Hoodies' });
    expect(reassigned.body).toMatchObject({ deleted: true, moved: 3, reassignedTo: 'Hoodies' });
    expect(await ShopItemModel.countDocuments({ category: 'clothing', subcategory: 'Tees' })).toBe(0);

    const unfiled = await request(app)
      .delete('/v1/admin/shop/categories/clothing/subcategories/Hoodies')
      .set(ADMIN)
      .send({});
    expect(unfiled.body).toMatchObject({ deleted: true, reassignedTo: null });
    expect(await ShopItemModel.countDocuments({ category: 'clothing', subcategory: 'Hoodies' })).toBe(0);

    expect((await request(app).delete('/v1/admin/shop/categories/clothing/subcategories/Nothing').set(ADMIN).send({})).status).toBe(404);
  });

  it('builds the shelves from the items on a database that predates them', async () => {
    await seed();
    // What an older database looks like: items on a shelf no row describes.
    await ShopCategoryModel.deleteMany({});
    await ShopItemModel.updateOne({ _id: 'cap' }, { $set: { category: 'headwear', subcategory: 'Caps' } });

    const page = await request(app).get('/v1/admin/shop/categories').set(ADMIN);
    const built = page.body.data.find((row: { category: string }) => row.category === 'headwear');
    expect(built).toMatchObject({ name: 'Headwear', icon: 'category', items: 1 });
    expect(built.subcategories.map((sub: { name: string }) => sub.name)).toEqual(['Caps']);
    // And the four it opened with are still described rather than rebuilt as bare slugs.
    expect(page.body.data.find((row: { category: string }) => row.category === 'clothing')).toMatchObject({ name: 'Clothes' });
  });
});

describe('admin: what a thing costs in coins (RULES R11)', () => {
  it('takes a coin price on the item and charges it, instead of dividing the rupee price', async () => {
    await seed();
    const session = await member();

    // Left alone, the coin price is the rupee price at ⚙ commerce.coinValuePaise.
    const derived = await request(app).get('/v1/admin/shop/items/socks').set(ADMIN);
    expect(derived.body.item).toMatchObject({ coinPrice: 1196, coinPriceSet: false });

    const set = await request(app).put('/v1/admin/shop/items/socks').set(ADMIN).send({ coinPrice: 1000 });
    expect(set.status).toBe(200);
    expect(set.body.item).toMatchObject({ coinPrice: 1000, coinPriceSet: true });

    // The app's card says the same figure, and a coins-only line is quoted at it.
    const card = await request(app).get('/v1/shop/items/socks').set(authed(session));
    expect(card.body).toMatchObject({ coinPrice: 1000, paymentMode: 'coins', coinsMax: 1000, coinsMin: 1000 });

    const quote = await request(app)
      .post('/v1/checkout/quote')
      .set(authed(session))
      .send({ lines: [{ itemId: 'socks', quantity: 2 }] });
    expect(quote.status).toBe(200);
    expect(quote.body.lines[0]).toMatchObject({ coinPrice: 1000, lineCoins: 2000 });
    expect(quote.body.inCoins).toMatchObject({ goods: 2000 });

    // Clearing it puts the arithmetic back.
    const cleared = await request(app).put('/v1/admin/shop/items/socks').set(ADMIN).send({ coinPrice: null });
    expect(cleared.body.item).toMatchObject({ coinPrice: 1196, coinPriceSet: false });
  });
});

describe('admin: baskets and saved items (RULES R14)', () => {
  it('lists baskets at today’s prices, and counts the lines a checkout would refuse', async () => {
    const shopper = await member();
    const browser = await member();
    await addToBasket(shopper, 'tee', 2, { size: 'M', color: 'Black' });
    await addToBasket(browser, 'cap', 1);

    // The shelf moves under a basket: this is the state an operator is
    // looking for, and the member cannot see it or clear it.
    await ShopInventoryModel.updateOne({ _id: 'cap' }, { $set: { onHand: 0 } });

    const list = await request(app).get('/v1/admin/shop/baskets').query({ sort: 'value' }).set(ADMIN);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.data[0]).toMatchObject({ units: 2, value: 159_800, blocked: 0, offShelf: 0 });
    expect(list.body.data[0].member).toMatchObject({ id: shopper.userId, email: shopper.email });
    expect(list.body.totals).toMatchObject({ baskets: 2, blocked: 1, offShelf: 0 });

    const stuck = await request(app).get('/v1/admin/shop/baskets').query({ state: 'blocked' }).set(ADMIN);
    expect(stuck.body.data).toHaveLength(1);
    expect(stuck.body.data[0]).toMatchObject({ member: { id: browser.userId }, blocked: 1 });

    // Retiring it is the other kind: counted apart, because their own next
    // basket open drops the line rather than being stuck on it.
    await request(app).delete('/v1/admin/shop/items/cap').set(ADMIN).send({ active: false });
    const offShelf = await request(app).get('/v1/admin/shop/baskets').query({ state: 'off_shelf' }).set(ADMIN);
    expect(offShelf.body.data).toHaveLength(1);
    expect(offShelf.body.data[0]).toMatchObject({ member: { id: browser.userId }, blocked: 0, offShelf: 1 });

    const found = await request(app).get('/v1/admin/shop/baskets').query({ q: shopper.email }).set(ADMIN);
    expect(found.body.data).toHaveLength(1);
    expect(found.body.data[0].member.id).toBe(shopper.userId);
  });

  it('tells the two kinds of stuck apart: off the shelf clears itself, out of stock does not', async () => {
    const session = await member();
    await addToBasket(session, 'tee', 1, { size: 'M', color: 'Black' });
    await addToBasket(session, 'hoodie', 1, { size: 'L', color: 'Black' });
    // One retired under them, one that simply ran out.
    await request(app).delete('/v1/admin/shop/items/hoodie').set(ADMIN).send({ active: false });
    await ShopInventoryModel.updateOne({ _id: 'tee' }, { $set: { onHand: 0 } });

    const basket = await request(app).get(`/v1/admin/users/${session.userId}/basket`).set(ADMIN);
    expect(basket.status).toBe(200);
    // The retired line is reported as dropped, the out-of-stock one as blocked.
    expect(basket.body.basket).toMatchObject({ offShelf: 1, blocked: 1 });
    const dropped = basket.body.basket.lines.find((line: { itemId: string }) => line.itemId === 'hoodie');
    expect(dropped).toMatchObject({ visibleToMember: false, problem: expect.stringMatching(/off the shelf/) });
    const stuck = basket.body.basket.lines.find((line: { itemId: string }) => line.itemId === 'tee');
    expect(stuck).toMatchObject({ visibleToMember: true, problem: 'Out of stock, and nothing tells them why' });
    // The quote on their screen holds the one line their app can still draw.
    expect(basket.body.quote.subtotal).toBe(79_900);

    // And the difference that matters: `getCart` wrote the drop back, so the
    // retired line is gone for good while the out-of-stock one is still there
    // — which is why only the second is something to act on.
    const again = await request(app).get(`/v1/admin/users/${session.userId}/basket`).set(ADMIN);
    expect(again.body.basket).toMatchObject({ offShelf: 0, blocked: 1 });
    expect(again.body.basket.lines).toHaveLength(1);
    expect(await CartModel.findById(session.userId).lean()).toMatchObject({ lines: [{ itemId: 'tee' }] });
  });

  it('takes out a line, then the coupon, then the lot', async () => {
    const session = await member();
    await addToBasket(session, 'tee', 1, { size: 'M', color: 'Black' });
    await addToBasket(session, 'hoodie', 1, { size: 'L', color: 'Black' });
    await CartModel.updateOne({ _id: session.userId }, { $set: { couponCode: 'WELCOME10' } });

    const line = await request(app)
      .delete(`/v1/admin/users/${session.userId}/basket/lines`)
      .set(ADMIN)
      .send({ itemId: 'hoodie', size: 'L', color: 'Black', reason: 'out of stock for a month' });
    expect(line.status).toBe(200);
    expect(line.body.basket.lines).toHaveLength(1);

    const missing = await request(app)
      .delete(`/v1/admin/users/${session.userId}/basket/lines`)
      .set(ADMIN)
      .send({ itemId: 'hoodie', size: 'L', color: 'Black', reason: 'again' });
    expect(missing.status).toBe(404);

    const coupon = await request(app)
      .delete(`/v1/admin/users/${session.userId}/basket/coupon`)
      .set(ADMIN)
      .send({ reason: 'campaign ended' });
    expect(coupon.status).toBe(200);
    expect(coupon.body.basket.couponCode).toBeNull();

    const cleared = await request(app)
      .delete(`/v1/admin/users/${session.userId}/basket`)
      .set(ADMIN)
      .send({ reason: 'member asked on the phone' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.basket).toMatchObject({ lines: [], units: 0, value: 0 });
  });

  it('unsaves an item, and reads the wishlist beside the basket', async () => {
    const session = await member();
    await request(app).put('/v1/wishlist/hoodie').set(authed(session)).send({});
    await request(app).put('/v1/wishlist/cap').set(authed(session)).send({});

    const basket = await request(app).get(`/v1/admin/users/${session.userId}/basket`).set(ADMIN);
    expect(basket.body.wishlist).toHaveLength(2);

    const gone = await request(app)
      .delete(`/v1/admin/users/${session.userId}/wishlist/cap`)
      .set(ADMIN)
      .send({ reason: 'duplicate of the other cap' });
    expect(gone.status).toBe(200);
    expect(gone.body.wishlist.map((row: { itemId: string }) => row.itemId)).toEqual(['hoodie']);
    expect(await WishlistModel.countDocuments({ userId: session.userId })).toBe(1);
  });

  it('reports what people want against what is on the shelf', async () => {
    const one = await member();
    const two = await member();
    await request(app).put('/v1/wishlist/socks').set(authed(one)).send({});
    await request(app).put('/v1/wishlist/socks').set(authed(two)).send({});
    await addToBasket(one, 'socks', 3);
    await ShopInventoryModel.updateOne({ _id: 'socks' }, { $set: { onHand: 0 } });

    const page = await request(app).get('/v1/admin/shop/demand').query({ state: 'out_of_stock' }).set(ADMIN);
    expect(page.status).toBe(200);
    expect(page.body.data[0]).toMatchObject({
      itemId: 'socks',
      saved: 2,
      inBaskets: 1,
      units: 3,
      onHand: 0,
      out: true,
      wanted: 3,
      // Two savers and three units in a basket, none of which can be sold.
      short: 5,
    });
  });
});

describe('admin: reviews (RULES R15)', () => {
  it('lists them worst first, with the spread', async () => {
    const cross = await member();
    const happy = await member();
    await review(cross, 'tee', 1, 'Fell apart in a week.');
    await review(happy, 'tee', 5, 'Wear it every day.');

    const page = await request(app).get('/v1/admin/shop/reviews').query({ sort: 'lowest' }).set(ADMIN);
    expect(page.status).toBe(200);
    expect(page.body.summary).toMatchObject({ reviews: 2, average: 3 });
    expect(page.body.data[0]).toMatchObject({ rating: 1, item: { id: 'tee' } });
    expect(page.body.data[0].member).toMatchObject({ id: cross.userId, email: cross.email });
    // Neither bought it, so neither is a verified review.
    expect(page.body.data[0]).toMatchObject({ verified: false, stillHoldsAnOrder: false });

    const one = await request(app).get('/v1/admin/shop/reviews').query({ rating: 1 }).set(ADMIN);
    expect(one.body.total).toBe(1);
  });

  it('recounts the item when one comes down, because every list reads that figure', async () => {
    const cross = await member();
    const happy = await member();
    await review(cross, 'tee', 1, 'Abusive nonsense about the staff.');
    await review(happy, 'tee', 5, 'Lovely tee, washes well.');
    expect(await ShopItemModel.findById('tee').lean()).toMatchObject({ ratingAverage: 3, ratingCount: 2 });

    const worst = await ReviewModel.findOne({ itemId: 'tee', userId: cross.userId }).lean();
    const gone = await request(app)
      .delete(`/v1/admin/shop/reviews/${worst!._id}`)
      .set(ADMIN)
      .send({ reason: 'abuse' });
    expect(gone.status).toBe(200);
    expect(gone.body).toMatchObject({ deleted: true, itemId: 'tee', rating: { average: 5, count: 1 } });
    expect(await ShopItemModel.findById('tee').lean()).toMatchObject({ ratingAverage: 5, ratingCount: 1 });

    const missing = await request(app)
      .delete('/v1/admin/shop/reviews/rev_nothing')
      .set(ADMIN)
      .send({ reason: 'already gone' });
    expect(missing.status).toBe(404);
  });
});

describe('admin: one product in full, and deleting one', () => {
  it('answers the four questions that are not on the item', async () => {
    const buyer = await member();
    const waiter = await member();
    await orderFor(buyer.userId, 'ord_insight', 'tee');
    await review(buyer, 'tee', 4, 'Good fit, true to size.');
    await request(app).put('/v1/wishlist/tee').set(authed(waiter)).send({});
    await addToBasket(waiter, 'tee', 2, { size: 'M', color: 'Black' });
    await request(app).put('/v1/admin/shop/items/tee').set(ADMIN).send({ price: 84_900, note: 'July list' });

    const page = await request(app).get('/v1/admin/shop/items/tee/insight').set(ADMIN);
    expect(page.status).toBe(200);
    expect(page.body.item).toMatchObject({ id: 'tee', price: 84_900 });
    expect(page.body.sales).toMatchObject({ orders: 1, units: 2, goods: 159_800, moneyPaid: 79_900 });
    expect(page.body.wanted).toMatchObject({ baskets: 1, basketUnits: 2, wishlists: 1 });
    expect(page.body.orders[0]).toMatchObject({ number: 'VKVord_insight', quantity: 2 });
    expect(page.body.orders[0].member).toMatchObject({ id: buyer.userId });
    // The buyer's review is verified: they held an order when they wrote it.
    expect(page.body.reviews).toMatchObject({ average: 4, count: 1 });
    expect(page.body.reviews.data[0]).toMatchObject({ rating: 4, verified: true });
    expect(page.body.trail[0]).toMatchObject({ action: 'shop.item_updated' });
  });

  it('refuses to delete an item an order holds, and points at retiring instead', async () => {
    const session = await member();
    await orderFor(session.userId, 'ord_keep', 'tee');

    const refused = await request(app).delete('/v1/admin/shop/items/tee/permanent').set(ADMIN).send({});
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.id).toMatch(/Retire it instead/);
    expect(await ShopItemModel.exists({ _id: 'tee' })).toBeTruthy();

    // Which is the act that was wanted: the shelf loses it, the order does not.
    const retired = await request(app).delete('/v1/admin/shop/items/tee').set(ADMIN).send({ active: false });
    expect(retired.status).toBe(200);
    expect(retired.body.item.active).toBe(false);
    expect(await OrderModel.countDocuments({ 'items.itemId': 'tee' })).toBe(1);
  });

  it('deletes the mistake case, and tidies up everything pointing at it', async () => {
    const session = await member();
    const draft = await request(app)
      .post('/v1/admin/shop/items')
      .set(ADMIN)
      .send({ id: 'draft-tee', title: 'Draft', price: 10_000, category: 'clothing', onHand: 5 });
    expect(draft.status).toBe(201);

    await addToBasket(session, 'draft-tee', 1);
    await request(app).put('/v1/wishlist/draft-tee').set(authed(session)).send({});
    await review(session, 'draft-tee', 3, 'Listed by mistake, I think.');

    const gone = await request(app)
      .delete('/v1/admin/shop/items/draft-tee/permanent')
      .set(ADMIN)
      .send({ note: 'listed by accident' });
    expect(gone.status).toBe(200);
    expect(gone.body).toMatchObject({ deleted: true, basketsTidied: 1, savesRemoved: 1, reviewsRemoved: 1 });

    expect(await ShopItemModel.exists({ _id: 'draft-tee' })).toBeFalsy();
    expect(await ShopInventoryModel.exists({ _id: 'draft-tee' })).toBeFalsy();
    expect(await WishlistModel.countDocuments({ itemId: 'draft-tee' })).toBe(0);
    expect(await ReviewModel.countDocuments({ itemId: 'draft-tee' })).toBe(0);
    // The line is gone rather than dangling: a basket line pointing at a row
    // that has gone is one the member can neither see nor remove.
    expect(await CartModel.findById(session.userId).lean()).toMatchObject({ lines: [] });

    expect((await request(app).get('/v1/admin/shop/items/draft-tee/insight').set(ADMIN)).status).toBe(404);
  });
});
