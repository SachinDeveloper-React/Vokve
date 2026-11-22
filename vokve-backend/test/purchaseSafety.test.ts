import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { OrderModel, PaymentRefundModel, ShopInventoryModel } from '../src/modules/commerce/models.js';
import { retryDueRefunds } from '../src/modules/commerce/refunds.service.js';
import { expireUnpaidOrders } from '../src/modules/commerce/service.js';
import { CoinLedgerModel } from '../src/modules/economy/models.js';
import { credit } from '../src/modules/economy/service.js';
import { UserModel } from '../src/modules/identity/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { invalidateConfig } from '../src/config/remote.js';
import { AppConfigModel, IdempotencyModel } from '../src/modules/platform/models.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

/**
 * What a purchase does when something goes wrong around it (RULES R2, R6,
 * R12): the network drops after the order was placed, the process dies
 * mid-request, the member pays after the order was released, pays twice, or
 * the gateway will not take a refund. In every one of them the member ends
 * up with exactly one order, coins taken once, and any money that has
 * nothing to pay for on its way back.
 */

const ADDRESS = {
  label: 'Home', name: 'Asha Verma', phone: '+919876543210', line1: '12 MG Road', line2: 'Flat 4B',
  city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', country: 'IN', isDefault: false,
};

async function shopper(coins = 2_000): Promise<{ session: Session; addressId: string }> {
  const session = await signUpAndRegister();
  await UserModel.updateOne({ _id: session.userId }, { $set: { phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(), name: 'Asha Verma' } });
  await credit({ userId: session.userId, source: 'refund', referenceType: 'test', referenceId: 'fund', amount: coins, title: 'Test funds', localDay: '2026-09-14', exemptFromCap: true });
  const created = await request(app).post('/v1/me/addresses').set(authed(session)).send(ADDRESS);
  expect(created.status).toBe(201);
  return { session, addressId: created.body.id };
}

const wallet = async (session: Session) => (await request(app).get('/v1/wallet').set(authed(session))).body.balance as number;
const purchases = (userId: string) => CoinLedgerModel.countDocuments({ userId, source: 'purchase' });

