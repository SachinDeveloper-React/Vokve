import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';
import { logger } from './logger.js';

export type PaymentProvider = 'mock' | 'razorpay';

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

export async function createGatewayOrder(input: { orderId: string; amountPaise: number; currency: string }): Promise<GatewayOrder> {
  if (env.PAYMENT_PROVIDER === 'mock') {
    return { provider: 'mock', providerOrderId: `mockord_${input.orderId}`, keyId: null };
  }
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({ amount: input.amountPaise, currency: input.currency, receipt: input.orderId, notes: { orderId: input.orderId } }),
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
