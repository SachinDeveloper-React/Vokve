import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';
import { logger } from './logger.js';

export type PaymentProvider = 'mock' | 'razorpay';

/** Every way an order can be paid for, in the order the payment page lists them. */
export const PAYMENT_METHODS = ['coins', 'coins_upi', 'upi', 'card', 'netbanking'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** The methods that need money collected: the gateway is in it. */
const GATEWAY_METHODS: readonly PaymentMethod[] = ['coins_upi', 'upi', 'card', 'netbanking'];
/** The methods that spend coins. */
const COIN_METHODS: readonly PaymentMethod[] = ['coins', 'coins_upi'];

export function isGatewayMethod(method: PaymentMethod): boolean {
  return GATEWAY_METHODS.includes(method);
}

export function spendsCoins(method: PaymentMethod): boolean {
  return COIN_METHODS.includes(method);
}

/**
 * The methods a shop can actually offer, from the ones ⚙
 * `commerce.paymentMethods` lists: a coins-only shop takes coins and
 * nothing else, a money-only shop cannot take them at all, and a mixed
 * shop takes whichever of the five the owner left on. The order the owner
 * configured is the order the payment page draws, so the default method is
 * theirs to choose rather than the client's.
 */
export function offeredMethods(paymentMode: 'coins' | 'money' | 'mixed', configured: readonly string[]): PaymentMethod[] {
  const known = configured.filter((m): m is PaymentMethod => (PAYMENT_METHODS as readonly string[]).includes(m));
  if (paymentMode === 'coins') return known.filter(m => m === 'coins');
  if (paymentMode === 'money') return known.filter(m => !spendsCoins(m));
  return known;
}

/**
 * The ways one order can be paid: the shop's menu, kept to the ones its
 * own sums allow (RULES R12).
 *
 * `coins` needs the wallet's ceiling to clear the whole bill; `coins_upi`
 * needs some allowed number of coins to leave money still owing; a gateway
 * on its own needs the order to force no coins at all. An order of
 * coins-only goods therefore offers `coins` and nothing else, and one with
 * a coins-only line beside a money one offers only `coins_upi` — which is
 * exactly what it is.
 */
/** The owner's menu, with anything this build does not know dropped. */
export function knownMethods(configured: readonly string[]): PaymentMethod[] {
  return configured.filter((m): m is PaymentMethod => (PAYMENT_METHODS as readonly string[]).includes(m));
}

export function methodsForOrder(
  configured: readonly string[],
  order: { coinsMin: number; coinsMax: number; total: number; coinValuePaise: number },
): PaymentMethod[] {
  const { coinsMin, coinsMax, total, coinValuePaise: value } = order;
  // The fewest coins that still count as spending any.
  const leastSpent = Math.max(coinsMin, 1);
  return knownMethods(configured).filter(method => {
    if (method === 'coins') return coinsMax > 0 && total <= coinsMax * value;
    if (method === 'coins_upi') return coinsMax >= leastSpent && total > leastSpent * value;
    return coinsMin === 0 && total > 0;
  });
}

/** What Razorpay calls the method, so its checkout opens on that tab; undefined leaves it open. */
function gatewayMethodHint(method: PaymentMethod | null | undefined): string | undefined {
  switch (method) {
    case 'upi':
      return 'upi';
    case 'card':
      return 'card';
    case 'netbanking':
      return 'netbanking';
    default:
      // `coins_upi` deliberately leaves the choice open: the member said
      // "coins and then something", not which something.
      return undefined;
  }
}

export interface GatewayOrder {
  provider: PaymentProvider;
  /** The gateway's own id for the order — what the app opens the checkout with. */
  providerOrderId: string;
  /** The public half of the key pair, for the app; null for the mock. */
  keyId: string | null;
}

export interface PaymentProof {
  providerPaymentId: string;
  /** Razorpay's `razorpay_signature`; the mock ignores it. */
  signature?: string;
}

/**
 * The money side of an order (RULES R12), behind one seam so the commerce
 * service never knows which gateway is in front of it.
 *
 * Two providers. `mock` is for development and tests: it hands out an order
 * id and accepts any proof, so the whole pipeline — pending order, capture,
 * refund on cancel — runs end to end on a laptop with no keys. `razorpay`
 * is the real thing: an order created on their side with our order id as
 * the receipt, and the checkout's signature — HMAC-SHA256 of
 * `order_id|payment_id` under the secret — checked before anything is
 * marked paid. The webhook is the next step; until then the app's own
 * proof is what confirms a payment, and an unpaid order times out on the
 * scheduler.
 */
export function paymentProvider(): PaymentProvider {
  return env.PAYMENT_PROVIDER;
}

export function paymentKeyId(): string | null {
  return env.PAYMENT_PROVIDER === 'razorpay' ? env.RAZORPAY_KEY_ID ?? null : null;
}

export async function createGatewayOrder(input: { orderId: string; amountPaise: number; currency: string; method?: PaymentMethod | null }): Promise<GatewayOrder> {
  if (env.PAYMENT_PROVIDER === 'mock') {
    return { provider: 'mock', providerOrderId: `mockord_${input.orderId}`, keyId: null };
  }
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    // `method` locks the gateway order to the one the member picked, so the
    // sheet cannot be paid a way the order was not quoted for.
    body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, receipt: input.orderId, notes: { orderId: input.orderId }, method: gatewayMethodHint(input.method) }),
  });
  if (!res.ok) {
    logger.error({ status: res.status, body: await res.text().catch(() => '') }, 'payments.razorpay.order_failed');
    throw new ApiError(502, 'PAYMENT_UNAVAILABLE', 'Payments are unavailable right now. Please try again in a moment.');
  }
  const body = (await res.json()) as { id: string };
  return { provider: 'razorpay', providerOrderId: body.id, keyId: env.RAZORPAY_KEY_ID ?? null };
}

/** True when the proof the app sent is the gateway's own for this order. */
export function verifyPaymentProof(providerOrderId: string, proof: PaymentProof): boolean {
  if (env.PAYMENT_PROVIDER === 'mock') {
    return proof.providerPaymentId.length > 0;
  }
  if (!proof.signature || !env.RAZORPAY_KEY_SECRET) return false;
  const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${providerOrderId}|${proof.providerPaymentId}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(proof.signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sends the money back after a cancellation. The mock is instant; Razorpay
 * takes the refund request and settles it in its own time, which is why the
 * order records `refunded` on our side once the request is accepted.
 */
export async function refundGatewayPayment(input: { providerPaymentId: string; amountPaise: number }): Promise<'refunded' | 'failed'> {
  if (env.PAYMENT_PROVIDER === 'mock') return 'refunded';
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(input.providerPaymentId)}/refund`, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({ amount: input.amountPaise }),
  });
  if (!res.ok) {
    logger.error({ status: res.status, paymentId: input.providerPaymentId }, 'payments.razorpay.refund_failed');
    return 'failed';
  }
  return 'refunded';
}
