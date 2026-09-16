import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { invalidateConfig } from '../src/config/remote.js';
import { OrderModel, ShopInventoryModel } from '../src/modules/commerce/models.js';
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

/** A user who can redeem: both contacts proven, coins in the wallet, an address on file. */
async function shopper(coins = 2_000): Promise<{ session: Session; addressId: string }> {
  const session = await signUpAndRegister();
  await UserModel.updateOne({ _id: session.userId }, { $set: { phoneVerifiedAt: new Date(), emailVerifiedAt: new Date() } });
  // Referral is exempt from nothing but has a 300 cap; use a cap-exempt refund row to fund the wallet cleanly.
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

describe('commerce: catalogue and addresses', () => {
  it('serves the seeded catalogue with stock joined in, and filters by category and deals', async () => {
    const session = await signUpAndRegister();
    const all = await request(app).get('/v1/shop/items').set(authed(session));
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeGreaterThanOrEqual(12);
    expect(all.body.data[0]).toMatchObject({ id: 'tee', priceCoins: 1200, inStock: true, badge: 'bestseller' });

    const apparel = await request(app).get('/v1/shop/items').query({ category: 'apparel' }).set(authed(session));
    expect(apparel.body.data.every((i: { category: string }) => i.category === 'apparel')).toBe(true);
    const deals = await request(app).get('/v1/shop/items').query({ deals: 'true' }).set(authed(session));
    expect(deals.body.data.every((i: { isDeal: boolean }) => i.isDeal)).toBe(true);

    await ShopInventoryModel.updateOne({ _id: 'cap' }, { $set: { onHand: 0 } });
    const cap = await request(app).get('/v1/shop/items/cap').set(authed(session));
    expect(cap.body.inStock).toBe(false);
    expect((await request(app).get('/v1/shop/items/nope').set(authed(session))).status).toBe(404);
  });

  it('keeps exactly one default address, and a deleted default hands over to the newest survivor', async () => {
    const session = await signUpAndRegister();
    const first = await request(app).post('/v1/me/addresses').set(authed(session)).send(ADDRESS);
    expect(first.body.isDefault).toBe(true); // the only entry is the default whatever the body said

    const second = await request(app).post('/v1/me/addresses').set(authed(session)).send({ ...ADDRESS, label: 'Office', isDefault: true });
    expect(second.body.isDefault).toBe(true);
    let list = await request(app).get('/v1/me/addresses').set(authed(session));
    expect(list.body.data.map((a: { label: string; isDefault: boolean }) => [a.label, a.isDefault])).toEqual([['Office', true], ['Home', false]]);

    // The default cannot be switched off in place, only moved.
    const unset = await request(app).put(`/v1/me/addresses/${second.body.id}`).set(authed(session)).send({ isDefault: false, line2: '' });
    expect(unset.body.isDefault).toBe(true);
    const moved = await request(app).post(`/v1/me/addresses/${first.body.id}/default`).set(authed(session));
    expect(moved.body.isDefault).toBe(true);

    await request(app).delete(`/v1/me/addresses/${first.body.id}`).set(authed(session));
    list = await request(app).get('/v1/me/addresses').set(authed(session));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ label: 'Office', isDefault: true });

    const bad = await request(app).post('/v1/me/addresses').set(authed(session)).send({ ...ADDRESS, postalCode: '1' });
    expect(bad.status).toBe(422);
  });
});

