import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { invalidateConfig } from '../src/config/remote.js';
import { OrderModel, ReviewModel, ShopInventoryModel, ShopItemModel } from '../src/modules/commerce/models.js';
import { expireUnpaidOrders } from '../src/modules/commerce/service.js';
import { CoinLedgerModel } from '../src/modules/economy/models.js';
import { credit } from '../src/modules/economy/service.js';
import { UserModel } from '../src/modules/identity/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

const DAY = '2026-09-14';

const ADDRESS = {
  label: 'Home', name: 'Asha Verma', phone: '+919876543210', line1: '12 MG Road', line2: 'Flat 4B',
  city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', country: 'IN', isDefault: false,
};

/** The defaults the sums below rest on: ₹0.25 a coin, 30% of the goods, ₹49 shipping under ₹999. */
const COIN = 25;
const SHIPPING = 4900;

/** A user who can buy: both contacts proven, coins in the wallet, an address on file. */
async function shopper(coins = 2_000): Promise<{ session: Session; addressId: string }> {
  const session = await signUpAndRegister();
  await UserModel.updateOne({ _id: session.userId }, { $set: { phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(), name: 'Asha Verma' } });
  // A cap-exempt refund row funds the wallet cleanly.
  await credit({ userId: session.userId, source: 'refund', referenceType: 'test', referenceId: 'fund', amount: coins, title: 'Test funds', localDay: DAY, exemptFromCap: true });
  const created = await request(app).post('/v1/me/addresses').set(authed(session)).send(ADDRESS);
  expect(created.status).toBe(201);
  return { session, addressId: created.body.id };
}

/** Walks the step-up: asks for the code, verifies it, returns the token. */
async function stepUp(session: Session): Promise<string> {
  const challenge = await request(app).post('/v1/auth/step-up').set(authed(session)).send({});
  expect(challenge.status).toBe(200);
  expect(challenge.body).toMatchObject({ channel: 'email', purpose: 'step_up' });
  const verified = await request(app).post('/v1/auth/verify-otp').set(authed(session)).send({ verificationId: challenge.body.verificationId, code: challenge.body.devCode });
  expect(verified.status).toBe(200);
  expect(verified.body.stepUpToken).toEqual(expect.any(String));
  return verified.body.stepUpToken;
}

/** Places and pays for `lines` in one go, the way the app does, and returns the placed order. */
async function buy(session: Session, addressId: string, lines: { itemId: string; quantity?: number; size?: string }[], coins = 0) {
  const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: lines.map(l => ({ quantity: 1, ...l })), addressId, coins });
  expect(placed.status).toBe(200);
  if (!placed.body.payment) return placed.body.order;
  const paid = await request(app).post(`/v1/orders/${placed.body.order.id}/pay`).set(authed(session)).send({ providerPaymentId: `pay_${placed.body.order.id}` });
  expect(paid.status).toBe(200);
  return paid.body.order;
}

async function setCommerce(patch: Record<string, unknown>) {
  await AppConfigModel.updateOne({ _id: 'commerce' }, { $set: { value: patch } }, { upsert: true });
  invalidateConfig();
}