afterEach(() => {
  env.PAYMENT_PROVIDER = 'mock';
  env.RAZORPAY_KEY_ID = undefined;
  env.RAZORPAY_KEY_SECRET = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('purchase safety: a checkout retried under its own key is one order', () => {
  it('finds the order the first try placed, even when that try answered with an error', async () => {
    const { session, addressId } = await shopper(2_000);
    await request(app).put('/v1/cart/lines').set(authed(session)).send({ itemId: 'shaker', quantity: 1 });
    const key = { ...authed(session), 'idempotency-key': 'attempt-1' };
    const placed = await request(app).post('/v1/checkout').set(key).send({ fromCart: true, addressId, coins: 100 });
    expect(placed.status).toBe(200);

    // The request-level record is what a failed answer leaves behind: none.
    // (A 500 after the commit — a crash, a notifier — frees the key.)
    await IdempotencyModel.deleteMany({});
    const retried = await request(app).post('/v1/checkout').set(key).send({ fromCart: true, addressId, coins: 100 });
    expect(retried.status).toBe(200);
    expect(retried.body.order.id).toBe(placed.body.order.id);
    // The basket was emptied by the first; read again it would say CART_EMPTY.
    expect(retried.body.balance).toBe(1_900);
    expect(await OrderModel.countDocuments({ userId: session.userId })).toBe(1);
    expect(await purchases(session.userId)).toBe(1);
    expect(await wallet(session)).toBe(1_900);
  });

  it('hands back the payment sheet for a replayed order that still owes money', async () => {
    const { session, addressId } = await shopper(2_000);
    const key = { ...authed(session), 'idempotency-key': 'attempt-money' };
    const body = { lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 100 };
    const placed = await request(app).post('/v1/checkout').set(key).send(body);
    expect(placed.body.payment).toMatchObject({ provider: 'mock', providerOrderId: expect.any(String) });

    await IdempotencyModel.deleteMany({});
    const retried = await request(app).post('/v1/checkout').set(key).send(body);
    expect(retried.status).toBe(200);
    expect(retried.body.order).toMatchObject({ id: placed.body.order.id, status: 'pending_payment' });
    expect(retried.body.payment).toMatchObject({ orderId: placed.body.order.id, providerOrderId: placed.body.payment.providerOrderId, amount: placed.body.payment.amount });
    expect(await purchases(session.userId)).toBe(1);
  });

  it('a request that died mid-way does not lock its key for the day', async () => {
    const { session, addressId } = await shopper(2_000);
    const id = `${session.userId}:attempt-crashed`;
    const key = { ...authed(session), 'idempotency-key': 'attempt-crashed' };
    const body = { lines: [{ itemId: 'shaker', quantity: 1 }], addressId, coins: 100 };

    // Still running, as far as anyone can tell: the retry is asked to wait.
    await IdempotencyModel.create({ _id: id, status: 0, body: null, createdAt: new Date() });
    const busy = await request(app).post('/v1/checkout').set(key).send(body);
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('IN_PROGRESS');

    // Five minutes later nobody is coming back for it: the retry takes over.
    await IdempotencyModel.updateOne({ _id: id }, { $set: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    const placed = await request(app).post('/v1/checkout').set(key).send(body);
    expect(placed.status).toBe(200);
    expect(await OrderModel.countDocuments({ userId: session.userId })).toBe(1);
    expect((await IdempotencyModel.findById(id).lean())?.status).toBe(200);
  });

  it('a notifier failing after the order is committed does not answer it with an error', async () => {
    const { session, addressId } = await shopper(2_000);
    // Coins cover it all, so the checkout itself tells the member — the
    // shape every order in the shop has today.
    await AppConfigModel.updateOne({ _id: 'commerce' }, { $set: { value: { coinShareMax: 1, shippingFeePaise: 0 } } }, { upsert: true });
    invalidateConfig();
    try {
      vi.spyOn(NotificationModel, 'create').mockRejectedValueOnce(new Error('notifications down'));
      const placed = await request(app).post('/v1/checkout').set({ ...authed(session), 'idempotency-key': 'attempt-quiet' })
        .send({ lines: [{ itemId: 'shaker', quantity: 1 }], addressId, coins: 996 });
      expect(placed.status).toBe(200);
      expect(placed.body.order.status).toBe('placed');
      // A 200, so the key keeps its answer and the retry is that answer.
      const retried = await request(app).post('/v1/checkout').set({ ...authed(session), 'idempotency-key': 'attempt-quiet' })
        .send({ lines: [{ itemId: 'shaker', quantity: 1 }], addressId, coins: 996 });
      expect(retried.body.order.id).toBe(placed.body.order.id);
      expect(await purchases(session.userId)).toBe(1);

      vi.spyOn(NotificationModel, 'create').mockRejectedValueOnce(new Error('notifications down'));
      const cancelled = await request(app).post(`/v1/orders/${placed.body.order.id}/cancel`).set(authed(session));
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.balance).toBe(2_000);
    } finally {
      await AppConfigModel.updateOne({ _id: 'commerce' }, { $set: { value: {} } }, { upsert: true });
      invalidateConfig();
    }
  });

  it('a cancelled order gives its key back, so "Pay" again under it is a new order', async () => {
    const { session, addressId } = await shopper(2_000);
    const key = { ...authed(session), 'idempotency-key': 'attempt-again' };
    const body = { lines: [{ itemId: 'shaker', quantity: 1 }], addressId, coins: 100 };
    const first = await request(app).post('/v1/checkout').set(key).send(body);
    await request(app).post(`/v1/orders/${first.body.order.id}/cancel`).set(authed(session));
    await IdempotencyModel.deleteMany({});

    const second = await request(app).post('/v1/checkout').set(key).send(body);
    expect(second.status).toBe(200);
    expect(second.body.order.id).not.toBe(first.body.order.id);
    expect(second.body.order.status).toBe('pending_payment');
    expect(await wallet(session)).toBe(1_900);
  });
});

describe('purchase safety: every payment the gateway took is applied or sent back', () => {
  it('a second payment for an order already paid is refunded, and the order keeps the first', async () => {
    const { session, addressId } = await shopper(2_000);
    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 100 });
    const orderId = placed.body.order.id;
    expect((await request(app).post(`/v1/orders/${orderId}/pay`).set(authed(session)).send({ providerPaymentId: 'pay_one' })).status).toBe(200);

    const again = await request(app).post(`/v1/orders/${orderId}/pay`).set(authed(session)).send({ providerPaymentId: 'pay_two' });
    expect(again.status).toBe(200);
    expect(again.body.order).toMatchObject({ status: 'placed', payment: { status: 'paid' } });
    expect((await OrderModel.findById(orderId).lean())!.payment.providerPaymentId).toBe('pay_one');
    expect(await PaymentRefundModel.findById(`${orderId}:pay_two`).lean())
      .toMatchObject({ status: 'refunded', reason: 'duplicate_payment', amount: placed.body.order.payable });
    expect(await NotificationModel.countDocuments({ userId: session.userId, title: 'Extra payment refunded' })).toBe(1);

    // The first proof again is still just the answer — not a duplicate of itself.
    expect((await request(app).post(`/v1/orders/${orderId}/pay`).set(authed(session)).send({ providerPaymentId: 'pay_one' })).status).toBe(200);
    expect(await PaymentRefundModel.countDocuments({ orderId })).toBe(1);
  });

  it('two payments racing for one order: exactly one pays it, the other goes back', async () => {
    const { session, addressId } = await shopper(2_000);
    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 100 });
    const orderId = placed.body.order.id;
    const results = await Promise.all(['pay_a', 'pay_b', 'pay_c'].map(id =>
      request(app).post(`/v1/orders/${orderId}/pay`).set(authed(session)).send({ providerPaymentId: id }),
    ));
    expect(results.every(r => r.status === 200)).toBe(true);
    const order = (await OrderModel.findById(orderId).lean())!;
    expect(order.status).toBe('placed');
    expect(order.events.filter(e => e.to === 'placed')).toHaveLength(1);
    const refunds = await PaymentRefundModel.find({ orderId }).lean();
    expect(refunds).toHaveLength(2);
    expect(refunds.map(r => r.providerPaymentId).sort()).toEqual(['pay_a', 'pay_b', 'pay_c'].filter(id => id !== order.payment.providerPaymentId));
  });

  it('a payment racing the member\'s own cancel never leaves the order both cancelled and kept', async () => {
    const { session, addressId } = await shopper(2_000);
    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 100 });
    expect(placed.status, JSON.stringify(placed.body)).toBe(200);
    const orderId = placed.body.order.id;
    const [paid, cancelled] = await Promise.all([
      request(app).post(`/v1/orders/${orderId}/pay`).set(authed(session)).send({ providerPaymentId: 'pay_race' }),
      request(app).post(`/v1/orders/${orderId}/cancel`).set(authed(session)),
    ]);
    const order = (await OrderModel.findById(orderId).lean())!;
    expect(order.status).toBe('cancelled');
    // Whichever won, the money is back: refunded by the cancel when the
    // payment got there first, or refunded as late when the cancel did.
    const refund = await PaymentRefundModel.findById(`${orderId}:pay_race`).lean();
    expect(refund?.status).toBe('refunded');
    expect([200, 409]).toContain(paid.status);
    expect(cancelled.status).toBe(200);
    expect(await wallet(session)).toBe(2_000);
  });
});