describe('commerce: redeem (RULES R2–R6, O8, T5)', () => {
  it('refuses until both contacts are verified, then until there is an address', async () => {
    const session = await signUpAndRegister();
    const unverified = await request(app).post('/v1/shop/redeem').set(authed(session)).send({ itemId: 'cap', addressId: 'adr_none' });
    expect(unverified.status).toBe(403);
    expect(unverified.body.error.code).toBe('PHONE_NOT_VERIFIED');

    await UserModel.updateOne({ _id: session.userId }, { $set: { phoneVerifiedAt: new Date(), emailVerifiedAt: new Date() } });
    const noAddress = await request(app).post('/v1/shop/redeem').set(authed(session)).send({ itemId: 'cap', addressId: 'adr_none' });
    expect(noAddress.status).toBe(422);
    expect(noAddress.body.error.code).toBe('ADDRESS_REQUIRED');
  });

  it('places an order in one transaction: coins out, stock down, ledger row, address snapshot, feed row', async () => {
    const { session, addressId } = await shopper(2_000);
    const before = (await ShopInventoryModel.findById('cap').lean())!.onHand;

    const placed = await request(app).post('/v1/shop/redeem').set({ ...authed(session), 'idempotency-key': 'r1' }).send({ itemId: 'cap', addressId });
    expect(placed.status).toBe(200);
    expect(placed.body.balance).toBe(1_350);
    expect(placed.body.order).toMatchObject({
      status: 'placed', totalCoins: 650, cancellable: true, trackingRef: null,
      items: [{ itemId: 'cap', title: 'VOKVE Cap', quantity: 1, priceCoins: 650 }],
      address: { name: 'Asha Verma', city: 'Bengaluru', postalCode: '560001' },
    });
    expect((await ShopInventoryModel.findById('cap').lean())!.onHand).toBe(before - 1);

    const ledger = await request(app).get('/v1/wallet/transactions').set(authed(session));
    expect(ledger.body.data[0]).toMatchObject({ source: 'purchase', amount: -650, title: 'VOKVE Cap' });
    const wallet = await request(app).get('/v1/wallet').set(authed(session));
    expect(wallet.body.balance).toBe(1_350);

    // The same key replays the same order rather than placing a second (BACKEND §3.6).
    const replay = await request(app).post('/v1/shop/redeem').set({ ...authed(session), 'idempotency-key': 'r1' }).send({ itemId: 'cap', addressId });
    expect(replay.status).toBe(200);
    expect(replay.body.order.id).toBe(placed.body.order.id);
    expect(await OrderModel.countDocuments({ userId: session.userId })).toBe(1);

    // The address moved on; the order keeps what it was shipped to.
    await request(app).put(`/v1/me/addresses/${addressId}`).set(authed(session)).send({ city: 'Mumbai' });
    const order = await request(app).get(`/v1/orders/${placed.body.order.id}`).set(authed(session));
    expect(order.body.address.city).toBe('Bengaluru');

    const feed = await request(app).get('/v1/notifications').set(authed(session));
    expect(feed.body.data[0]).toMatchObject({ title: 'Order placed', topic: 'reward' });
    expect((await request(app).get('/v1/orders/count').set(authed(session))).body).toEqual({ count: 1 });
  });

  it('a short wallet is told how much is missing, and nothing moves', async () => {
    const { session, addressId } = await shopper(500);
    const short = await request(app).post('/v1/shop/redeem').set(authed(session)).send({ itemId: 'cap', addressId });
    expect(short.status).toBe(422);
    expect(short.body.error).toMatchObject({ code: 'INSUFFICIENT_COINS', details: { required: 650, balance: 500 } });
    expect(await OrderModel.countDocuments({ userId: session.userId })).toBe(0);
    expect((await request(app).get('/v1/wallet').set(authed(session))).body.balance).toBe(500);
    expect(await CoinLedgerModel.countDocuments({ userId: session.userId, source: 'purchase' })).toBe(0);
  });

  it('the last unit goes to exactly one of many concurrent buyers, and the rest keep their coins', async () => {
    // Shoppers first: each sign-up re-seeds, and the seed only *creates* stock.
    const buyers = await Promise.all(Array.from({ length: 6 }, () => shopper(1_000)));
    await ShopInventoryModel.updateOne({ _id: 'cap' }, { $set: { onHand: 1 } });
    const results = await Promise.all(buyers.map(({ session, addressId }) =>
      request(app).post('/v1/shop/redeem').set(authed(session)).send({ itemId: 'cap', addressId }),
    ));
    const won = results.filter(r => r.status === 200);
    const soldOut = results.filter(r => r.status === 409);
    expect(won).toHaveLength(1);
    expect(soldOut).toHaveLength(5);
    expect(soldOut[0].body.error.code).toBe('OUT_OF_STOCK');
    expect((await ShopInventoryModel.findById('cap').lean())!.onHand).toBe(0);
    for (const { session } of buyers) {
      const wallet = await request(app).get('/v1/wallet').set(authed(session));
      const mine = results.find(r => r.status === 200 && r.body.order && r.body.balance === 350);
      expect([350, 1_000]).toContain(wallet.body.balance);
      if (wallet.body.balance === 350) expect(mine).toBeDefined();
    }
  });

  it('a price at or above the threshold needs a step-up, which is single-use and belongs to its user', async () => {
    const { session, addressId } = await shopper(3_000);

    const noToken = await request(app).post('/v1/shop/redeem').set(authed(session)).send({ itemId: 'tee', addressId });
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('STEP_UP_REQUIRED');

    const garbage = await request(app).post('/v1/shop/redeem').set(authed(session)).send({ itemId: 'tee', addressId, stepUpToken: 'nope' });
    expect(garbage.body.error.code).toBe('STEP_UP_INVALID');

    const token = await stepUp(session);
    const placed = await request(app).post('/v1/shop/redeem').set(authed(session)).send({ itemId: 'tee', addressId, stepUpToken: token });
    expect(placed.status).toBe(200);
    expect(placed.body.balance).toBe(1_800);

    // Spent: the same token cannot buy a second time.
    const reused = await request(app).post('/v1/shop/redeem').set(authed(session)).send({ itemId: 'tee', addressId, stepUpToken: token });
    expect(reused.status).toBe(403);
    expect(reused.body.error.code).toBe('STEP_UP_INVALID');

    // Another user's token is worthless here.
    const other = await shopper(3_000);
    const theirs = await stepUp(other.session);
    const stolen = await request(app).post('/v1/shop/redeem').set(authed(session)).send({ itemId: 'tee', addressId, stepUpToken: theirs });
    expect(stolen.body.error.code).toBe('STEP_UP_INVALID');

    // Under the threshold, no token is asked for.
    const cheap = await request(app).post('/v1/shop/redeem').set(authed(session)).send({ itemId: 'gym-towel', addressId });
    expect(cheap.status).toBe(200);
  });

  it('a watch-tier user must step up for anything once trust is enforced; restricted cannot redeem at all', async () => {
    await AppConfigModel.updateOne({ _id: 'trust' }, { $set: { value: { shadow: false } } }, { upsert: true });
    invalidateConfig();
    const { session, addressId } = await shopper(1_000);

    await UserModel.updateOne({ _id: session.userId }, { $set: { 'trust.tier': 'watch' } });
    // The tier rides in the access token, so a fresh one is needed after the change.
    const refreshed = await request(app).post('/v1/auth/refresh').set(authed(session)).send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(200);
    const asWatch = { ...authed(session), authorization: `Bearer ${refreshed.body.accessToken}` };
    const watch = await request(app).post('/v1/shop/redeem').set(asWatch).send({ itemId: 'gym-towel', addressId });
    expect(watch.status).toBe(403);
    expect(watch.body.error.code).toBe('STEP_UP_REQUIRED');

    await UserModel.updateOne({ _id: session.userId }, { $set: { 'trust.tier': 'restricted' } });
    const again = await request(app).post('/v1/auth/refresh').set(authed(session)).send({ refreshToken: refreshed.body.refreshToken });
    const asRestricted = { ...authed(session), authorization: `Bearer ${again.body.accessToken}` };
    const restricted = await request(app).post('/v1/shop/redeem').set(asRestricted).send({ itemId: 'gym-towel', addressId });
    expect(restricted.status).toBe(403);
    expect(restricted.body.error.code).toBe('REDEMPTION_RESTRICTED');
  });
});