describe('commerce: catalogue, config and addresses', () => {
  it('serves the seeded catalogue priced in paise, with the coin cap, stock and rating joined in', async () => {
    const session = await signUpAndRegister();
    const all = await request(app).get('/v1/shop/items').query({ limit: 100 }).set(authed(session));
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(28);
    // Popular first: the tee outsells everything in the seed. 30% of ₹799 at ₹0.25 a coin is 958 coins.
    expect(all.body.data[0]).toMatchObject({
      id: 'tee', price: 79900, mrp: 119900, currency: 'INR', coinsMax: 958, inStock: true, badge: 'bestseller',
      category: 'clothing', subcategory: 'T-shirts', sizes: ['S', 'M', 'L', 'XL', 'XXL'], rating: { average: 0, count: 0 },
    });
    expect(all.body.data[0].tags).toContain('tshirt');
    expect(all.body.data[0].priceCoins).toBeUndefined();

    const clothing = await request(app).get('/v1/shop/items').query({ category: 'clothing' }).set(authed(session));
    expect(clothing.body.data.every((i: { category: string }) => i.category === 'clothing')).toBe(true);
    const deals = await request(app).get('/v1/shop/items').query({ deals: 'true' }).set(authed(session));
    expect(deals.body.data.every((i: { isDeal: boolean }) => i.isDeal)).toBe(true);
    const featured = await request(app).get('/v1/shop/items').query({ featured: 'true' }).set(authed(session));
    expect(featured.body.data.length).toBeGreaterThan(3);
    expect((await request(app).get('/v1/shop/items').query({ category: 'lifestyle' }).set(authed(session))).status).toBe(422);

    // Price filters are paise and inclusive; nothing unrated passes a rating floor.
    const under = await request(app).get('/v1/shop/items').query({ maxPrice: 30000, limit: 100 }).set(authed(session));
    expect(under.body.data.length).toBeGreaterThan(0);
    expect(under.body.data.every((i: { price: number }) => i.price <= 30000)).toBe(true);
    const band = await request(app).get('/v1/shop/items').query({ minPrice: 100000, maxPrice: 150000, limit: 100 }).set(authed(session));
    expect(band.body.data.map((i: { id: string }) => i.id).sort()).toEqual(['badminton-set', 'gym-bag', 'hoodie', 'joggers']);
    const rated = await request(app).get('/v1/shop/items').query({ minRating: 4 }).set(authed(session));
    expect(rated.body.total).toBe(0);

    // Stock is joined at read time: the seeded sold-out towel, and a cap emptied just now.
    expect((await request(app).get('/v1/shop/items/gym-towel').set(authed(session))).body.inStock).toBe(false);
    await ShopInventoryModel.updateOne({ _id: 'cap' }, { $set: { onHand: 0 } });
    expect((await request(app).get('/v1/shop/items/cap').set(authed(session))).body.inStock).toBe(false);
    const inStock = await request(app).get('/v1/shop/items').query({ category: 'clothing', inStock: 'true' }).set(authed(session));
    expect(inStock.body.data.some((i: { id: string }) => i.id === 'cap')).toBe(false);
    expect((await request(app).get('/v1/shop/items/nope').set(authed(session))).status).toBe(404);
  });

  it('searches by prefix across title, tags and subcategory, sorts by price, and pages with a cursor', async () => {
    const session = await signUpAndRegister();
    const vest = await request(app).get('/v1/shop/items').query({ q: 'vest' }).set(authed(session));
    expect(vest.body.data.map((i: { id: string }) => i.id)).toEqual(['tank-top']);
    const leather = await request(app).get('/v1/shop/items').query({ q: 'leather ball' }).set(authed(session));
    expect(leather.body.data.map((i: { id: string }) => i.id)).toEqual(['cricket-ball']);
    expect((await request(app).get('/v1/shop/items').query({ q: '(*' }).set(authed(session))).status).toBe(200);

    const cheap = await request(app).get('/v1/shop/items').query({ sort: 'price_asc', limit: 3 }).set(authed(session));
    const prices = cheap.body.data.map((i: { price: number }) => i.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(cheap.body.data[0].id).toBe('sweatbands');
    const dear = await request(app).get('/v1/shop/items').query({ sort: 'price_desc', limit: 1 }).set(authed(session));
    expect(dear.body.data[0].id).toBe('kettlebell-8');
    const newest = await request(app).get('/v1/shop/items').query({ sort: 'newest', limit: 1 }).set(authed(session));
    expect(newest.body.data[0].id).toBe('gym-bag');

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5 && (page === 0 || cursor); page += 1) {
      const res = await request(app).get('/v1/shop/items').query({ limit: 10, cursor }).set(authed(session));
      seen.push(...res.body.data.map((i: { id: string }) => i.id));
      cursor = res.body.nextCursor ?? undefined;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe((await request(app).get('/v1/shop/items').query({ limit: 100 }).set(authed(session))).body.total);
  });

  it('describes each shelf, and publishes the till rules the app draws prices with', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).get('/v1/shop/categories').set(authed(session));
    const byName = Object.fromEntries(res.body.data.map((c: { category: string }) => [c.category, c]));
    expect(Object.keys(byName).sort()).toEqual(['accessories', 'clothing', 'gym', 'sports']);
    expect(byName.clothing.count).toBe(8);
    expect(byName.clothing.subcategories[0]).toEqual({ name: 'T-shirts', count: 2 });

    const config = await request(app).get('/v1/shop/config').set(authed(session));
    expect(config.status).toBe(200);
    expect(config.body).toEqual({
      currency: 'INR', coinValuePaise: COIN, coinShareMax: 0.3, shippingFeePaise: SHIPPING, freeShippingAbovePaise: 99900,
      maxQuantityPerLine: 5, paymentProvider: 'mock', paymentKeyId: null, stepUpThreshold: 1000,
    });
  });

  it('keeps exactly one default address, and a deleted default hands over to the newest survivor', async () => {
    const session = await signUpAndRegister();
    const first = await request(app).post('/v1/me/addresses').set(authed(session)).send(ADDRESS);
    expect(first.body.isDefault).toBe(true);
    const second = await request(app).post('/v1/me/addresses').set(authed(session)).send({ ...ADDRESS, label: 'Office', isDefault: true });
    expect(second.body.isDefault).toBe(true);
    let list = await request(app).get('/v1/me/addresses').set(authed(session));
    expect(list.body.data.map((a: { label: string; isDefault: boolean }) => [a.label, a.isDefault])).toEqual([['Office', true], ['Home', false]]);
    const unset = await request(app).put(`/v1/me/addresses/${second.body.id}`).set(authed(session)).send({ isDefault: false, line2: '' });
    expect(unset.body.isDefault).toBe(true);
    await request(app).post(`/v1/me/addresses/${first.body.id}/default`).set(authed(session));
    await request(app).delete(`/v1/me/addresses/${first.body.id}`).set(authed(session));
    list = await request(app).get('/v1/me/addresses').set(authed(session));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ label: 'Office', isDefault: true });
    expect((await request(app).post('/v1/me/addresses').set(authed(session)).send({ ...ADDRESS, postalCode: '1' })).status).toBe(422);
  });
});

