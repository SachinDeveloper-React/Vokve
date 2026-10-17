import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { OrderModel, ShopInventoryModel, ShopItemModel } from '../src/modules/commerce/models.js';
import { CoinBalanceModel } from '../src/modules/economy/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

/** A money order, paid: the ordinary case. */
async function moneyOrder(userId: string, id: string, overrides: Record<string, unknown> = {}) {
  return OrderModel.create({
    _id: id, number: `VKV${id}`, userId, status: 'placed',
    subtotal: 120_000, total: 120_000, payable: 90_000, coinsUsed: 300, coinsValue: 30_000,
    items: [{ itemId: 'cap', title: 'VOKVE Cap', quantity: 1, price: 120_000, coinsUsed: 300, coinsValue: 30_000, moneyPaid: 90_000 }],
    // The whole snapshot: an order serialises against `addressSchema`,
    // which wants the label and the country as well (RULES R4).
    addressSnapshot: { id: 'adr_1', label: 'Home', name: 'Asha', phone: '+919876543210', line1: '12 MG Road', line2: '', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', country: 'IN', isDefault: true },
    payment: { provider: 'mock', method: 'coins_upi', status: 'paid', amount: 90_000, providerPaymentId: 'pay_1', paidAt: new Date() },
    events: [{ from: null, to: 'placed', actor: 'user', at: new Date() }],
    ...overrides,
  });
}

/** And one bought entirely with coins, as the till records it. */
async function coinsOrder(userId: string, id: string) {
  return OrderModel.create({
    _id: id, number: `VKV${id}`, userId, status: 'placed',
    subtotal: 50_000, total: 50_000, payable: 0, coinsUsed: 500, coinsValue: 50_000,
    inCoins: { goods: 500, discount: 0, shipping: 0, total: 500 },
    items: [{ itemId: 'band', title: 'Resistance Band', quantity: 1, price: 50_000, coinPrice: 500, coinsUsed: 500, coinsValue: 50_000, moneyPaid: 0 }],
    addressSnapshot: { id: 'adr_1', label: 'Home', name: 'Asha', phone: '+919876543210', line1: '12 MG Road', line2: '', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', country: 'IN', isDefault: true },
    payment: { provider: null, method: 'coins', status: 'not_required', amount: 0 },
    events: [{ from: null, to: 'placed', actor: 'user', at: new Date() }],
  });
}

describe('admin: the order book', () => {
  it('answers the admin key alone', async () => {
    expect((await request(app).get('/v1/admin/orders')).status).toBe(401);
  });

  it('lists every order, filtered by status and by how it was paid for', async () => {
    const session = await signUpAndRegister();
    await moneyOrder(session.userId, 'ord_money');
    await coinsOrder(session.userId, 'ord_coins');
    await moneyOrder(session.userId, 'ord_done', { status: 'delivered' });

    const all = await request(app).get('/v1/admin/orders').set(ADMIN);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);
    expect(all.body.byStatus).toEqual(
      expect.arrayContaining([{ status: 'placed', orders: 2 }, { status: 'delivered', orders: 1 }]),
    );
    expect(all.body.data[0].member).toMatchObject({ id: session.userId, email: session.email });

    // A coins order has no money side: that is the filter, and the row says so.
    const coins = await request(app).get('/v1/admin/orders').query({ paidWith: 'coins' }).set(ADMIN);
    expect(coins.body.total).toBe(1);
    expect(coins.body.data[0]).toMatchObject({ id: 'ord_coins', payable: 0, coinsUsed: 500 });
    expect(coins.body.data[0].inCoins).toMatchObject({ total: 500 });

    const mixed = await request(app).get('/v1/admin/orders').query({ paidWith: 'mixed' }).set(ADMIN);
    expect(mixed.body.total).toBe(2);

    const delivered = await request(app).get('/v1/admin/orders').query({ status: 'delivered' }).set(ADMIN);
    expect(delivered.body.total).toBe(1);

    const page = await request(app).get('/v1/admin/orders').query({ limit: 1, offset: 2 }).set(ADMIN);
    expect(page.body).toMatchObject({ total: 3, offset: 2, limit: 1 });
    expect(page.body.data).toHaveLength(1);

    const found = await request(app).get('/v1/admin/orders').query({ q: 'VKVord_coins' }).set(ADMIN);
    expect(found.body.total).toBe(1);
  });

  it('says how one order was paid for, so nobody shows rupees for a coins order', async () => {
    const session = await signUpAndRegister();
    await coinsOrder(session.userId, 'ord_coins');
    await moneyOrder(session.userId, 'ord_mixed');

    const coins = await request(app).get('/v1/admin/orders/ord_coins').set(ADMIN);
    expect(coins.body.paidWith).toBe('coins');
    expect(coins.body.inCoins).toMatchObject({ goods: 500, total: 500 });
    expect(coins.body.money).toMatchObject({ payable: 0, coinsUsed: 500 });

    const mixed = await request(app).get('/v1/admin/orders/ord_mixed').set(ADMIN);
    expect(mixed.body.paidWith).toBe('mixed');
    expect(mixed.body.inCoins).toBeNull();

    const list = await request(app).get(`/v1/admin/users/${session.userId}/orders`).set(ADMIN);
    expect(list.body.data.map((row: { id: string; paidWith: string }) => [row.id, row.paidWith])).toEqual(
      expect.arrayContaining([['ord_coins', 'coins'], ['ord_mixed', 'mixed']]),
    );
  });
});

describe('admin: moving an order along', () => {
  it('goes forwards, records who moved it, and tells the member', async () => {
    const session = await signUpAndRegister();
    await moneyOrder(session.userId, 'ord_a');

    const confirmed = await request(app)
      .put('/v1/admin/orders/ord_a/status')
      .set(ADMIN)
      .send({ status: 'confirmed', note: 'packed' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ status: 'confirmed', moved: true });

    const shipped = await request(app)
      .put('/v1/admin/orders/ord_a/status')
      .set(ADMIN)
      .send({ status: 'shipped', trackingRef: 'BLR123' });
    expect(shipped.body).toMatchObject({ status: 'shipped', trackingRef: 'BLR123' });

    const feed = await request(app).get('/v1/notifications').set(authed(session));
    expect(feed.body.data[0]).toMatchObject({ title: 'Your order is on its way' });
    expect(feed.body.data[0].message).toContain('BLR123');

    const detail = await request(app).get('/v1/admin/orders/ord_a').set(ADMIN);
    expect(detail.body.events.map((event: { to: string; actor: string }) => [event.to, event.actor])).toEqual([
      ['placed', 'user'],
      ['confirmed', 'admin'],
      ['shipped', 'admin'],
    ]);
  });

  it('refuses to go backwards, or out of a finished state', async () => {
    const session = await signUpAndRegister();
    await moneyOrder(session.userId, 'ord_b', { status: 'shipped' });

    const back = await request(app).put('/v1/admin/orders/ord_b/status').set(ADMIN).send({ status: 'placed' });
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe('ORDER_STATUS_NOT_ALLOWED');

    await request(app).put('/v1/admin/orders/ord_b/status').set(ADMIN).send({ status: 'delivered' });
    const after = await request(app).put('/v1/admin/orders/ord_b/status').set(ADMIN).send({ status: 'shipped' });
    expect(after.status).toBe(409);
  });

  it('sends a cancel to the cancel verb, which has coins and stock to give back', async () => {
    const session = await signUpAndRegister();
    await moneyOrder(session.userId, 'ord_c');
    const res = await request(app).put('/v1/admin/orders/ord_c/status').set(ADMIN).send({ status: 'cancelled' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USE_CANCEL');
  });

  it('a step the order is already on is not an error', async () => {
    const session = await signUpAndRegister();
    await moneyOrder(session.userId, 'ord_d');
    const res = await request(app)
      .put('/v1/admin/orders/ord_d/status')
      .set(ADMIN)
      .send({ status: 'placed', trackingRef: 'LATE1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ moved: false, trackingRef: 'LATE1' });
  });
});

describe('admin: undoing an order', () => {
  it('cancels through the same path the member’s own cancel takes', async () => {
    const session = await signUpAndRegister();
    await ShopInventoryModel.updateOne({ _id: 'cap' }, { $set: { onHand: 4 } }, { upsert: true });
    await moneyOrder(session.userId, 'ord_e');

    const res = await request(app).post('/v1/admin/orders/ord_e/cancel').set(ADMIN).send({ reason: 'wrong size' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', coinsReturned: 300, already: false });
    // The coins are back, the stock is back, and the payment was refunded.
    expect(res.body.balance).toBe(300);
    expect((await ShopInventoryModel.findById('cap').lean())?.onHand).toBe(5);
    expect(res.body.payment).toBe('refunded');

    const again = await request(app).post('/v1/admin/orders/ord_e/cancel').set(ADMIN).send({ reason: 'again' });
    expect(again.body.already).toBe(true);
    expect((await CoinBalanceModel.findById(session.userId).lean())?.balanceMc).toBe(300_000);

    const feed = await request(app).get('/v1/notifications').set(authed(session));
    expect(feed.body.data[0].title).toBe('Order cancelled');
  });

  it('refunds a delivered order without pretending the stock came back', async () => {
    const session = await signUpAndRegister();
    await ShopInventoryModel.updateOne({ _id: 'cap' }, { $set: { onHand: 4 } }, { upsert: true });
    await moneyOrder(session.userId, 'ord_f', { status: 'delivered' });

    const res = await request(app)
      .post('/v1/admin/orders/ord_f/refund')
      .set(ADMIN)
      .send({ reason: 'arrived broken' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'refunded', coinsReturned: 300, balance: 300, money: 'refunded' });
    // The stock is untouched: the thing is in somebody's house.
    expect((await ShopInventoryModel.findById('cap').lean())?.onHand).toBe(4);

    const detail = await request(app).get('/v1/admin/orders/ord_f').set(ADMIN);
    expect(detail.body.status).toBe('refunded');
    expect(detail.body.payment.status).toBe('refunded');
    expect(detail.body.ledger.refunded).not.toBeNull();

    const twice = await request(app).post('/v1/admin/orders/ord_f/refund').set(ADMIN).send({ reason: 'again' });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('ALREADY_REFUNDED');
  });

  it('refuses a refund of more than was taken, and of an order nothing was taken for', async () => {
    const session = await signUpAndRegister();
    await moneyOrder(session.userId, 'ord_g', { status: 'delivered' });
    const tooMuch = await request(app)
      .post('/v1/admin/orders/ord_g/refund')
      .set(ADMIN)
      .send({ reason: 'oops', amount: 200_000 });
    expect(tooMuch.status).toBe(422);

    await moneyOrder(session.userId, 'ord_h', {
      status: 'delivered', coinsUsed: 0, payable: 0,
      payment: { provider: null, method: null, status: 'not_required', amount: 0 },
    });
    const nothing = await request(app).post('/v1/admin/orders/ord_h/refund').set(ADMIN).send({ reason: 'nothing' });
    expect(nothing.status).toBe(409);
    expect(nothing.body.error.code).toBe('NOTHING_TO_REFUND');
  });

  it('corrects the address on the order’s own snapshot, until the parcel has gone', async () => {
    const session = await signUpAndRegister();
    await moneyOrder(session.userId, 'ord_i');

    const fixed = await request(app)
      .put('/v1/admin/orders/ord_i/address')
      .set(ADMIN)
      .send({ line1: '14 MG Road, Flat 3', phone: '+919999999999', reason: 'member read it out wrong' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.address).toMatchObject({ line1: '14 MG Road, Flat 3', city: 'Bengaluru', name: 'Asha' });

    const feed = await request(app).get('/v1/notifications').set(authed(session));
    expect(feed.body.data[0].title).toBe('Delivery address updated');

    await request(app).put('/v1/admin/orders/ord_i/status').set(ADMIN).send({ status: 'shipped' });
    const late = await request(app)
      .put('/v1/admin/orders/ord_i/address')
      .set(ADMIN)
      .send({ city: 'Mysore', reason: 'too late' });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ADDRESS_NOT_CHANGEABLE');
  });
});

describe('admin: the shelf', () => {
  const item = {
    id: 'coin-tee',
    title: 'Coins-only Tee',
    description: 'A reward, not a product.',
    price: 99_900,
    category: 'clothing',
    paymentMode: 'coins',
    sizes: ['S', 'M'],
    onHand: 12,
    note: 'listed for the step reward launch',
  };

  it('creates, reads, patches, retires and restores — never deletes', async () => {
    const created = await request(app).post('/v1/admin/shop/items').set(ADMIN).send(item);
    expect(created.status).toBe(201);
    expect(created.body.created).toBe(true);
    expect(created.body.item).toMatchObject({
      id: 'coin-tee', title: 'Coins-only Tee', price: 99_900, paymentMode: 'coins', effectivePaymentMode: 'coins',
    });
    // What it costs when coins pay all of it, rounded up as the till does.
    expect(created.body.item.coinPrice).toBeGreaterThan(0);
    expect(created.body.item.stock).toMatchObject({ onHand: 12, out: false });

    const again = await request(app).post('/v1/admin/shop/items').set(ADMIN).send({ ...item, title: 'Coins-only Tee v2' });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.item.title).toBe('Coins-only Tee v2');

    const patched = await request(app)
      .put('/v1/admin/shop/items/coin-tee')
      .set(ADMIN)
      .send({ price: 79_900, badge: 'limited', onHand: 3, note: 'sale' });
    expect(patched.status).toBe(200);
    expect(patched.body.item).toMatchObject({ price: 79_900, badge: 'limited' });
    expect(patched.body.item.stock).toMatchObject({ onHand: 3, low: true });

    const retired = await request(app).delete('/v1/admin/shop/items/coin-tee').set(ADMIN).send({ note: 'out of season' });
    expect(retired.body.item.active).toBe(false);
    // Off the member's shelf, still on the operator's.
    const shopper = await signUpAndRegister();
    const shelf = await request(app).get('/v1/shop/items').query({ q: 'Coins-only' }).set(authed(shopper));
    expect(shelf.body.data.find((row: { id: string }) => row.id === 'coin-tee')).toBeUndefined();
    expect((await ShopItemModel.findById('coin-tee').lean())).not.toBeNull();

    const restored = await request(app).delete('/v1/admin/shop/items/coin-tee').set(ADMIN).send({ active: true });
    expect(restored.body.item.active).toBe(true);
  });

  it('filters by payment mode, state and category, and pages', async () => {
    await request(app).post('/v1/admin/shop/items').set(ADMIN).send(item);
    await request(app)
      .post('/v1/admin/shop/items')
      .set(ADMIN)
      .send({ id: 'money-belt', title: 'Money Belt', price: 49_900, category: 'accessories', paymentMode: 'money', onHand: 0 });

    const coinsOnly = await request(app).get('/v1/admin/shop/items').query({ paymentMode: 'coins' }).set(ADMIN);
    expect(coinsOnly.body.data.map((row: { id: string }) => row.id)).toEqual(['coin-tee']);

    // An item with no mode of its own follows the shop's, and says which.
    const shopDefault = await request(app).get('/v1/admin/shop/items').query({ paymentMode: 'shop', limit: 1 }).set(ADMIN);
    expect(shopDefault.body.shop.paymentMode).toBe('mixed');
    if (shopDefault.body.data.length > 0) {
      expect(shopDefault.body.data[0]).toMatchObject({ paymentMode: null, effectivePaymentMode: 'mixed' });
    }

    const outOfStock = await request(app).get('/v1/admin/shop/items').query({ state: 'out_of_stock', limit: 100 }).set(ADMIN);
    expect(outOfStock.body.data.some((row: { id: string }) => row.id === 'money-belt')).toBe(true);

    const accessories = await request(app).get('/v1/admin/shop/items').query({ category: 'accessories' }).set(ADMIN);
    expect(accessories.body.data.every((row: { category: string }) => row.category === 'accessories')).toBe(true);
    expect(accessories.body.total).toBeGreaterThan(0);
  });

  it('can list something straight into the retired state', async () => {
    // `active` once sat in both `$set` and `$setOnInsert`, which Mongo
    // refuses: creating a retired item was a 500.
    const res = await request(app)
      .post('/v1/admin/shop/items')
      .set(ADMIN)
      .send({ id: 'old-shaker', title: 'Old Shaker', price: 19_900, category: 'gym', active: false, onHand: 0 });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ active: false, title: 'Old Shaker' });
    expect(res.body.item.stock).toMatchObject({ onHand: 0, out: true });
  });

  it('refuses a slug that is not one, and 404s for an item that is not there', async () => {
    const bad = await request(app).post('/v1/admin/shop/items').set(ADMIN).send({ ...item, id: 'Not A Slug' });
    expect(bad.status).toBe(422);
    expect((await request(app).get('/v1/admin/shop/items/nothing-here').set(ADMIN)).status).toBe(404);
    expect((await request(app).put('/v1/admin/shop/items/nothing-here').set(ADMIN).send({ price: 1 })).status).toBe(404);
  });

  it('sets stock, and says when it is low', async () => {
    await request(app).post('/v1/admin/shop/items').set(ADMIN).send(item);
    const res = await request(app)
      .put('/v1/admin/shop/items/coin-tee/stock')
      .set(ADMIN)
      .send({ onHand: 2, lowStockAt: 5, reason: 'count after the fair' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ onHand: 2, lowStockAt: 5 });
  });
});

describe('admin: a badge by hand', () => {
  it('grants one, through the same path the rules use, and only once', async () => {
    const session = await signUpAndRegister();
    const shelf = await request(app).get(`/v1/admin/users/${session.userId}/achievements`).set(ADMIN);
    const badge = shelf.body.badges[0];

    const granted = await request(app)
      .post(`/v1/admin/users/${session.userId}/achievements`)
      .set(ADMIN)
      .send({ achievementId: badge.id, reason: 'goodwill after the outage' });
    expect(granted.status).toBe(201);
    expect(granted.body).toMatchObject({ achievementId: badge.id, granted: true, already: false });
    expect(granted.body.via).toContain('admin');
    // Badge coins wait on their own switch, and the answer says so.
    expect(granted.body.paid).toBe(false);

    const feed = await request(app).get('/v1/notifications').set(authed(session));
    expect(feed.body.data[0].title).toContain('New badge');

    const twice = await request(app)
      .post(`/v1/admin/users/${session.userId}/achievements`)
      .set(ADMIN)
      .send({ achievementId: badge.id, reason: 'again' });
    expect(twice.body).toMatchObject({ granted: false, already: true });
    expect(await NotificationModel.countDocuments({ userId: session.userId })).toBe(1);

    const after = await request(app).get(`/v1/admin/users/${session.userId}/achievements`).set(ADMIN);
    expect(after.body.summary.unlocked).toBe(1);
  });

  it('404s for a badge or a member that does not exist', async () => {
    const session = await signUpAndRegister();
    expect(
      (await request(app).post(`/v1/admin/users/${session.userId}/achievements`).set(ADMIN).send({ achievementId: 'nope', reason: 'test' })).status,
    ).toBe(404);
    expect(
      (await request(app).post('/v1/admin/users/usr_nobody/achievements').set(ADMIN).send({ achievementId: 'x', reason: 'test' })).status,
    ).toBe(404);
  });
});

describe('admin: telling more than one member', () => {
  async function members(count: number): Promise<Session[]> {
    const out: Session[] = [];
    for (let index = 0; index < count; index += 1) out.push(await signUpAndRegister());
    return out;
  }

  it('counts the segment before anything is sent', async () => {
    await members(3);
    const all = await request(app).get('/v1/admin/notifications/preview').set(ADMIN);
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ matched: 3, overflow: false });

    const android = await request(app).get('/v1/admin/notifications/preview').query({ platform: 'android' }).set(ADMIN);
    expect(android.body.matched).toBe(3);
    const ios = await request(app).get('/v1/admin/notifications/preview').query({ platform: 'ios' }).set(ADMIN);
    expect(ios.body.matched).toBe(0);
    const quiet = await request(app).get('/v1/admin/notifications/preview').query({ notSeenForDays: 30 }).set(ADMIN);
    expect(quiet.body.matched).toBe(0);
    expect(await NotificationModel.countDocuments({})).toBe(0);
  });

  it('sends to the segment, and every member gets the row', async () => {
    const people = await members(3);
    const res = await request(app)
      .post('/v1/admin/notifications/broadcast')
      .set(ADMIN)
      .send({
        topic: 'system',
        title: 'Scheduled maintenance',
        message: 'Vokve will be briefly unavailable tonight at 2am.',
        expected: 3,
        confirm: true,
        reason: 'planned downtime',
      });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ recipients: 3, created: 3, duplicate: 0 });

    for (const person of people) {
      const feed = await request(app).get('/v1/notifications').set(authed(person));
      expect(feed.body.data[0]).toMatchObject({ title: 'Scheduled maintenance', topic: 'system' });
    }
  });

  it('refuses without the confirmation, and when the count does not match', async () => {
    await members(2);
    const unconfirmed = await request(app)
      .post('/v1/admin/notifications/broadcast')
      .set(ADMIN)
      .send({ topic: 'system', title: 'Hello', message: 'Hi', expected: 2, reason: 'test' });
    expect(unconfirmed.status).toBe(422);

    const stale = await request(app)
      .post('/v1/admin/notifications/broadcast')
      .set(ADMIN)
      .send({ topic: 'system', title: 'Hello', message: 'Hi', expected: 900, confirm: true, reason: 'test' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('SEGMENT_MOVED');
    expect(await NotificationModel.countDocuments({})).toBe(0);
  });

  it('honours the category switch: the row is written, the push is not', async () => {
    const person = await signUpAndRegister();
    await request(app).put(`/v1/admin/users/${person.userId}/config`).set(ADMIN).send({ silence: ['announcements'] });

    const res = await request(app)
      .post('/v1/admin/notifications/broadcast')
      .set(ADMIN)
      .send({ topic: 'system', title: 'Notice', message: 'Something to read.', expected: 1, confirm: true, reason: 'test' });
    expect(res.body).toMatchObject({ recipients: 1, created: 1 });
    // Nothing was pushed to them — `system` asks the announcements switch.
    expect(res.body.pushed).toBe(0);
    const feed = await request(app).get('/v1/notifications').set(authed(person));
    expect(feed.body.data[0].title).toBe('Notice');
  });
});
