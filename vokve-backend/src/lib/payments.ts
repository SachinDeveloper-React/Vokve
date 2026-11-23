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

/**
 * Whether an order that owes money can be taken at all.
 *
 * Not with the mock in production. `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION` lets
 * the server boot while the gateway is not wired, on the understanding that
 * the shop stays coins-only — but nothing held it to that: one item set to
 * `money` or `mixed` and any member could place the order and "pay" it with
 * a made-up payment id, because the mock believes every proof. Now the
 * order is refused before anything is reserved, and the proof is refused
 * too, for an order that was already waiting (RULES R12).
 */
export function moneyPaymentsAccepted(): boolean {
  // Read per call rather than from `isProduction`, so a test can stand in production.
  return !(env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock');
}

type SaleMode = 'coins' | 'money' | 'mixed';

/**
 * How the shop sells, once the gateway is accounted for (D-109): what ⚙
 * `commerce.paymentMode` says — or coins, whatever it says, while money
 * cannot be taken.
 *
 * Refusing money orders at the till was not enough on its own: the default
 * mode is `mixed`, so with no gateway nearly every product could be put in a
 * basket and then not bought (`PAYMENT_UNAVAILABLE`). Read as coins, every
 * product can be bought, nothing anywhere quotes or asks for money, and the
 * stored modes are left alone — the day a real gateway is configured they
 * are in force again without anybody re-entering them.
 */
export function shopModeInForce(configured: SaleMode): SaleMode {
  return moneyPaymentsAccepted() ? configured : 'coins';
}

/** One item's mode in force: its own where it has one, else the shop's — and coins, whatever either says, while there is no gateway (D-109). */
export function itemModeInForce(own: string | null | undefined, shop: SaleMode): SaleMode {
  if (!moneyPaymentsAccepted()) return 'coins';
  return own === 'coins' || own === 'money' || own === 'mixed' ? own : shop;
}

export function paymentKeyId(): string | null {
  return env.PAYMENT_PROVIDER === 'razorpay' ? env.RAZORPAY_KEY_ID ?? null : null;
}

/**
 * How long one call to the gateway may take. Every one of them sits inside a
 * member's request, and the app gives up on a request after 15 s — a
 * gateway that hangs past that turns a checkout that worked into one the
 * member is told failed, which is how a second order gets placed.
 */
const GATEWAY_TIMEOUT_MS = 10_000;

function razorpayAuth(): string {
  return `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
}

export async function createGatewayOrder(input: { orderId: string; amountPaise: number; currency: string; method?: PaymentMethod | null }): Promise<GatewayOrder> {
  if (env.PAYMENT_PROVIDER === 'mock') {
    return { provider: 'mock', providerOrderId: `mockord_${input.orderId}`, keyId: null };
  }
  let res: Response;
  try {
    res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { authorization: razorpayAuth(), 'content-type': 'application/json' },
      // `method` locks the gateway order to the one the member picked, so the
      // sheet cannot be paid a way the order was not quoted for.
      body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, receipt: input.orderId, notes: { orderId: input.orderId }, method: gatewayMethodHint(input.method) }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
  } catch (err) {
    // Unreachable or too slow: the same answer as a refusal, so the order is
    // released rather than left waiting on a gateway order that may not exist.
    logger.error({ err, orderId: input.orderId }, 'payments.razorpay.order_unreachable');
    throw new ApiError(502, 'PAYMENT_UNAVAILABLE', 'Payments are unavailable right now. Please try again in a moment.');
  }
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
    return moneyPaymentsAccepted() && proof.providerPaymentId.length > 0;
  }
  if (!proof.signature || !env.RAZORPAY_KEY_SECRET) return false;
  const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${providerOrderId}|${proof.providerPaymentId}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(proof.signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface GatewayRefund {
  status: 'refunded' | 'failed';
  /** What went wrong, for the refund row support reads; null when it went through. */
  error: string | null;
}

/**
 * Sends the money back. The mock is instant; Razorpay takes the refund
 * request and settles it in its own time, which is why the order records
 * `refunded` on our side once the request is accepted.
 *
 * Never throws. It runs after the cancel has already been committed, so an
 * exception here used to answer the member's cancel with a 500 for an order
 * that *was* cancelled — and the refund was then never tried again. A
 * failure is an answer the caller records and retries (RULES R6).
 */
export async function refundGatewayPayment(input: { providerPaymentId: string; amountPaise: number }): Promise<GatewayRefund> {
  if (env.PAYMENT_PROVIDER === 'mock') return { status: 'refunded', error: null };
  try {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(input.providerPaymentId)}/refund`, {
      method: 'POST',
      headers: { authorization: razorpayAuth(), 'content-type': 'application/json' },
      body: JSON.stringify({ amount: input.amountPaise }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error({ status: res.status, paymentId: input.providerPaymentId, body }, 'payments.razorpay.refund_failed');
      return { status: 'failed', error: `Gateway answered ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}` };
    }
    return { status: 'refunded', error: null };
  } catch (err) {
    logger.error({ err, paymentId: input.providerPaymentId }, 'payments.razorpay.refund_unreachable');
    return { status: 'failed', error: err instanceof Error ? err.message : 'Gateway unreachable' };
  }
}

/**
 * How much of a payment the gateway has already sent back, in paise, or
 * null when that cannot be told (the mock, or the gateway not answering).
 *
 * Asked before a refund is *retried*: the first attempt may have reached the
 * gateway and only its answer been lost, and a second partial refund of the
 * same payment would go through.
 */
export async function gatewayRefundedAmount(providerPaymentId: string): Promise<number | null> {
  if (env.PAYMENT_PROVIDER === 'mock') return null;
  try {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(providerPaymentId)}`, {
      headers: { authorization: razorpayAuth() },
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { amount_refunded?: unknown };
    return typeof body.amount_refunded === 'number' ? body.amount_refunded : null;
  } catch {
    return null;
  }
}

export interface CapturedPayment {
  providerPaymentId: string;
  /** Paise. */
  amount: number;
}

/**
 * The payments the gateway has captured against one of its orders, or null
 * when that cannot be told.
 *
 * This is how an order the member *did* pay for is told apart from one they
 * walked away from, when the app's proof never arrived — the phone died, the
 * app was killed, the network dropped after the sheet closed. Without asking,
 * the unpaid-order sweep would release the order and keep the money (RULES
 * R12). The mock has no money and no sheet, so nothing is ever captured there
 * without the app's own proof.
 */
export async function capturedPayments(providerOrderId: string): Promise<CapturedPayment[] | null> {
  if (env.PAYMENT_PROVIDER === 'mock') return [];
  try {
    const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(providerOrderId)}/payments`, {
      headers: { authorization: razorpayAuth() },
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, providerOrderId }, 'payments.razorpay.lookup_failed');
      return null;
    }
    const body = (await res.json()) as { items?: { id?: unknown; amount?: unknown; status?: unknown }[] };
    return (body.items ?? [])
      .filter(p => p.status === 'captured' && typeof p.id === 'string' && typeof p.amount === 'number')
      .map(p => ({ providerPaymentId: p.id as string, amount: p.amount as number }));
  } catch (err) {
    logger.warn({ err, providerOrderId }, 'payments.razorpay.lookup_unreachable');
    return null;
  }
}