describe('commerce: wishlist and cart (RULES R14)', () => {
  it('saves an item once however many times it is saved, lists it newest first, and forgets it', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).put('/v1/wishlist/nope').set(authed(session))).status).toBe(404);
    await request(app).put('/v1/wishlist/cap').set(authed(session));
    await request(app).put('/v1/wishlist/yoga-mat').set(authed(session));
    await request(app).put('/v1/wishlist/cap').set(authed(session));

    const ids = await request(app).get('/v1/wishlist/ids').set(authed(session));
    expect(ids.body.data).toEqual(['yoga-mat', 'cap']);
    const list = await request(app).get('/v1/wishlist').set(authed(session));
    expect(list.body.data.map((i: { id: string }) => i.id)).toEqual(['yoga-mat', 'cap']);
    expect(list.body.data[1]).toMatchObject({ price: 44900, inStock: true });

    await request(app).delete('/v1/wishlist/cap').set(authed(session));
    expect((await request(app).get('/v1/wishlist/ids').set(authed(session))).body.data).toEqual(['yoga-mat']);
    // Another user's list is their own.
    const other = await signUpAndRegister();
    expect((await request(app).get('/v1/wishlist/ids').set(authed(other))).body.data).toEqual([]);
  });

  it('keeps lines by item and size, checks sizes and the per-line cap, quotes the basket, and empties at zero', async () => {
    const { session } = await shopper(2_000);
    const empty = await request(app).get('/v1/cart').set(authed(session));
    expect(empty.body).toMatchObject({ lines: [], count: 0, quote: { subtotal: 0, shipping: 0, total: 0, coinsMax: 0, payable: 0 } });

    // A sized item needs its size; a wrong one is refused; a one-size item ignores any size sent.
    const noSize = await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'tee', quantity: 1 });
    expect(noSize.status).toBe(422);
    expect(noSize.body.error).toMatchObject({ code: 'SIZE_REQUIRED', details: { sizes: ['S', 'M', 'L', 'XL', 'XXL'] } });
    expect((await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'tee', quantity: 1, size: 'XS' })).body.error.code).toBe('SIZE_INVALID');
    expect((await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'nope', quantity: 1 })).status).toBe(404);

    await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'tee', quantity: 2, size: 'M' });
    await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'tee', quantity: 1, size: 'L' });
    const cart = await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'cap', quantity: 1, size: 'M' });
    expect(cart.status).toBe(200);
    expect(cart.body.lines.map((l: { item: { id: string }; quantity: number; size: string | null }) => [l.item.id, l.quantity, l.size]))
      .toEqual([['tee', 2, 'M'], ['tee', 1, 'L'], ['cap', 1, null]]);
    expect(cart.body.count).toBe(4);
    // Three tees and a cap: ₹2,397 + ₹449 = ₹2,846 of goods, over the free-shipping line; 30% is 3,415 coins, the wallet holds 2,000.
    expect(cart.body.quote).toMatchObject({
      subtotal: 79900 * 3 + 44900, mrpTotal: 119900 * 3 + 59900, discount: 40000 * 3 + 15000, shipping: 0,
      total: 284600, coinsMax: 2000, coinsApplied: 2000, coinsValue: 50000, payable: 234600, needsStepUp: true,
    });

    const over = await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'cap', quantity: 6 });
    expect(over.status).toBe(422);
    expect(over.body.error).toMatchObject({ code: 'QUANTITY_LIMIT', details: { max: 5 } });

    // Zero removes; the size says which of the two tee lines.
    const fewer = await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'tee', quantity: 0, size: 'L' });
    expect(fewer.body.lines).toHaveLength(2);
    const gone = await request(app).delete('/v1/cart/lines/cap').set(authed(session));
    expect(gone.body.lines.map((l: { item: { id: string } }) => l.item.id)).toEqual(['tee']);
    // An item taken off sale drops out of the basket rather than breaking it.
    await ShopItemModel.updateOne({ _id: 'tee' }, { $set: { active: false } });
    expect((await request(app).get('/v1/cart').set(authed(session))).body.lines).toEqual([]);
    await ShopItemModel.updateOne({ _id: 'tee' }, { $set: { active: true } });
    await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'shaker', quantity: 2 });
    expect((await request(app).delete('/v1/cart').set(authed(session))).body.count).toBe(0);
  });

  it('quotes the split the till will charge: the coin share of the goods, then the wallet, then shipping in money', async () => {
    const { session } = await shopper(2_000);
    // A ₹449 cap: 30% at ₹0.25 a coin is 538 coins; ₹49 to ship under ₹999.
    const q = await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }] });
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({
      currency: 'INR', subtotal: 44900, mrpTotal: 59900, discount: 15000, shipping: SHIPPING, total: 49800,
      coinValuePaise: COIN, coinsMax: 538, coinsApplied: 538, coinsValue: 538 * COIN, payable: 49800 - 538 * COIN, needsStepUp: false,
    });
    expect(q.body.lines[0]).toMatchObject({ itemId: 'cap', title: 'VOKVE Cap', quantity: 1, size: null, price: 44900, lineTotal: 44900, inStock: true });

    // Fewer coins than allowed is the user's choice; more is clamped; none is all money.
    expect((await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], coins: 100 })).body).toMatchObject({ coinsApplied: 100, payable: 49800 - 2500 });
    expect((await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], coins: 9999 })).body.coinsApplied).toBe(538);
    expect((await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], coins: 0 })).body).toMatchObject({ coinsApplied: 0, payable: 49800 });

    // The wallet is the second cap: 200 coins in hand means 200, whatever the share allows.
    const poor = await shopper(200);
    expect((await request(app).post('/v1/checkout/quote').set(authed(poor.session)).send({ lines: [{ itemId: 'cap', quantity: 1 }] })).body.coinsMax).toBe(200);

    // Over the free-shipping line nothing is charged to ship; a step-up is flagged from 1,000 coins.
    const big = await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'kettlebell-8', quantity: 1 }] });
    expect(big.body).toMatchObject({ shipping: 0, coinsMax: 2000, needsStepUp: true });

    // The share is config: at 100% an order can be coins alone.
    await setCommerce({ coinShareMax: 1 });
    const all = await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'shaker', quantity: 1 }] });
    expect(all.body).toMatchObject({ subtotal: 24900, shipping: SHIPPING, coinsMax: (24900 / COIN), payable: SHIPPING });
    await setCommerce({});
  });
});