/** A stand-in for Razorpay's API, answering the four calls the server makes. */
function fakeRazorpay(state: { refundsFail: number; refunded: Record<string, number>; captured: Record<string, { id: string; amount: number }[]> }) {
  const calls: string[] = [];
  const fetchStub = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${href.replace('https://api.razorpay.com/v1', '')}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    let m: RegExpMatchArray | null;
    if (method === 'POST' && href.endsWith('/v1/orders')) {
      const body = JSON.parse(String(init?.body)) as { receipt: string };
      return json({ id: `order_${body.receipt}` });
    }
    if (method === 'POST' && (m = href.match(/\/v1\/payments\/([^/]+)\/refund$/))) {
      if (state.refundsFail > 0) {
        state.refundsFail -= 1;
        return json({ error: { description: 'Gateway busy' } }, 503);
      }
      const amount = (JSON.parse(String(init?.body)) as { amount: number }).amount;
      state.refunded[m[1]] = (state.refunded[m[1]] ?? 0) + amount;
      return json({ id: `rfnd_${m[1]}`, amount });
    }
    if (method === 'GET' && (m = href.match(/\/v1\/payments\/([^/]+)$/))) {
      return json({ id: m[1], amount_refunded: state.refunded[m[1]] ?? 0 });
    }
    if (method === 'GET' && (m = href.match(/\/v1\/orders\/([^/]+)\/payments$/))) {
      return json({ items: (state.captured[m[1]] ?? []).map(p => ({ ...p, status: 'captured' })) });
    }
    return json({ error: 'unexpected' }, 404);
  });
  vi.stubGlobal('fetch', fetchStub);
  env.PAYMENT_PROVIDER = 'razorpay';
  env.RAZORPAY_KEY_ID = 'rzp_test_key';
  env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
  return calls;
}

