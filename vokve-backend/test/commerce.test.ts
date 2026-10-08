import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { invalidateConfig } from '../src/config/remote.js';
import { CouponModel, CouponUsageModel, OrderModel, ReviewModel, ShopInventoryModel, ShopItemModel } from '../src/modules/commerce/models.js';
import { expireUnpaidOrders } from '../src/modules/commerce/service.js';
import { CoinLedgerModel } from '../src/modules/economy/models.js';
import { credit } from '../src/modules/economy/service.js';
import { UserModel } from '../src/modules/identity/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { setWhatsAppTransport } from '../src/lib/whatsapp.js';
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

    // The product page's details ride on the item; an item with none has empty sections, and an older single photo reads as a gallery.
    const tee = (await request(app).get('/v1/shop/items/tee').set(authed(session))).body;
    expect(tee).toMatchObject({
      ribbon: 'Premium Quality', images: [],
      colors: [{ name: 'Black', hex: '#111111' }, { name: 'Navy' }, { name: 'Grey' }, { name: 'Charcoal' }],
      highlights: [{ icon: 'fabric', label: 'Fabric', value: 'Dry Fit Polyester' }],
      specs: [{ icon: 'category' }, { icon: 'material' }, { icon: 'care' }],
    });
    expect(tee.features.map((f: { icon: string }) => f.icon)).toEqual(['breathable', 'lightweight', 'stretch', 'durable']);
    await ShopItemModel.updateOne({ _id: 'tennis-balls' }, { $set: { imageUrl: 'https://cdn.example/tennis.jpg' } });
    expect((await request(app).get('/v1/shop/items/tennis-balls').set(authed(session))).body)
      .toMatchObject({ ribbon: null, colors: [], highlights: [], features: [], specs: [], images: ['https://cdn.example/tennis.jpg'] });
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
      currency: 'INR', coinValuePaise: COIN, paymentMode: 'mixed', coinShareMin: 0, coinShareMax: 0.3, shippingFeePaise: SHIPPING,
      freeShippingAbovePaise: 99900, maxQuantityPerLine: 5, paymentProvider: 'mock', paymentKeyId: null, stepUpThreshold: 1000,
      paymentMethods: ['coins', 'coins_upi', 'upi', 'card', 'netbanking'],
      deliveryEstimate: '2–4 working days', returnPolicy: 'Free cancellation until it ships', couponsEnabled: true,
      deliveryNotice: 'Delivery partners may call you for verification if needed.', offersWhatsAppUpdates: true,
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

  it('keeps lines by item, size and colour, checks sizes, colours and the per-line cap, quotes the basket, and empties at zero', async () => {
    const { session } = await shopper(2_000);
    const empty = await request(app).get('/v1/cart').set(authed(session));
    expect(empty.body).toMatchObject({ lines: [], count: 0, quote: { subtotal: 0, shipping: 0, total: 0, coinsMax: 0, payable: 0 } });

    // A sized item needs its size; a wrong one is refused; a one-size item ignores any size sent.
    const noSize = await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'tee', quantity: 1, color: 'Black' });
    expect(noSize.status).toBe(422);
    expect(noSize.body.error).toMatchObject({ code: 'SIZE_REQUIRED', details: { sizes: ['S', 'M', 'L', 'XL', 'XXL'] } });
    expect((await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'tee', quantity: 1, size: 'XS', color: 'Black' })).body.error.code).toBe('SIZE_INVALID');
    expect((await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'nope', quantity: 1 })).status).toBe(404);
    // Likewise a coloured item needs one of its colours, by name.
    const noColor = await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'tee', quantity: 1, size: 'M' });
    expect(noColor.status).toBe(422);
    expect(noColor.body.error).toMatchObject({ code: 'COLOR_REQUIRED', details: { colors: ['Black', 'Navy', 'Grey', 'Charcoal'] } });
    expect((await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'tee', quantity: 1, size: 'M', color: 'Pink' })).body.error.code).toBe('COLOR_INVALID');

    await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'tee', quantity: 2, size: 'M', color: 'Black' });
    await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'tee', quantity: 1, size: 'L', color: 'Black' });
    const cart = await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'cap', quantity: 1, size: 'M', color: 'Red' });
    expect(cart.status).toBe(200);
    expect(cart.body.lines.map((l: { item: { id: string }; quantity: number; size: string | null; color: string | null }) => [l.item.id, l.quantity, l.size, l.color]))
      .toEqual([['tee', 2, 'M', 'Black'], ['tee', 1, 'L', 'Black'], ['cap', 1, null, null]]);
    expect(cart.body.count).toBe(4);
    // Three tees and a cap: ₹2,397 + ₹449 = ₹2,846 of goods, over the free-shipping line; 30% is 3,415 coins, the wallet holds 2,000.
    expect(cart.body.quote).toMatchObject({
      subtotal: 79900 * 3 + 44900, mrpTotal: 119900 * 3 + 59900, discount: 40000 * 3 + 15000, shipping: 0,
      total: 284600, coinsMax: 2000, coinsApplied: 2000, coinsValue: 50000, payable: 234600,
    });
    // The 2,000 coins the wallet holds are spread across the three lines,
    // and what is left of each line's goods is money: the parts add back
    // up to the basket (RULES R11).
    const split = cart.body.quote.lines.map((l: { coinsUsed: number; coinsValue: number; moneyPaid: number }) => l);
    expect(split.reduce((sum: number, l: { coinsUsed: number }) => sum + l.coinsUsed, 0)).toBe(2_000);
    expect(split.reduce((sum: number, l: { coinsValue: number; moneyPaid: number }) => sum + l.coinsValue + l.moneyPaid, 0)).toBe(284600);

    const over = await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'cap', quantity: 6 });
    expect(over.status).toBe(422);
    expect(over.body.error).toMatchObject({ code: 'QUANTITY_LIMIT', details: { max: 5 } });

    // Zero removes; the size says which of the two tee lines.
    const fewer = await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'tee', quantity: 0, size: 'L', color: 'Black' });
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
      coinValuePaise: COIN, coinsMax: 538, coinsApplied: 538, coinsValue: 538 * COIN, payable: 49800 - 538 * COIN,
    });
    expect(q.body.lines[0]).toMatchObject({ itemId: 'cap', title: 'VOKVE Cap', quantity: 1, size: null, price: 44900, lineTotal: 44900, inStock: true });
    // One line, so the whole split is its own: 538 coins of the ₹449, the
    // rest of the goods in money (the ₹49 delivery is the order's).
    expect(q.body.lines[0]).toMatchObject({ coinsUsed: 538, coinsValue: 538 * COIN, moneyPaid: 44900 - 538 * COIN });
    // The art the till's item rows draw; null while the item carries no picture.
    expect(q.body.lines[0]).toHaveProperty('image', null);

    // Fewer coins than allowed is the user's choice; more is clamped; none is all money.
    expect((await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], coins: 100 })).body).toMatchObject({ coinsApplied: 100, payable: 49800 - 2500 });
    expect((await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], coins: 9999 })).body.coinsApplied).toBe(538);
    expect((await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], coins: 0 })).body).toMatchObject({ coinsApplied: 0, payable: 49800 });

    // The wallet is the second cap: 200 coins in hand means 200, whatever the share allows.
    const poor = await shopper(200);
    expect((await request(app).post('/v1/checkout/quote').set(authed(poor.session)).send({ lines: [{ itemId: 'cap', quantity: 1 }] })).body.coinsMax).toBe(200);

    // Over the free-shipping line nothing is charged to ship.
    const big = await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'kettlebell-8', quantity: 1 }] });
    expect(big.body).toMatchObject({ shipping: 0, coinsMax: 2000 });

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

    // What the confirmation screen reads: a reference a member can say out
    // loud, the window it promised, and the channels its news will reach.
    const order = placed.body.order;
    expect(order.number).toMatch(/^VKV\d{6}\d{4,6}$/);
    expect(order.items[0]).toMatchObject({ coinPrice: 1796, image: null });
    const days = (iso: string) =>
      Math.round((new Date(iso).getTime() - new Date(order.placedAt).getTime()) / 86_400_000);
    expect(days(order.estimatedDelivery.from)).toBe(4);
    expect(days(order.estimatedDelivery.to)).toBe(7);
    // No SMS provider exists, so it is never promised (D-31).
    expect(order.trackingChannels).toEqual(['email']);

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

  it('spending coins asks for no code, however many: the member confirms the deduction in the app (D-66)', async () => {
    const { session, addressId } = await shopper(3_000);
    // ₹1,499, mixed: 1,500 of the 1,798 coins the share allows, the rest money.
    const hoodie = { lines: [{ itemId: 'hoodie', quantity: 1, size: 'L', color: 'Navy' }], addressId, coins: 1_500 };

    const placed = await request(app).post('/v1/checkout').set(authed(session)).send(hoodie);
    expect(placed.status).toBe(200);
    expect(placed.body.balance).toBe(1_500);
    expect(placed.body.order).toMatchObject({ status: 'pending_payment', coinsUsed: 1_500, coinsValue: 1_500 * COIN, payable: 149900 - 1_500 * COIN });
    // A token offered anyway is simply unnecessary, not an error.
    const token = await stepUp(session);
    expect((await request(app).post('/v1/checkout').set(authed(session)).send({ ...hoodie, coins: 1_000, stepUpToken: token })).status).toBe(200);
  });

  it('records what each product took in coins and in money, so an order reads line by line (R11)', async () => {
    const { session, addressId } = await shopper(3_000);
    // One of each kind on one order: socks are coins-only (₹299), the cap
    // mixed (₹449, 30% = 538 coins), the joggers money-only (₹1,099).
    // ₹1,847 of goods ships free.
    const lines = [{ itemId: 'socks', quantity: 1 }, { itemId: 'cap', quantity: 1 }, { itemId: 'joggers', quantity: 1, size: 'M', color: 'Black' }];
    const q = await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines });
    expect(q.body).toMatchObject({ paymentMode: 'mixed', shipping: 0, total: 184700, coinsApplied: 1_734, coinsValue: 1_734 * COIN, payable: 184700 - 1_734 * COIN });

    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines, addressId, coins: 1_734 });
    expect(placed.status).toBe(200);
    expect(placed.body.order.items.map((i: { itemId: string; coinsUsed: number; coinsValue: number; moneyPaid: number }) =>
      [i.itemId, i.coinsUsed, i.coinsValue, i.moneyPaid])).toEqual([
      // The socks are bought with coins alone: ₹299 at ₹0.25 a coin.
      ['socks', 1_196, 29900, 0],
      // The cap takes its 30% in coins and the rest in money.
      ['cap', 538, 13450, 44900 - 13450],
      // The joggers take no coins at all.
      ['joggers', 0, 0, 109900],
    ]);

    // The parts add back up to the order: coins to its coins, money to its payable.
    const items = placed.body.order.items as { coinsUsed: number; moneyPaid: number }[];
    expect(items.reduce((sum, i) => sum + i.coinsUsed, 0)).toBe(placed.body.order.coinsUsed);
    expect(items.reduce((sum, i) => sum + i.moneyPaid, 0)).toBe(placed.body.order.payable);
  });

  it('a coins-only order takes the coins and is placed at once, with every line priced in coins (R11, D-66)', async () => {
    await setCommerce({ paymentMode: 'coins' });
    const { session, addressId } = await shopper(3_000);
    // ₹249 shaker and ₹299 socks in coins: 996 + 1,196, delivery 196 coins.
    const lines = [{ itemId: 'shaker', quantity: 1 }, { itemId: 'socks', quantity: 1 }];
    const q = await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines });
    expect(q.body).toMatchObject({ paymentMode: 'coins', payable: 0, inCoins: { goods: 2_192, discount: 0, shipping: 196, total: 2_388 } });

    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines, addressId, coins: 2_388 });
    expect(placed.status).toBe(200);
    // No money side at all: placed straight away, nothing to collect.
    expect(placed.body).toMatchObject({ payment: null, balance: 3_000 - 2_388 });
    expect(placed.body.order).toMatchObject({ status: 'placed', payable: 0, coinsUsed: 2_388 });
    expect(placed.body.order.items.map((i: { itemId: string; coinsUsed: number; moneyPaid: number }) => [i.itemId, i.coinsUsed, i.moneyPaid]))
      .toEqual([['shaker', 996, 0], ['socks', 1_196, 0]]);
    // The lines carry the goods; the 196 delivery coins are the order's.
    expect(placed.body.order.items.reduce((sum: number, i: { coinsUsed: number }) => sum + i.coinsUsed, 0) + placed.body.order.inCoins.shipping)
      .toBe(placed.body.order.coinsUsed);
    await setCommerce({});
  });

  it('the step-up retry under the same idempotency key places the order, rather than replaying the refusal (O8, D-62)', async () => {
    // The one step-up left is the trust gate, so that is what parks an
    // attempt now. The app keeps one key for the whole attempt, so the
    // retry after the code is the same request with the code added.
    await AppConfigModel.updateOne({ _id: 'trust' }, { $set: { value: { shadow: false } } }, { upsert: true });
    invalidateConfig();
    const { session, addressId } = await shopper(3_000);
    await UserModel.updateOne({ _id: session.userId }, { $set: { 'trust.tier': 'watch' } });
    const refreshed = await request(app).post('/v1/auth/refresh').set(authed(session)).send({ refreshToken: session.refreshToken });
    const asWatch = { ...authed(session), authorization: `Bearer ${refreshed.body.accessToken}` };
    const key = 'checkout-attempt-1';
    const send = (body: Record<string, unknown>) =>
      request(app).post('/v1/checkout').set(asWatch).set('Idempotency-Key', key).send(body);
    const order = { lines: [{ itemId: 'shaker', quantity: 1 }], addressId, coins: 100 };

    const refused = await send(order);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('STEP_UP_REQUIRED');

    const token = await stepUp(session);
    const placed = await send({ ...order, stepUpToken: token });
    expect(placed.status).toBe(200);

    // And the key still does the job it is there for: a replay of the
    // request that worked is the same order, never a second one.
    const again = await send({ ...order, stepUpToken: token });
    expect(again.status).toBe(200);
    expect(again.body.order.id).toBe(placed.body.order.id);
    expect(await OrderModel.countDocuments({ userId: session.userId })).toBe(1);

    await AppConfigModel.updateOne({ _id: 'trust' }, { $set: { value: { shadow: true } } }, { upsert: true });
    invalidateConfig();
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

describe('commerce: the order page — tabs, timeline, address and buy again (RULES R5)', () => {
  it('reads an order back with every stop it has made, the ones still ahead, and the promises the page makes', async () => {
    const { session, addressId } = await shopper(3_000);
    const order = await buy(session, addressId, [{ itemId: 'shaker' }], 100);

    // Fresh from the till: placed, nothing else reached, and no live tracking to offer yet.
    expect(order).toMatchObject({
      status: 'placed',
      headline: 'Your order is being prepared.',
      trackingUrl: null,
      addressChangeable: true,
      returns: { eligible: false, windowDays: 7, until: null, note: 'Easy returns within 7 days (as per policy).' },
    });
    expect(order.timeline.map((stop: { status: string; done: boolean }) => [stop.status, stop.done])).toEqual([
      ['placed', true], ['confirmed', false], ['shipped', false], ['delivered', false],
    ]);
    expect(order.timeline[0].at).toEqual(expect.any(String));
    expect(order.timeline[1].at).toBeNull();

    // The warehouse packs it and hands it to the courier; each stop keeps its own time.
    const packedAt = new Date('2026-09-20T05:45:00.000Z');
    const shippedAt = new Date('2026-09-21T13:10:00.000Z');
    await OrderModel.updateOne({ _id: order.id }, {
      $set: { status: 'shipped', trackingRef: 'DL 123/456' },
      $push: { events: { $each: [{ from: 'placed', to: 'confirmed', actor: 'admin', at: packedAt }, { from: 'confirmed', to: 'shipped', actor: 'admin', at: shippedAt }] } },
    });

    const shipped = await request(app).get(`/v1/orders/${order.id}`).set(authed(session));
    expect(shipped.body).toMatchObject({
      status: 'shipped',
      headline: 'Your order is on the way!',
      // The reference is escaped into the ⚙ template, never pasted raw.
      trackingUrl: 'https://track.vokve.app/DL%20123%2F456',
      addressChangeable: false,
      cancellable: false,
    });
    expect(shipped.body.timeline.map((stop: { title: string; at: string | null }) => [stop.title, stop.at])).toEqual([
      ['Order Placed', expect.any(String)],
      ['Packed', packedAt.toISOString()],
      ['Shipped', shippedAt.toISOString()],
      ['Delivered', null],
    ]);

    // Delivered today, the returns window is open and dated; a window that has run out closes it.
    await OrderModel.updateOne({ _id: order.id }, { $set: { status: 'delivered' }, $push: { events: { from: 'shipped', to: 'delivered', actor: 'admin', at: new Date() } } });
    const delivered = (await request(app).get(`/v1/orders/${order.id}`).set(authed(session))).body;
    expect(delivered.returns).toMatchObject({ eligible: true, until: expect.any(String) });
    expect(delivered.headline).toBe('Your order has been delivered.');

    await setCommerce({ returnWindowDays: 0 });
    expect((await request(app).get(`/v1/orders/${order.id}`).set(authed(session))).body.returns).toBeNull();
    await setCommerce({});
  });

  it('a cancelled order ends on the timeline rather than showing stops it will never make', async () => {
    const { session, addressId } = await shopper(3_000);
    const order = await buy(session, addressId, [{ itemId: 'shaker' }], 100);
    const cancelled = (await request(app).post(`/v1/orders/${order.id}/cancel`).set(authed(session))).body.order;

    expect(cancelled.headline).toBe('Your order was cancelled.');
    expect(cancelled.timeline.map((stop: { status: string; done: boolean }) => [stop.status, stop.done])).toEqual([
      ['placed', true], ['cancelled', true],
    ]);
    expect(cancelled.returns.eligible).toBe(false);
  });

  it('each tab of the list holds the states a member would look for there', async () => {
    const { session, addressId } = await shopper(5_000);
    const [a, b, c] = [
      await buy(session, addressId, [{ itemId: 'shaker' }], 100),
      await buy(session, addressId, [{ itemId: 'shaker' }], 100),
      await buy(session, addressId, [{ itemId: 'shaker' }], 100),
    ];
    await OrderModel.updateOne({ _id: b.id }, { $set: { status: 'shipped' } });
    await OrderModel.updateOne({ _id: c.id }, { $set: { status: 'delivered' } });

    const tab = async (status: string) =>
      (await request(app).get('/v1/orders').query({ status }).set(authed(session))).body.data.map((o: { id: string }) => o.id);

    expect(await tab('all')).toEqual([c.id, b.id, a.id]);
    expect(await tab('processing')).toEqual([a.id]);
    expect(await tab('shipped')).toEqual([b.id]);
    expect(await tab('delivered')).toEqual([c.id]);
    expect(await tab('cancelled')).toEqual([]);

    await request(app).post(`/v1/orders/${a.id}/cancel`).set(authed(session));
    expect(await tab('cancelled')).toEqual([a.id]);
    expect(await tab('processing')).toEqual([]);

    // A tab nobody ships is refused rather than quietly read as "all".
    expect((await request(app).get('/v1/orders').query({ status: 'returned' }).set(authed(session))).status).toBe(422);
  });

  it('moves an order to another address until it is packed, taking a fresh snapshot of it', async () => {
    const { session, addressId } = await shopper(3_000);
    const order = await buy(session, addressId, [{ itemId: 'shaker' }], 100);
    const second = await request(app).post('/v1/me/addresses').set(authed(session)).send({
      ...ADDRESS, label: 'Work', name: 'Asha V', line1: '88 Residency Road', line2: '', postalCode: '560025',
    });

    const moved = await request(app).post(`/v1/orders/${order.id}/address`).set(authed(session)).send({ addressId: second.body.id });
    expect(moved.status).toBe(200);
    expect(moved.body.address).toMatchObject({ label: 'Work', line1: '88 Residency Road', postalCode: '560025' });
    expect(moved.body.address).not.toHaveProperty('id');

    // The snapshot outlives the row it was copied from.
    await request(app).delete(`/v1/me/addresses/${second.body.id}`).set(authed(session));
    expect((await request(app).get(`/v1/orders/${order.id}`).set(authed(session))).body.address.line1).toBe('88 Residency Road');

    expect((await request(app).post(`/v1/orders/${order.id}/address`).set(authed(session)).send({ addressId: 'nope' })).status).toBe(404);

    await OrderModel.updateOne({ _id: order.id }, { $set: { status: 'confirmed' } });
    const late = await request(app).post(`/v1/orders/${order.id}/address`).set(authed(session)).send({ addressId: addressId });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ORDER_ADDRESS_LOCKED');
  });

  it('buys an order again into the basket, skipping what the catalogue no longer has', async () => {
    const { session, addressId } = await shopper(6_000);
    const order = await buy(session, addressId, [{ itemId: 'shaker' }, { itemId: 'cap' }], 100);

    const again = await request(app).post(`/v1/orders/${order.id}/reorder`).set(authed(session)).set('Idempotency-Key', 'again-1');
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ added: 2, skipped: [] });
    expect(again.body.cart.lines.map((l: { item: { id: string }; quantity: number }) => [l.item.id, l.quantity])).toEqual([
      ['shaker', 1], ['cap', 1],
    ]);

    // A line the catalogue has let go is skipped with its reason; the rest still go in.
    await request(app).delete('/v1/cart').set(authed(session));
    await ShopItemModel.updateOne({ _id: 'cap' }, { $set: { active: false } });
    const partial = await request(app).post(`/v1/orders/${order.id}/reorder`).set(authed(session)).set('Idempotency-Key', 'again-2');
    expect(partial.body.added).toBe(1);
    expect(partial.body.skipped).toEqual([{ title: 'VOKVE Cap', reason: 'One of the items is no longer available.' }]);
    expect(partial.body.cart.lines).toHaveLength(1);
    await ShopItemModel.updateOne({ _id: 'cap' }, { $set: { active: true } });
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

describe('commerce: how an order is paid (RULES R1, R11, D-59)', () => {
  it('coins only: every price is in coins, the delivery too, and the order takes exactly that many', async () => {
    await setCommerce({ paymentMode: 'coins' });
    const { session, addressId } = await shopper(5_000);

    expect((await request(app).get('/v1/shop/config').set(authed(session))).body).toMatchObject({ paymentMode: 'coins', coinShareMin: 1, coinShareMax: 1 });
    // ₹449 at ₹0.25 a coin.
    expect((await request(app).get('/v1/shop/items/cap').set(authed(session))).body).toMatchObject({ coinPrice: 1796, coinsMax: 1796, coinsMin: 1796 });

    // Under ₹999 of goods, so ₹49 to ship — 196 coins.
    const q = (await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }] })).body;
    expect(q).toMatchObject({
      paymentMode: 'coins', coinsMin: 1992, coinsMax: 1992, coinsApplied: 1992, coinsShort: 0, payable: 0,
      inCoins: { goods: 1796, discount: 0, shipping: 196, total: 1992 },
      lines: [{ itemId: 'cap', coinPrice: 1796, lineCoins: 1796 }],
    });

    const under = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 1_000 });
    expect(under.body.error).toMatchObject({ code: 'COINS_UNDER_MINIMUM', details: { coinsMin: 1992 } });
    const token = await stepUp(session);
    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 1992, stepUpToken: token });
    expect(placed.status).toBe(200);
    expect(placed.body.payment).toBeNull();
    expect(placed.body.order).toMatchObject({ status: 'placed', coinsUsed: 1992, payable: 0, inCoins: { total: 1992 } });
    expect(placed.body.balance).toBe(3_008);
  });

  it('coins only: a wallet short of the price is told by how much, and cannot order', async () => {
    await setCommerce({ paymentMode: 'coins' });
    const { session, addressId } = await shopper(1_000);
    const q = (await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }] })).body;
    expect(q).toMatchObject({ coinsMin: 1992, coinsMax: 1_000, coinsShort: 992, coinsApplied: 1992 });
    const refused = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 1992 });
    expect(refused.body.error).toMatchObject({ code: 'INSUFFICIENT_COINS', details: { required: 1992, balance: 1_000 } });
    expect(await OrderModel.countDocuments({ userId: session.userId })).toBe(0);
  });

  it('money only: coins cannot go towards anything', async () => {
    await setCommerce({ paymentMode: 'money' });
    const { session, addressId } = await shopper(2_000);
    expect((await request(app).get('/v1/shop/config').set(authed(session))).body).toMatchObject({ paymentMode: 'money', coinShareMin: 0, coinShareMax: 0 });
    expect((await request(app).get('/v1/shop/items/cap').set(authed(session))).body).toMatchObject({ coinsMax: 0, coinsMin: 0 });
    const q = (await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }] })).body;
    expect(q).toMatchObject({ paymentMode: 'money', coinsMax: 0, coinsApplied: 0, payable: 44900 + SHIPPING, inCoins: null });
    expect((await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 1 })).body.error.code)
      .toBe('COINS_OVER_LIMIT');
    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 0 });
    expect(placed.body.order).toMatchObject({ status: 'pending_payment', coinsUsed: 0, payable: 44900 + SHIPPING });
  });

  it('mixed with a fixed share: always 20% coins, no more and no fewer', async () => {
    await setCommerce({ paymentMode: 'mixed', coinShareMin: 0.2, coinShareMax: 0.2 });
    const { session, addressId } = await shopper(2_000);
    // 20% of ₹449 is ₹89.80: 359 whole coins, worth ₹89.75.
    expect((await request(app).get('/v1/shop/items/cap').set(authed(session))).body).toMatchObject({ coinsMin: 359, coinsMax: 359 });
    const q = (await request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], coins: 0 })).body;
    expect(q).toMatchObject({ coinsMin: 359, coinsMax: 359, coinsApplied: 359, payable: 44900 + SHIPPING - 359 * COIN });
    const send = (coins: number) => request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins });
    expect((await send(0)).body.error).toMatchObject({ code: 'COINS_UNDER_MINIMUM', details: { coinsMin: 359 } });
    expect((await send(400)).body.error.code).toBe('COINS_OVER_LIMIT');
    expect((await send(359)).body.order).toMatchObject({ coinsUsed: 359, payable: 44900 + SHIPPING - 359 * COIN });
  });

  it('an item carries its own way of being bought, and a basket of several kinds is quoted line by line (RULES R11)', async () => {
    const { session, addressId } = await shopper(5_000);
    const item = (id: string) => request(app).get(`/v1/shop/items/${id}`).set(authed(session));
    const quoteFor = (lines: { itemId: string; quantity: number }[]) =>
      request(app).post('/v1/checkout/quote').set(authed(session)).send({ lines });

    // Wrist wraps are a coins reward (₹349 → 1,396 coins), the foam roller
    // is money only (₹699), and the cap follows the shop — 30% in coins.
    expect((await item('wrist-wraps')).body).toMatchObject({ paymentMode: 'coins', coinPrice: 1396, coinsMin: 1396, coinsMax: 1396 });
    expect((await item('foam-roller')).body).toMatchObject({ paymentMode: 'money', coinsMin: 0, coinsMax: 0 });
    expect((await item('cap')).body).toMatchObject({ paymentMode: 'mixed', coinsMin: 0, coinsMax: 538 });

    // Coins alone: the delivery is in coins too, and coins is the only way to pay.
    const coinsOnly = (await quoteFor([{ itemId: 'wrist-wraps', quantity: 1 }])).body;
    expect(coinsOnly).toMatchObject({
      paymentMode: 'coins', coinsMin: 1592, coinsMax: 1592, payable: 0,
      inCoins: { goods: 1396, discount: 0, shipping: 196, total: 1592 },
      paymentMethods: ['coins'],
      lines: [{ itemId: 'wrist-wraps', paymentMode: 'coins' }],
    });

    // Money alone: no coins may go near it, so only the gateway is offered.
    const moneyOnly = (await quoteFor([{ itemId: 'foam-roller', quantity: 1 }])).body;
    expect(moneyOnly).toMatchObject({
      paymentMode: 'money', coinsMin: 0, coinsMax: 0, payable: 69900 + SHIPPING, inCoins: null,
      paymentMethods: ['upi', 'card', 'netbanking'],
    });

    // One of each: the wraps must take their 1,396 coins and the roller
    // none, so the order is part coins and part money — and nothing else.
    const both = (await quoteFor([{ itemId: 'wrist-wraps', quantity: 1 }, { itemId: 'foam-roller', quantity: 1 }])).body;
    expect(both).toMatchObject({
      paymentMode: 'mixed', coinsMin: 1396, coinsMax: 1396, shipping: 0,
      total: 34900 + 69900, payable: 34900 + 69900 - 1396 * COIN,
      inCoins: null, paymentMethods: ['coins_upi'],
    });

    // The shop's own share still rules the items that set no mode.
    expect((await quoteFor([{ itemId: 'cap', quantity: 1 }])).body).toMatchObject({
      coinsMin: 0, coinsMax: 538, paymentMethods: ['coins_upi', 'upi', 'card', 'netbanking'],
    });

    // And the coins order places for coins, with no gateway involved.
    const token = await stepUp(session);
    const placed = await request(app).post('/v1/checkout').set(authed(session))
      .send({ lines: [{ itemId: 'wrist-wraps', quantity: 1 }], addressId, coins: 1592, paymentMethod: 'coins', stepUpToken: token });
    expect(placed.status).toBe(200);
    expect(placed.body.payment).toBeNull();
    expect(placed.body.order).toMatchObject({ status: 'placed', coinsUsed: 1592, payable: 0, payment: { method: 'coins', status: 'not_required' } });
  });

  it('the payment page is offered only the methods the mode allows, and a method that does not match the order is refused (RULES R12)', async () => {
    const { session, addressId } = await shopper(5_000);
    const config = () => request(app).get('/v1/shop/config').set(authed(session));
    const place = (body: Record<string, unknown>) =>
      request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, ...body });

    // Mixed: all five, in the order the owner set them.
    expect((await config()).body.paymentMethods).toEqual(['coins', 'coins_upi', 'upi', 'card', 'netbanking']);

    // The cap takes 538 coins at most and leaves ₹363.50 — part coins, part money.
    expect((await place({ coins: 538, paymentMethod: 'coins' })).body.error).toMatchObject({
      code: 'PAYMENT_METHOD_MISMATCH', details: { method: 'coins', payable: 36350 },
    });
    // Coins are set, so a gateway-only method is not what this order is.
    expect((await place({ coins: 538, paymentMethod: 'upi' })).body.error.code).toBe('PAYMENT_METHOD_MISMATCH');
    // No coins, so there is nothing for "coins and then the rest" to do.
    expect((await place({ coins: 0, paymentMethod: 'coins_upi' })).body.error.code).toBe('PAYMENT_METHOD_MISMATCH');

    const split = await place({ coins: 538, paymentMethod: 'coins_upi' });
    expect(split.status).toBe(200);
    expect(split.body.order.payment).toMatchObject({ method: 'coins_upi', status: 'pending' });
    expect(split.body.payment).toMatchObject({ method: 'coins_upi', amount: 36350 });

    const card = await place({ coins: 0, paymentMethod: 'card' });
    expect(card.status).toBe(200);
    expect(card.body.order.payment).toMatchObject({ method: 'card', amount: 44900 + SHIPPING });

    // A method the owner has switched off is not on the menu at all.
    await setCommerce({ paymentMethods: ['coins', 'coins_upi', 'upi'] });
    expect((await place({ coins: 0, paymentMethod: 'card' })).body.error).toMatchObject({
      code: 'PAYMENT_METHOD_UNAVAILABLE', details: { method: 'card' },
    });
    await setCommerce({});

    // A money-only shop takes no coins, so the split is not what this order is.
    await setCommerce({ paymentMode: 'money' });
    expect((await config()).body.paymentMethods).toEqual(['upi', 'card', 'netbanking']);
    expect((await place({ coins: 0, paymentMethod: 'coins_upi' })).body.error).toMatchObject({
      code: 'PAYMENT_METHOD_MISMATCH', details: { method: 'coins_upi', coins: 0 },
    });

    // A coins-only shop offers nothing else, and the order needs no gateway at all.
    await setCommerce({ paymentMode: 'coins' });
    expect((await config()).body.paymentMethods).toEqual(['coins']);
    const token = await stepUp(session);
    const coinsOnly = await place({ coins: 1992, paymentMethod: 'coins', stepUpToken: token });
    expect(coinsOnly.status).toBe(200);
    expect(coinsOnly.body.payment).toBeNull();
    expect(coinsOnly.body.order.payment).toMatchObject({ method: 'coins', status: 'not_required' });

    // The owner may narrow the menu, but not to nothing.
    await setCommerce({ paymentMode: 'mixed', paymentMethods: ['upi'] });
    expect((await config()).body.paymentMethods).toEqual(['upi']);
    await setCommerce({ paymentMode: 'money', paymentMethods: ['coins'] });
    expect((await config()).status).toBe(500);
    await setCommerce({ paymentMethods: ['bitcoin'] });
    expect((await config()).status).toBe(500);
    await setCommerce({});
  });

  it('refuses a payment setup the till could not work with', async () => {
    const session = await signUpAndRegister();
    await setCommerce({ coinShareMin: 0.5, coinShareMax: 0.2 });
    expect((await request(app).get('/v1/shop/config').set(authed(session))).status).toBe(500);
    await setCommerce({ paymentMode: 'barter' });
    expect((await request(app).get('/v1/shop/config').set(authed(session))).status).toBe(500);
    await setCommerce({});
  });
});