describe('commerce: checkout and payment (RULES R2–R4, R11–R13, O8, T5)', () => {
  it('refuses until both contacts are verified, then until there is an address, and with nothing to buy', async () => {
    const session = await signUpAndRegister();
    const unverified = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId: 'adr_none' });
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe('PHONE_NOT_VERIFIED');

    await UserModel.updateOne({ _id: session.userId }, { $set: { phoneVerifiedAt: new Date(), emailVerifiedAt: new Date() } });
    const noAddress = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId: 'adr_none' });
    expect(noAddress.status).toBe(422);
    expect(noAddress.body.error.code).toBe('ADDRESS_REQUIRED');

    const created = await request(app).post('/v1/me/addresses').set(authed(session)).send(ADDRESS);
    const emptyCart = await request(app).post('/v1/checkout').set(authed(session)).send({ fromCart: true, addressId: created.body.id });
    expect(emptyCart.status).toBe(422);
    expect(emptyCart.body.error.code).toBe('CART_EMPTY');
    expect((await request(app).post('/v1/checkout').set(authed(session)).send({ addressId: created.body.id })).status).toBe(422);
  });

  it('places a part-coins order as pending, collects the money, and only then calls it placed', async () => {
    const { session, addressId } = await shopper(2_000);
    const before = (await ShopInventoryModel.findById('cap').lean())!.onHand;
    await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'cap', quantity: 1 });

    const placed = await request(app).post('/v1/checkout').set({ ...authed(session), 'idempotency-key': 'c1' }).send({ fromCart: true, addressId, coins: 500 });
    expect(placed.status).toBe(200);
    expect(placed.body.balance).toBe(1_500);
    expect(placed.body.order).toMatchObject({
      status: 'pending_payment', cancellable: true, subtotal: 44900, shipping: SHIPPING, total: 49800,
      coinsUsed: 500, coinsValue: 12500, payable: 37300,
      payment: { provider: 'mock', status: 'pending', amount: 37300, providerOrderId: expect.stringMatching(/^mockord_/), paidAt: null, expiresAt: expect.any(String) },
      items: [{ itemId: 'cap', title: 'VOKVE Cap', quantity: 1, price: 44900, mrp: 59900 }],
      address: { name: 'Asha Verma', city: 'Bengaluru' },
    });
    expect(placed.body.payment).toMatchObject({ provider: 'mock', orderId: placed.body.order.id, amount: 37300, currency: 'INR', keyId: null });

    // Held at once: the coins, the unit, and the basket line is gone.
    expect((await ShopInventoryModel.findById('cap').lean())!.onHand).toBe(before - 1);
    expect((await request(app).get('/v1/wallet').set(authed(session))).body.balance).toBe(1_500);
    expect((await request(app).get('/v1/cart').set(authed(session))).body.lines).toEqual([]);
    const ledger = await request(app).get('/v1/wallet/transactions').set(authed(session));
    expect(ledger.body.data[0]).toMatchObject({ source: 'purchase', amount: -500, title: 'VOKVE Cap' });
    // Not yet an order to count, and no "placed" word yet.
    expect((await request(app).get('/v1/orders/count').set(authed(session))).body).toEqual({ count: 0 });
    expect(await NotificationModel.countDocuments({ userId: session.userId, title: 'Order placed' })).toBe(0);

    // The same key replays the same order rather than placing a second (BACKEND §3.6).
    const replay = await request(app).post('/v1/checkout').set({ ...authed(session), 'idempotency-key': 'c1' }).send({ fromCart: true, addressId, coins: 500 });
    expect(replay.body.order.id).toBe(placed.body.order.id);
    expect(await OrderModel.countDocuments({ userId: session.userId })).toBe(1);

    const bad = await request(app).post(`/v1/orders/${placed.body.order.id}/pay`).set(authed(session)).send({ providerPaymentId: '' });
    expect(bad.status).toBe(422);
    const paid = await request(app).post(`/v1/orders/${placed.body.order.id}/pay`).set(authed(session)).send({ providerPaymentId: 'pay_abc' });
    expect(paid.status).toBe(200);
    expect(paid.body.order).toMatchObject({ status: 'placed', payment: { status: 'paid', paidAt: expect.any(String) } });
    // Paid once, paid: the same proof again is the same answer.
    const again = await request(app).post(`/v1/orders/${placed.body.order.id}/pay`).set(authed(session)).send({ providerPaymentId: 'pay_abc' });
    expect(again.body.order).toMatchObject({ status: 'placed', payment: { status: 'paid' } });
    expect((await request(app).get('/v1/orders/count').set(authed(session))).body).toEqual({ count: 1 });
    const feed = await request(app).get('/v1/notifications').set(authed(session));
    expect(feed.body.data[0]).toMatchObject({ title: 'Order placed', topic: 'reward' });

    // The address moved on; the order keeps what it was shipped to.
    await request(app).put(`/v1/me/addresses/${addressId}`).set(authed(session)).send({ city: 'Mumbai' });
    expect((await request(app).get(`/v1/orders/${placed.body.order.id}`).set(authed(session))).body.address.city).toBe('Bengaluru');
  });

  it('an order the coins cover needs no payment and is placed at once; more coins than allowed is refused', async () => {
    const { session, addressId } = await shopper(2_000);
    const over = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'shaker', quantity: 1 }], addressId, coins: 299 });
    expect(over.status).toBe(422);
    expect(over.body.error).toMatchObject({ code: 'COINS_OVER_LIMIT', details: { coinsMax: 298 } });
    expect(await OrderModel.countDocuments({ userId: session.userId })).toBe(0);

    await setCommerce({ coinShareMax: 1, shippingFeePaise: 0 });
    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'shaker', quantity: 1 }], addressId, coins: 996 });
    expect(placed.status).toBe(200);
    expect(placed.body.payment).toBeNull();
    expect(placed.body.order).toMatchObject({ status: 'placed', coinsUsed: 996, coinsValue: 24900, payable: 0, payment: { provider: null, status: 'not_required' } });
    expect(placed.body.balance).toBe(1_004);
    expect(await NotificationModel.countDocuments({ userId: session.userId, title: 'Order placed' })).toBe(1);
    await setCommerce({});
  });

  it('the last unit goes to exactly one of many concurrent buyers, and the rest keep their coins', async () => {
    const buyers = await Promise.all(Array.from({ length: 6 }, () => shopper(1_000)));
    await ShopInventoryModel.updateOne({ _id: 'cap' }, { $set: { onHand: 1 } });
    const results = await Promise.all(buyers.map(({ session, addressId }) =>
      request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 300 }),
    ));
    const won = results.filter(r => r.status === 200);
    const soldOut = results.filter(r => r.status === 409);
    expect(won).toHaveLength(1);
    expect(soldOut).toHaveLength(5);
    expect(soldOut[0].body.error.code).toBe('OUT_OF_STOCK');
    expect((await ShopInventoryModel.findById('cap').lean())!.onHand).toBe(0);
    const balances = await Promise.all(buyers.map(({ session }) => request(app).get('/v1/wallet').set(authed(session)).then(r => r.body.balance)));
    expect(balances.filter(b => b === 700)).toHaveLength(1);
    expect(balances.filter(b => b === 1_000)).toHaveLength(5);
  });

  it('a thousand coins or more in one order needs a step-up, which is single-use and belongs to its user', async () => {
    const { session, addressId } = await shopper(3_000);
    const hoodie = { lines: [{ itemId: 'hoodie', quantity: 1, size: 'L' }], addressId, coins: 1_500 };

    const noToken = await request(app).post('/v1/checkout').set(authed(session)).send(hoodie);
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('STEP_UP_REQUIRED');
    expect((await request(app).post('/v1/checkout').set(authed(session)).send({ ...hoodie, stepUpToken: 'nope' })).body.error.code).toBe('STEP_UP_INVALID');

    const token = await stepUp(session);
    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ ...hoodie, stepUpToken: token });
    expect(placed.status).toBe(200);
    expect(placed.body.balance).toBe(1_500);
    expect(placed.body.order.items[0]).toMatchObject({ itemId: 'hoodie', size: 'L' });

    const reused = await request(app).post('/v1/checkout').set(authed(session)).send({ ...hoodie, stepUpToken: token });
    expect(reused.body.error.code).toBe('STEP_UP_INVALID');
    const other = await shopper(3_000);
    const theirs = await stepUp(other.session);
    expect((await request(app).post('/v1/checkout').set(authed(session)).send({ ...hoodie, stepUpToken: theirs })).body.error.code).toBe('STEP_UP_INVALID');

    // Under the threshold — or with no coins at all — no code is asked for.
    expect((await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'shaker', quantity: 1 }], addressId, coins: 100 })).status).toBe(200);
    expect((await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'kettlebell-8', quantity: 1 }], addressId, coins: 0 })).status).toBe(200);
  });

  it('a watch-tier user must step up for anything once trust is enforced; restricted cannot buy at all', async () => {
    await AppConfigModel.updateOne({ _id: 'trust' }, { $set: { value: { shadow: false } } }, { upsert: true });
    invalidateConfig();
    const { session, addressId } = await shopper(1_000);
    await UserModel.updateOne({ _id: session.userId }, { $set: { 'trust.tier': 'watch' } });
    const refreshed = await request(app).post('/v1/auth/refresh').set(authed(session)).send({ refreshToken: session.refreshToken });
    const asWatch = { ...authed(session), authorization: `Bearer ${refreshed.body.accessToken}` };
    const watch = await request(app).post('/v1/checkout').set(asWatch).send({ lines: [{ itemId: 'shaker', quantity: 1 }], addressId, coins: 0 });
    expect(watch.status).toBe(403);
    expect(watch.body.error.code).toBe('STEP_UP_REQUIRED');

    await UserModel.updateOne({ _id: session.userId }, { $set: { 'trust.tier': 'restricted' } });
    const again = await request(app).post('/v1/auth/refresh').set(authed(session)).send({ refreshToken: refreshed.body.refreshToken });
    const asRestricted = { ...authed(session), authorization: `Bearer ${again.body.accessToken}` };
    const restricted = await request(app).post('/v1/checkout').set(asRestricted).send({ lines: [{ itemId: 'shaker', quantity: 1 }], addressId, coins: 0 });
    expect(restricted.status).toBe(403);
    expect(restricted.body.error.code).toBe('PURCHASES_RESTRICTED');
    await AppConfigModel.updateOne({ _id: 'trust' }, { $set: { value: { shadow: true } } }, { upsert: true });
    invalidateConfig();
  });
});

