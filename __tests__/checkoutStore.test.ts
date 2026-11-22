/**
 * The act of buying when the network or the server lets it down (RULES R2,
 * R12; BACKEND.md §3.6). The server keys an order to the attempt's
 * idempotency key, so the app's half is to never hand it a *new* key for a
 * purchase whose first answer was lost, never press twice into two orders,
 * and never open a second payment sheet for money already taken.
 *
 * @format
 */

import { ApiError } from '../src/services/api/errors';
import { useCheckoutStore } from '../src/stores/checkoutStore';
import type { Order } from '../src/types/models';

jest.mock('../src/services/api/endpoints', () => {
  const offline = () => Promise.reject(new Error('offline'));
  return {
    checkoutApi: { quote: jest.fn(), place: jest.fn(), pay: jest.fn() },
    walletApi: { get: jest.fn(offline), transactions: jest.fn(offline), earnRules: jest.fn(offline) },
    orderApi: { list: jest.fn(offline), get: jest.fn(offline), count: jest.fn(offline), cancel: jest.fn(offline) },
    cartApi: { get: jest.fn(offline) },
    shopApi: {
      items: jest.fn(offline),
      categories: jest.fn(offline),
      config: jest.fn(offline),
      suggestions: jest.fn(offline),
    },
    wishlistApi: { ids: jest.fn(offline) },
  };
});

jest.mock('../src/services/payments', () => ({
  collectPayment: jest.fn(async () => ({
    providerPaymentId: `mockpay_${Math.random().toString(36).slice(2)}`,
  })),
}));

const { checkoutApi } = jest.requireMock('../src/services/api/endpoints') as {
  checkoutApi: { place: jest.Mock; pay: jest.Mock };
};
const { collectPayment } = jest.requireMock('../src/services/payments') as {
  collectPayment: jest.Mock;
};

const pendingOrder = (id = 'ord-1'): Order =>
  ({
    id,
    number: 'VKV2611221234',
    status: 'pending_payment',
    items: [],
    currency: 'INR',
    subtotal: 44900,
    discount: 0,
    shipping: 4900,
    coupon: null,
    total: 49800,
    inCoins: null,
    coinsUsed: 100,
    coinsValue: 2500,
    payable: 47300,
    payment: {
      provider: 'mock',
      method: 'coins_upi',
      status: 'pending',
      amount: 47300,
      currency: 'INR',
      providerOrderId: `mockord_${id}`,
      paidAt: null,
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    },
    delivery: null,
    estimatedDelivery: null,
    trackingChannels: ['email'],
    address: {
      label: 'Home',
      name: 'Asha Verma',
      phone: '+919876543210',
      line1: '12 MG Road',
      line2: '',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      country: 'IN',
    },
    placedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trackingRef: null,
    trackingUrl: null,
    timeline: [],
    headline: '',
    returns: null,
    addressChangeable: true,
    cancellable: true,
  } as unknown as Order);

const paidOrder = (id = 'ord-1'): Order => {
  const order = pendingOrder(id);
  return {
    ...order,
    status: 'placed',
    payment: { ...order.payment, status: 'paid', paidAt: new Date().toISOString() },
  };
};

const capLine = { itemId: 'cap', quantity: 1, size: null, color: null };
const buyCap = {
  lines: [capLine],
  addressId: 'adr-home',
  coins: 100,
  paymentMethod: 'coins_upi' as const,
};

const network = () => new ApiError('network', 'No connection');
const keyOf = (call: number) =>
  checkoutApi.place.mock.calls[call][1].idempotencyKey as string;

beforeEach(() => {
  checkoutApi.place.mockReset();
  checkoutApi.pay.mockReset();
  collectPayment.mockClear();
  useCheckoutStore.getState().reset();
});