describe('commerce: coupons (RULES R16)', () => {
  it('applies only a coupon that fits the basket, takes it off the goods, is spent by the order and given back on cancel', async () => {
    const { session, addressId } = await shopper(2_000);
    const apply = (code: string) => request(app).put('/v1/cart/coupon').set(authed(session)).send({ code });
    expect((await apply('welcome10')).body.error.code).toBe('CART_EMPTY');
    await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'resistance-bands', quantity: 1 });
    expect((await apply('NOPE')).body.error.code).toBe('COUPON_INVALID');
    // ₹649 of a ₹799 minimum.
    expect((await apply('fit50')).body.error).toMatchObject({ code: 'COUPON_MIN_ORDER', message: 'Add ₹150 more to use FIT50.', details: { minSubtotal: 79900 } });

    // 10% of ₹649; the coins share is of the goods after it, and shipping is still due under ₹999.
    const applied = await apply(' welcome10 ');
    expect(applied.status).toBe(200);
    expect(applied.body.quote).toMatchObject({
      subtotal: 64900, coupon: { code: 'WELCOME10', title: '10% off, up to ₹150', discount: 6490, problem: null },
      shipping: SHIPPING, total: 64900 - 6490 + SHIPPING, coinsMax: Math.floor(((64900 - 6490) * 0.3) / COIN),
    });

    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ fromCart: true, addressId, coins: 0, couponCode: 'WELCOME10' });
    expect(placed.status).toBe(200);
    expect(placed.body.order).toMatchObject({ coupon: { code: 'WELCOME10', discount: 6490 }, total: 64900 - 6490 + SHIPPING });
    expect((await request(app).get('/v1/cart').set(authed(session))).body.quote.coupon).toBeNull();
    expect((await CouponModel.findById('WELCOME10').lean())!.redemptions).toBe(1);

    // Once per member.
    await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'resistance-bands', quantity: 1 });
    expect((await apply('WELCOME10')).body.error.code).toBe('COUPON_ALREADY_USED');
    // Cancelling gives it back, to the pool and to the member.
    await request(app).post(`/v1/orders/${placed.body.order.id}/cancel`).set(authed(session));
    expect((await CouponModel.findById('WELCOME10').lean())!.redemptions).toBe(0);
    expect((await apply('WELCOME10')).status).toBe(200);
    expect((await request(app).delete('/v1/cart/coupon').set(authed(session))).body.quote.coupon).toBeNull();
  });

  it('keeps a coupon the basket stopped qualifying for, quoted with why; a checkout sent it anyway is refused', async () => {
    const { session, addressId } = await shopper(2_000);
    await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'yoga-mat', quantity: 1 });
    expect((await request(app).put('/v1/cart/coupon').set(authed(session)).send({ code: 'FIT50' })).status).toBe(200);
    await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'yoga-mat', quantity: 0 });
    const cart = await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'cap', quantity: 1 });
    expect(cart.body.quote.coupon).toMatchObject({ code: 'FIT50', discount: 0, problem: 'Add ₹350 more to use FIT50.' });
    expect(cart.body.quote.total).toBe(44900 + SHIPPING);

    // The app sends a coupon only when it showed it applying: sent anyway, it is refused rather than charged without.
    const refused = await request(app).post('/v1/checkout').set(authed(session)).send({ fromCart: true, addressId, coins: 0, couponCode: 'FIT50' });
    expect(refused.body.error.code).toBe('COUPON_MIN_ORDER');
    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ fromCart: true, addressId, coins: 0 });
    expect(placed.body.order).toMatchObject({ coupon: null, total: 44900 + SHIPPING });
  });

  it('two orders racing for a once-per-member coupon: exactly one gets it', async () => {
    const { session, addressId } = await shopper(2_000);
    const results = await Promise.all([1, 2].map(() =>
      request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'resistance-bands', quantity: 1 }], addressId, coins: 0, couponCode: 'WELCOME10' })));
    expect(results.map(r => r.status).sort()).toEqual([200, 422]);
    expect((await CouponUsageModel.findById(`WELCOME10:${session.userId}`).lean())!.count).toBe(1);
    expect((await CouponModel.findById('WELCOME10').lean())!.redemptions).toBe(1);
  });

  it('a limited coupon runs out for everyone, and a coins-only shop takes a coupon off in coins', async () => {
    await CouponModel.create({ _id: 'LAST1', title: '₹100 off', kind: 'flat', value: 10_000, maxRedemptions: 1 });
    const a = await shopper(2_000);
    const b = await shopper(2_000);
    for (const s of [a, b]) {
      await request(app).put('/v1/cart/lines').set(authed(s.session)).send({ itemId: 'cap', quantity: 1 });
      expect((await request(app).put('/v1/cart/coupon').set(authed(s.session)).send({ code: 'LAST1' })).status).toBe(200);
    }
    const checkoutAs = (s: typeof a) =>
      request(app).post('/v1/checkout').set(authed(s.session)).send({ fromCart: true, addressId: s.addressId, coins: 0, couponCode: 'LAST1' });
    expect((await checkoutAs(a)).status).toBe(200);
    expect((await checkoutAs(b)).body.error.code).toBe('COUPON_USED_UP');

    // In coins: ₹100 is 400 coins off.
    await setCommerce({ paymentMode: 'coins' });
    await CouponModel.create({ _id: 'COINS100', title: '₹100 off', kind: 'flat', value: 10_000 });
    const q = (await request(app).post('/v1/checkout/quote').set(authed(b.session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], couponCode: 'coins100' })).body;
    expect(q.inCoins).toEqual({ goods: 1796, discount: 400, shipping: 196, total: 1592 });
    expect(q).toMatchObject({ coinsMin: 1592, payable: 0, coupon: { code: 'COINS100', discount: 10_000 } });
  });
});