describe('commerce: orders, cancellation and expiry (RULES R5–R7)', () => {
  it('lists newest first with a cursor; cancelling puts back the coins, the stock and the money, exactly once', async () => {
    const { session, addressId } = await shopper(3_000);
    const before = (await ShopInventoryModel.findById('shaker').lean())!.onHand;
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await buy(session, addressId, [{ itemId: 'shaker' }], 100)).id);
    }
    const first = await request(app).get('/v1/orders').query({ limit: 2 }).set(authed(session));
    expect(first.body.data.map((o: { id: string }) => o.id)).toEqual([ids[2], ids[1]]);
    const rest = await request(app).get('/v1/orders').query({ limit: 2, cursor: first.body.nextCursor }).set(authed(session));
    expect(rest.body.data.map((o: { id: string }) => o.id)).toEqual([ids[0]]);

    const cancelled = await request(app).post(`/v1/orders/${ids[0]}/cancel`).set(authed(session));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order).toMatchObject({ status: 'cancelled', cancellable: false, payment: { status: 'refunded' } });
    expect(cancelled.body.balance).toBe(3_000 - 200);
    expect((await ShopInventoryModel.findById('shaker').lean())!.onHand).toBe(before - 2);
    expect((await ShopItemModel.findById('shaker').lean())!.popularity).toBe(220 + 3);
    const refund = await CoinLedgerModel.findOne({ userId: session.userId, source: 'refund', referenceType: 'order_cancel' }).lean();
    expect(refund?.amountMc).toBe(100_000);

    const twice = await request(app).post(`/v1/orders/${ids[0]}/cancel`).set(authed(session));
    expect(twice.body.balance).toBe(2_800);
    expect(await CoinLedgerModel.countDocuments({ userId: session.userId, source: 'refund', referenceType: 'order_cancel' })).toBe(1);

    await OrderModel.updateOne({ _id: ids[1] }, { $set: { status: 'shipped', trackingRef: 'DL123' } });
    const late = await request(app).post(`/v1/orders/${ids[1]}/cancel`).set(authed(session));
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
    expect((await request(app).get(`/v1/orders/${ids[1]}`).set(authed(session))).body).toMatchObject({ status: 'shipped', trackingRef: 'DL123', cancellable: false });

    const other = await signUpAndRegister();
    expect((await request(app).get(`/v1/orders/${ids[2]}`).set(authed(other))).status).toBe(404);
    expect((await request(app).post(`/v1/orders/${ids[2]}/cancel`).set(authed(other))).status).toBe(404);
    expect(await NotificationModel.countDocuments({ userId: session.userId, title: 'Order cancelled' })).toBe(1);
  });

  it('an unpaid order can be cancelled with nothing to refund but coins, and is released when its window closes', async () => {
    const { session, addressId } = await shopper(1_000);
    const before = (await ShopInventoryModel.findById('cap').lean())!.onHand;
    const a = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 100 });
    const b = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 100 });
    expect((await ShopInventoryModel.findById('cap').lean())!.onHand).toBe(before - 2);

    const cancelled = await request(app).post(`/v1/orders/${a.body.order.id}/cancel`).set(authed(session));
    expect(cancelled.body.order).toMatchObject({ status: 'cancelled', payment: { status: 'pending' } });
    expect(cancelled.body.balance).toBe(900);

    // The window closes on the other: the sweep lets it go, and a late payment is refused.
    await OrderModel.updateOne({ _id: b.body.order.id }, { $set: { 'payment.expiresAt': new Date(Date.now() - 1000) } });
    expect(await expireUnpaidOrders()).toEqual({ released: 1 });
    expect((await request(app).get(`/v1/orders/${b.body.order.id}`).set(authed(session))).body.status).toBe('cancelled');
    expect((await request(app).get('/v1/wallet').set(authed(session))).body.balance).toBe(1_000);
    expect((await ShopInventoryModel.findById('cap').lean())!.onHand).toBe(before);
    const late = await request(app).post(`/v1/orders/${b.body.order.id}/pay`).set(authed(session)).send({ providerPaymentId: 'pay_late' });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ORDER_NOT_PENDING');
    expect(await NotificationModel.countDocuments({ userId: session.userId, title: 'Order expired' })).toBe(1);

    // A window that has closed but not yet been swept is caught at payment time.
    const c = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 0 });
    await OrderModel.updateOne({ _id: c.body.order.id }, { $set: { 'payment.expiresAt': new Date(Date.now() - 1000) } });
    const expired = await request(app).post(`/v1/orders/${c.body.order.id}/pay`).set(authed(session)).send({ providerPaymentId: 'pay_x' });
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe('PAYMENT_EXPIRED');
    expect((await ShopInventoryModel.findById('cap').lean())!.onHand).toBe(before);
  });
});