describe('commerce: orders and cancellation (RULES R5–R7)', () => {
  it('lists newest first with a cursor, and cancelling refunds the coins and the stock exactly once', async () => {
    const { session, addressId } = await shopper(3_000);
    const before = (await ShopInventoryModel.findById('gym-towel').lean())!.onHand;
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const placed = await request(app).post('/v1/shop/redeem').set(authed(session)).send({ itemId: 'gym-towel', addressId });
      expect(placed.status).toBe(200);
      ids.push(placed.body.order.id);
    }

    const first = await request(app).get('/v1/orders').query({ limit: 2 }).set(authed(session));
    expect(first.body.data.map((o: { id: string }) => o.id)).toEqual([ids[2], ids[1]]);
    const rest = await request(app).get('/v1/orders').query({ limit: 2, cursor: first.body.nextCursor }).set(authed(session));
    expect(rest.body.data.map((o: { id: string }) => o.id)).toEqual([ids[0]]);
    expect(rest.body.nextCursor).toBeNull();

    const cancelled = await request(app).post(`/v1/orders/${ids[0]}/cancel`).set(authed(session));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order).toMatchObject({ status: 'cancelled', cancellable: false });
    expect(cancelled.body.balance).toBe(3_000 - 350 * 2);
    expect((await ShopInventoryModel.findById('gym-towel').lean())!.onHand).toBe(before - 2);
    const refund = await CoinLedgerModel.findOne({ userId: session.userId, source: 'refund', referenceType: 'order_cancel' }).lean();
    expect(refund?.amountMc).toBe(350_000);

    // A second cancel is a no-op with the same answer, not a second refund.
    const twice = await request(app).post(`/v1/orders/${ids[0]}/cancel`).set(authed(session));
    expect(twice.status).toBe(200);
    expect(twice.body.balance).toBe(3_000 - 350 * 2);
    expect(await CoinLedgerModel.countDocuments({ userId: session.userId, source: 'refund', referenceType: 'order_cancel' })).toBe(1);

    // Shipped orders are past cancelling.
    await OrderModel.updateOne({ _id: ids[1] }, { $set: { status: 'shipped', trackingRef: 'DL123' } });
    const late = await request(app).post(`/v1/orders/${ids[1]}/cancel`).set(authed(session));
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
    const shipped = await request(app).get(`/v1/orders/${ids[1]}`).set(authed(session));
    expect(shipped.body).toMatchObject({ status: 'shipped', trackingRef: 'DL123', cancellable: false });

    // Someone else's order is not mine to see or cancel.
    const other = await signUpAndRegister();
    expect((await request(app).get(`/v1/orders/${ids[2]}`).set(authed(other))).status).toBe(404);
    expect((await request(app).post(`/v1/orders/${ids[2]}/cancel`).set(authed(other))).status).toBe(404);

    expect(await NotificationModel.countDocuments({ userId: session.userId, title: 'Order cancelled' })).toBe(1);
  });
});