describe('placing an order when the answer may be lost', () => {
  test('a second press while the first is in flight places nothing more', async () => {
    let finish: (value: unknown) => void = () => {};
    checkoutApi.place.mockImplementation(
      () => new Promise(resolve => (finish = resolve)),
    );
    const first = useCheckoutStore.getState().placeOrder(buyCap);
    const second = await useCheckoutStore.getState().placeOrder(buyCap);
    expect(second).toEqual({ status: 'busy' });

    finish({ order: paidOrder(), balance: 1900, payment: null });
    expect((await first).status).toBe('placed');
    expect(checkoutApi.place).toHaveBeenCalledTimes(1);
  });

  test('a lost answer is "unconfirmed", and pressing again sends the same key', async () => {
    checkoutApi.place.mockRejectedValueOnce(network());
    const lost = await useCheckoutStore.getState().placeOrder(buyCap);
    expect(lost.status).toBe('unconfirmed');
    expect(lost.status === 'unconfirmed' && lost.error.message).toContain(
      "won't charge you twice",
    );

    // The server finds the order the first try placed, under that key.
    checkoutApi.place.mockResolvedValueOnce({
      order: paidOrder(),
      balance: 1900,
      payment: null,
    });
    // The member nudged the coins in between: still the same purchase.
    const again = await useCheckoutStore
      .getState()
      .placeOrder({ ...buyCap, coins: 120 });
    expect(again.status).toBe('placed');
    expect(keyOf(1)).toBe(keyOf(0));

    // Settled: the next purchase is a new one.
    checkoutApi.place.mockResolvedValueOnce({
      order: paidOrder('ord-2'),
      balance: 1800,
      payment: null,
    });
    await useCheckoutStore.getState().placeOrder(buyCap);
    expect(keyOf(2)).not.toBe(keyOf(0));
  });

  test('a server fault and an unreadable 200 are just as uncertain; a refusal is not', async () => {
    checkoutApi.place.mockRejectedValueOnce(
      new ApiError('server', 'Something went wrong', 500),
    );
    expect((await useCheckoutStore.getState().placeOrder(buyCap)).status).toBe(
      'unconfirmed',
    );
    checkoutApi.place.mockRejectedValueOnce(
      new ApiError('validation', 'We received an unexpected response', null),
    );
    expect((await useCheckoutStore.getState().placeOrder(buyCap)).status).toBe(
      'unconfirmed',
    );
    expect(keyOf(1)).toBe(keyOf(0));

    // Sold out is a certain "no": nothing was placed, so the next press is new.
    checkoutApi.place.mockRejectedValueOnce(
      new ApiError('unknown', 'VOKVE Cap is sold out.', 409, null, 'OUT_OF_STOCK'),
    );
    expect((await useCheckoutStore.getState().placeOrder(buyCap)).status).toBe(
      'failed',
    );
    checkoutApi.place.mockResolvedValueOnce({
      order: paidOrder(),
      balance: 1900,
      payment: null,
    });
    await useCheckoutStore.getState().placeOrder(buyCap);
    expect(keyOf(3)).not.toBe(keyOf(2));
  });

  test('"payments unavailable" is the server saying no, not a lost answer', async () => {
    checkoutApi.place.mockRejectedValueOnce(
      new ApiError('server', 'Paying with money is not available yet.', 503, null, 'PAYMENT_UNAVAILABLE'),
    );
    expect((await useCheckoutStore.getState().placeOrder(buyCap)).status).toBe(
      'failed',
    );
  });

  test('buying something else after a lost answer is a new purchase', async () => {
    checkoutApi.place.mockRejectedValueOnce(network());
    await useCheckoutStore.getState().placeOrder(buyCap);
    checkoutApi.place.mockResolvedValueOnce({
      order: paidOrder('ord-2'),
      balance: 1900,
      payment: null,
    });
    await useCheckoutStore
      .getState()
      .placeOrder({ ...buyCap, lines: [{ ...capLine, itemId: 'shaker' }] });
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  test('"still being processed" waits for the first try\'s answer under the same key', async () => {
    checkoutApi.place
      .mockRejectedValueOnce(
        new ApiError('unknown', 'That request is still being processed.', 409, null, 'IN_PROGRESS'),
      )
      .mockResolvedValueOnce({ order: paidOrder(), balance: 1900, payment: null });
    const outcome = await useCheckoutStore.getState().placeOrder(buyCap);
    expect(outcome.status).toBe('placed');
    expect(checkoutApi.place).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(keyOf(0));
  });
});

describe('paying for an order when the answer may be lost', () => {
  test('money already taken is confirmed again, never collected a second time', async () => {
    checkoutApi.pay.mockRejectedValueOnce(network());
    const lost = await useCheckoutStore.getState().payPending(pendingOrder());
    expect(lost.status).toBe('unconfirmed');
    expect(collectPayment).toHaveBeenCalledTimes(1);

    checkoutApi.pay.mockResolvedValueOnce({ order: paidOrder(), balance: 1900 });
    const again = await useCheckoutStore.getState().payPending(pendingOrder());
    expect(again.status).toBe('placed');
    // No second sheet: the same proof went to the server again, under the same key.
    expect(collectPayment).toHaveBeenCalledTimes(1);
    expect(checkoutApi.pay.mock.calls[1][1]).toEqual(checkoutApi.pay.mock.calls[0][1]);
    expect(checkoutApi.pay.mock.calls[1][2]).toEqual(checkoutApi.pay.mock.calls[0][2]);
  });

  test('a payment the server sent back is worded, and not sent again', async () => {
    checkoutApi.pay.mockRejectedValueOnce(
      new ApiError(
        'unknown',
        'This order was closed before your payment reached us, so the ₹473 is being refunded to you.',
        409,
        { status: 'cancelled', refund: 'refunded' },
        'PAYMENT_REFUNDED',
      ),
    );
    const outcome = await useCheckoutStore.getState().payPending(pendingOrder());
    expect(outcome.status === 'failed' && outcome.error.code).toBe('PAYMENT_REFUNDED');

    checkoutApi.pay.mockResolvedValueOnce({ order: paidOrder(), balance: 1900 });
    await useCheckoutStore.getState().payPending(pendingOrder());
    expect(collectPayment).toHaveBeenCalledTimes(2);
  });

  test('a second press on "Pay" while a payment is in flight does nothing', async () => {
    let finish: (value: unknown) => void = () => {};
    checkoutApi.pay.mockImplementation(
      () => new Promise(resolve => (finish = resolve)),
    );
    const first = useCheckoutStore.getState().payPending(pendingOrder());
    expect(await useCheckoutStore.getState().payPending(pendingOrder())).toEqual({
      status: 'busy',
    });
    // Let the first reach the server before answering it.
    await new Promise(resolve => setTimeout(resolve, 0));
    finish({ order: paidOrder(), balance: 1900 });
    expect((await first).status).toBe('placed');
    expect(collectPayment).toHaveBeenCalledTimes(1);
  });
});