describe('commerce: reviews (RULES R15)', () => {
  it('one review per user per item, marked verified for a buyer, summarised onto the item and its sort', async () => {
    const { session, addressId } = await shopper(1_000);
    await buy(session, addressId, [{ itemId: 'yoga-mat' }]);
    const short = await request(app).put('/v1/shop/items/yoga-mat/reviews/me').set(authed(session)).send({ rating: 5, body: 'Great' });
    expect(short.status).toBe(422);
    expect((await request(app).put('/v1/shop/items/nope/reviews/me').set(authed(session)).send({ rating: 5, body: 'Long enough body here.' })).status).toBe(404);

    const mine = await request(app).put('/v1/shop/items/yoga-mat/reviews/me').set(authed(session)).send({ rating: 4, title: 'Grippy', body: 'Stays put on a wooden floor, and rolls tight.' });
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ itemId: 'yoga-mat', rating: 4, title: 'Grippy', authorName: 'Asha', verified: true, mine: true });

    // A change of mind is an edit, not a second voice.
    const edited = await request(app).put('/v1/shop/items/yoga-mat/reviews/me').set(authed(session)).send({ rating: 5, body: 'Stays put on a wooden floor, and rolls tight. Still grippy a month in.' });
    expect(edited.body.id).toBe(mine.body.id);
    expect(await ReviewModel.countDocuments({ itemId: 'yoga-mat' })).toBe(1);

    // Someone who never bought it may still speak, unverified and anonymous without a name.
    const other = await signUpAndRegister();
    const theirs = await request(app).put('/v1/shop/items/yoga-mat/reviews/me').set(authed(other)).send({ rating: 2, body: 'Thinner than I expected for the price.' });
    expect(theirs.body).toMatchObject({ verified: false, authorName: 'A VOKVE member', mine: true });

    const page = await request(app).get('/v1/shop/items/yoga-mat/reviews').set(authed(session));
    expect(page.status).toBe(200);
    expect(page.body.summary).toEqual({ average: 3.5, count: 2, histogram: [0, 1, 0, 0, 1] });
    expect(page.body.mine.id).toBe(mine.body.id);
    expect(page.body.data.map((r: { mine: boolean; rating: number }) => [r.rating, r.mine])).toEqual([[2, false], [5, true]]);
    const top = await request(app).get('/v1/shop/items/yoga-mat/reviews').query({ sort: 'top' }).set(authed(session));
    expect(top.body.data[0].rating).toBe(5);

    // The item carries the summary, and lists can sort and filter by it.
    expect((await request(app).get('/v1/shop/items/yoga-mat').set(authed(session))).body.rating).toEqual({ average: 3.5, count: 2 });
    const byRating = await request(app).get('/v1/shop/items').query({ sort: 'rating', limit: 1 }).set(authed(session));
    expect(byRating.body.data[0].id).toBe('yoga-mat');
    expect((await request(app).get('/v1/shop/items').query({ minRating: 3 }).set(authed(session))).body.data.map((i: { id: string }) => i.id)).toEqual(['yoga-mat']);
    expect((await request(app).get('/v1/shop/items').query({ minRating: 4 }).set(authed(session))).body.total).toBe(0);

    await request(app).delete('/v1/shop/items/yoga-mat/reviews/me').set(authed(other));
    expect((await request(app).get('/v1/shop/items/yoga-mat').set(authed(session))).body.rating).toEqual({ average: 5, count: 1 });
    expect((await request(app).delete('/v1/shop/items/yoga-mat/reviews/me').set(authed(other))).status).toBe(404);
  });
});