describe('commerce: delivery preferences (RULES R17)', () => {
  it('start with nothing asked for, keep what the member sets, and refuse an over-long note', async () => {
    const { session } = await shopper();
    const read = () => request(app).get('/v1/me/delivery-preferences').set(authed(session));
    const write = (body: object) => request(app).put('/v1/me/delivery-preferences').set(authed(session)).send(body);
    expect((await read()).body).toEqual({ instructions: '', whatsappUpdates: false, leaveAtDoor: false });
    expect((await write({ instructions: '  Leave at the gate  ', whatsappUpdates: true })).body)
      .toEqual({ instructions: 'Leave at the gate', whatsappUpdates: true, leaveAtDoor: false });
    expect((await read()).body).toEqual({ instructions: 'Leave at the gate', whatsappUpdates: true, leaveAtDoor: false });
    expect((await write({ instructions: 'x'.repeat(121) })).status).toBe(422);
    expect((await request(app).get('/v1/me/delivery-preferences')).status).toBe(401);

    // Turned off by the owner, WhatsApp is neither offered nor kept.
    await setCommerce({ whatsappUpdates: false });
    expect((await request(app).get('/v1/shop/config').set(authed(session))).body.offersWhatsAppUpdates).toBe(false);
    expect((await write({ whatsappUpdates: true })).body.whatsappUpdates).toBe(false);
    await setCommerce({});
  });

  it('are copied onto the order — what the checkout sent over the saved ones — and the order\'s news goes by WhatsApp when asked', async () => {
    const sent: { phone: string; text: string }[] = [];
    setWhatsAppTransport(async (phone, text) => { sent.push({ phone, text }); });
    try {
      const { session, addressId } = await shopper(2_000);
      await request(app).put('/v1/me/delivery-preferences').set(authed(session)).send({ instructions: 'Ring twice', leaveAtDoor: true });
      // Coins cover it, so it is placed at once and its news goes out now.
      await setCommerce({ coinShareMax: 1, shippingFeePaise: 0 });
      const order = (delivery?: object) => request(app).post('/v1/checkout').set(authed(session))
        .send({ lines: [{ itemId: 'shaker', quantity: 1 }], addressId, coins: 996, ...(delivery ? { delivery } : {}) });

      const placed = await order({ whatsappUpdates: true });
      expect(placed.status).toBe(200);
      expect(placed.body.order.delivery).toEqual({ instructions: 'Ring twice', whatsappUpdates: true, leaveAtDoor: true });
      // Asked for and deliverable, so the confirmation screen may promise it.
      expect(placed.body.order.trackingChannels).toEqual(['email', 'whatsapp']);
      const phone = (await UserModel.findById(session.userId).lean())!.phone;
      expect(sent).toEqual([{ phone, text: expect.stringContaining('Order placed') }]);
      await request(app).post(`/v1/orders/${placed.body.order.id}/cancel`).set(authed(session));
      expect(sent[1].text).toContain('Order cancelled');

      // An order that did not ask takes the saved preferences, which did not either.
      const quiet = await order();
      expect(quiet.body.order.delivery).toEqual({ instructions: 'Ring twice', whatsappUpdates: false, leaveAtDoor: true });
      expect(sent).toHaveLength(2);
      expect((await order({ instructions: 'y'.repeat(121) })).status).toBe(422);
    } finally {
      setWhatsAppTransport(null);
      await setCommerce({});
    }
  });
});