const signature = (providerOrderId: string, paymentId: string) =>
  createHmac('sha256', 'rzp_test_secret').update(`${providerOrderId}|${paymentId}`).digest('hex');

describe('purchase safety: refunds through a real gateway', () => {
  it('a refund the gateway refuses leaves the cancel done, and the sweep sends it later', async () => {
    const state = { refundsFail: 1, refunded: {} as Record<string, number>, captured: {} };
    fakeRazorpay(state);
    const { session, addressId } = await shopper(2_000);
    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 100 });
    const { id: orderId, payable } = placed.body.order;
    const providerOrderId = placed.body.payment.providerOrderId;
    const paid = await request(app).post(`/v1/orders/${orderId}/pay`).set(authed(session))
      .send({ providerPaymentId: 'pay_rzp1', signature: signature(providerOrderId, 'pay_rzp1') });
    expect(paid.status).toBe(200);

    // The gateway is down for the cancel: the cancel is still a 200 — the
    // coins and stock are back — and the money is owed, not forgotten.
    const cancelled = await request(app).post(`/v1/orders/${orderId}/cancel`).set(authed(session));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order).toMatchObject({ status: 'cancelled', payment: { status: 'paid' } });
    expect(cancelled.body.balance).toBe(2_000);
    expect(await PaymentRefundModel.findById(`${orderId}:pay_rzp1`).lean()).toMatchObject({ status: 'failed', attempts: 1, lastError: expect.stringContaining('503') });

    // Not due yet: the sweep leaves it alone for its backoff.
    expect(await retryDueRefunds()).toEqual({ refunded: 0, failed: 0 });
    // Due: sent, once, for the whole payment, and the order says so.
    expect(await retryDueRefunds(new Date(Date.now() + 10 * 60_000))).toEqual({ refunded: 1, failed: 0 });
    expect(state.refunded).toEqual({ pay_rzp1: payable });
    expect((await OrderModel.findById(orderId).lean())!.payment).toMatchObject({ status: 'refunded', refundedAt: expect.any(Date) });
    // Done is done: no third call.
    expect(await retryDueRefunds(new Date(Date.now() + 60 * 60_000))).toEqual({ refunded: 0, failed: 0 });
    expect(state.refunded).toEqual({ pay_rzp1: payable });
  });

  it('a retry whose first try did reach the gateway does not refund twice', async () => {
    const state = { refundsFail: 0, refunded: {} as Record<string, number>, captured: {} };
    const calls = fakeRazorpay(state);
    const { session, addressId } = await shopper(2_000);
    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 100 });
    const { id: orderId, payable } = placed.body.order;
    await request(app).post(`/v1/orders/${orderId}/pay`).set(authed(session))
      .send({ providerPaymentId: 'pay_rzp2', signature: signature(placed.body.payment.providerOrderId, 'pay_rzp2') });
    const cancelled = await request(app).post(`/v1/orders/${orderId}/cancel`).set(authed(session));
    expect(cancelled.body.order.payment.status).toBe('refunded');
    expect(state.refunded).toEqual({ pay_rzp2: payable });
    // Now say the gateway's answer to that refund was lost on the way back:
    // our side recorded a failure for a refund the gateway in fact made.
    await PaymentRefundModel.updateOne({ _id: `${orderId}:pay_rzp2` }, { $set: { status: 'failed', nextAttemptAt: new Date(0) } });
    await OrderModel.updateOne({ _id: orderId }, { $set: { 'payment.status': 'paid' } });

    // The retry asks first, sees it went through, and sends nothing.
    expect(await retryDueRefunds()).toEqual({ refunded: 1, failed: 0 });
    expect(state.refunded).toEqual({ pay_rzp2: payable });
    expect(calls.filter(c => c === 'POST /payments/pay_rzp2/refund')).toHaveLength(1);
    expect((await OrderModel.findById(orderId).lean())!.payment.status).toBe('refunded');
  });

  it('the unpaid-order sweep asks the gateway first: a payment whose proof never arrived pays the order', async () => {
    const state = { refundsFail: 0, refunded: {} as Record<string, number>, captured: {} as Record<string, { id: string; amount: number }[]> };
    const calls = fakeRazorpay(state);
    const { session, addressId } = await shopper(2_000);
    const before = (await ShopInventoryModel.findById('cap').lean())!.onHand;
    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 100 });
    const { id: orderId, payable } = placed.body.order;
    const providerOrderId = placed.body.payment.providerOrderId;
    await OrderModel.updateOne({ _id: orderId }, { $set: { 'payment.expiresAt': new Date(Date.now() - 1000) } });

    // The member paid — twice, the second sheet opened over the first — and
    // the app never told us about either.
    state.captured[providerOrderId] = [{ id: 'pay_lost1', amount: payable }, { id: 'pay_lost2', amount: payable }];
    expect(await expireUnpaidOrders()).toEqual({ released: 0, paid: 1 });
    expect(calls).toContain(`GET /orders/${providerOrderId}/payments`);

    const order = (await OrderModel.findById(orderId).lean())!;
    expect(order).toMatchObject({ status: 'placed', payment: { status: 'paid', providerPaymentId: 'pay_lost1' } });
    expect(await PaymentRefundModel.findById(`${orderId}:pay_lost2`).lean()).toMatchObject({ status: 'refunded', reason: 'duplicate_payment' });
    expect(state.refunded).toEqual({ pay_lost2: payable });
    expect((await ShopInventoryModel.findById('cap').lean())!.onHand).toBe(before - 1);
    expect(await wallet(session)).toBe(1_900);
  });

  it('the sweep holds an order it cannot ask the gateway about, for a while', async () => {
    fakeRazorpay({ refundsFail: 0, refunded: {}, captured: {} });
    const { session, addressId } = await shopper(2_000);
    const placed = await request(app).post('/v1/checkout').set(authed(session)).send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 100 });
    const orderId = placed.body.order.id;
    await OrderModel.updateOne({ _id: orderId }, { $set: { 'payment.expiresAt': new Date(Date.now() - 1000) } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ETIMEDOUT'); }));

    expect(await expireUnpaidOrders()).toEqual({ released: 0, paid: 0 });
    expect((await OrderModel.findById(orderId).lean())!.status).toBe('pending_payment');
    // Hours later, still no answer: released, so the stock and coins are not held forever.
    expect(await expireUnpaidOrders(new Date(Date.now() + 7 * 60 * 60_000))).toEqual({ released: 1, paid: 0 });
    expect(await wallet(session)).toBe(2_000);
  });

  it('a gateway that cannot open its order leaves nothing sold, and the retry under the same key is a fresh try', async () => {
    fakeRazorpay({ refundsFail: 0, refunded: {}, captured: {} });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const { session, addressId } = await shopper(2_000);
    const key = { ...authed(session), 'idempotency-key': 'attempt-gateway' };
    const body = { lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins: 100 };
    const failed = await request(app).post('/v1/checkout').set(key).send(body);
    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('PAYMENT_UNAVAILABLE');
    expect(await wallet(session)).toBe(2_000);
    // The refused request's key is freed just after its answer goes out, not
    // before; under load a retry can land in between and be told IN_PROGRESS,
    // which the app answers by asking again. Do the same here.
    await vi.waitFor(async () => {
      expect(await IdempotencyModel.exists({ _id: `${session.userId}:attempt-gateway` })).toBeNull();
    });

    fakeRazorpay({ refundsFail: 0, refunded: {}, captured: {} });
    const retried = await request(app).post('/v1/checkout').set(key).send(body);
    expect(retried.status).toBe(200);
    expect(retried.body.order.status).toBe('pending_payment');
    expect(await OrderModel.countDocuments({ userId: session.userId, status: 'pending_payment' })).toBe(1);
    expect(await wallet(session)).toBe(1_900);
  });
});
