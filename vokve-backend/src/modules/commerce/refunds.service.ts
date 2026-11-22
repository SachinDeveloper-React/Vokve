import type { ClientSession } from 'mongoose';
import { raiseAlert } from '../../lib/alerts.js';
import { gatewayRefundedAmount, refundGatewayPayment } from '../../lib/payments.js';
import { logger } from '../../lib/logger.js';
import { OrderModel, PaymentRefundModel } from './models.js';

/**
 * Money going back to a member through the gateway (RULES R6, R12).
 *
 * Every refund — a cancel, an operator's refund, a payment that arrived for
 * an order already released, a second payment for an order already paid —
 * goes through here, in two steps:
 *
 *   1. `queueRefund` writes what is owed. Where there is a transaction (the
 *      cancel, the operator's refund) it is written inside it, beside the
 *      coins coming back, so the two are never separated.
 *   2. `attemptRefund` calls the gateway and records the answer. Run straight
 *      after the commit, and again by the hourly sweep for anything that did
 *      not go through — the gateway refused, timed out, or the process died
 *      between the commit and the call.
 *
 * Nothing is ever refunded twice: one row per payment, a lock while the
 * gateway is being called, and on a retry the gateway is asked first how
 * much of the payment it has already sent back.
 */

export type RefundReason = 'cancelled' | 'admin_refund' | 'late_payment' | 'duplicate_payment';
export type RefundOutcome = 'refunded' | 'failed' | 'pending';

/** How long one attempt holds the row. Longer than the gateway's own timeout. */
const LOCK_MS = 60_000;
/** The sweep gives up after this many and leaves it to support, who are told. */
export const MAX_REFUND_ATTEMPTS = 8;
/** Five minutes, doubling: 5m, 10m, 20m … about ten hours in all. */
const FIRST_BACKOFF_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;
/** Rows handled per sweep; the next tick takes the rest. */
const BATCH = 100;

export interface RefundRequest {
  orderId: string;
  userId: string;
  provider: string | null;
  providerPaymentId: string;
  amount: number;
  currency: string;
  reason: RefundReason;
}

export function refundIdFor(orderId: string, providerPaymentId: string): string {
  return `${orderId}:${providerPaymentId}`;
}

/**
 * Records that a payment is owed back. Writing it twice is writing it once:
 * the first reason and amount stand.
 */
export async function queueRefund(input: RefundRequest, session?: ClientSession): Promise<string> {
  const id = refundIdFor(input.orderId, input.providerPaymentId);
  await PaymentRefundModel.updateOne(
    { _id: id },
    {
      $setOnInsert: {
        orderId: input.orderId, userId: input.userId, provider: input.provider, providerPaymentId: input.providerPaymentId,
        amount: input.amount, currency: input.currency, reason: input.reason, status: 'pending', attempts: 0, nextAttemptAt: new Date(),
      },
    },
    { upsert: true, ...(session ? { session } : {}) },
  );
  return id;
}

/**
 * One try at sending a queued refund. Answers `pending` when somebody else
 * holds it right now (the sweep and a cancel racing), or when it is not
 * there to try.
 */
export async function attemptRefund(id: string, now = new Date()): Promise<RefundOutcome> {
  const row = await PaymentRefundModel.findOneAndUpdate(
    { _id: id, status: { $in: ['pending', 'failed'] }, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
    { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
    { new: true },
  ).lean();
  if (!row) {
    const current = await PaymentRefundModel.findById(id, { status: 1 }).lean();
    return current?.status === 'refunded' ? 'refunded' : 'pending';
  }

  // A retry may follow a refund the gateway accepted but whose answer was
  // lost on the way back. Ask before sending another.
  let sent: { status: 'refunded' | 'failed'; error: string | null } | null = null;
  if (row.attempts > 1) {
    const already = await gatewayRefundedAmount(row.providerPaymentId);
    if (already !== null && already >= row.amount) sent = { status: 'refunded', error: null };
  }
  sent ??= await refundGatewayPayment({ providerPaymentId: row.providerPaymentId, amountPaise: row.amount });

  if (sent.status === 'refunded') {
    await PaymentRefundModel.updateOne({ _id: id }, { $set: { status: 'refunded', refundedAt: now, lockedUntil: null, lastError: null, nextAttemptAt: null } });
    // The order's own payment, when this was it. A stray payment (late or
    // duplicate) is not the order's, and leaves the order as it is.
    await OrderModel.updateOne(
      { _id: row.orderId, 'payment.providerPaymentId': row.providerPaymentId, 'payment.status': 'paid' },
      { $set: { 'payment.status': 'refunded', 'payment.refundedAt': now } },
    );
    logger.info({ refundId: id, orderId: row.orderId, amount: row.amount, reason: row.reason }, 'payments.refunded');
    return 'refunded';
  }

  const givingUp = row.attempts >= MAX_REFUND_ATTEMPTS;
  const backoff = Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** (row.attempts - 1));
  await PaymentRefundModel.updateOne(
    { _id: id },
    { $set: { status: 'failed', lastError: sent.error, lockedUntil: null, nextAttemptAt: givingUp ? null : new Date(now.getTime() + backoff) } },
  );
  logger.error({ refundId: id, orderId: row.orderId, attempts: row.attempts, error: sent.error, givingUp }, 'payments.refund_attempt_failed');
  // Money that is owed and not moving is the one thing here a person must
  // see the same hour: the member has been told it is on its way.
  await raiseAlert({
    key: givingUp ? 'payments.refund_stuck' : 'payments.refund_failed',
    severity: 'critical',
    title: givingUp ? 'A refund has stopped retrying' : 'A refund did not go through',
    lines: [
      `Order ${row.orderId}: ₹${(row.amount / 100).toFixed(2)} (${row.reason}), attempt ${row.attempts} of ${MAX_REFUND_ATTEMPTS}.`,
      `Gateway said: ${sent.error ?? 'nothing'}`,
      givingUp ? 'No more automatic retries — refund it by hand from the gateway dashboard.' : 'It will be tried again automatically.',
    ],
    path: `/dashboard/orders/${row.orderId}`,
  }).catch(err => logger.error({ err }, 'payments.refund_alert_failed'));
  return 'failed';
}

/**
 * The hourly sweep: every refund that is owed and due another try. One that
 * throws does not stop the rest.
 */
export async function retryDueRefunds(now = new Date()): Promise<{ refunded: number; failed: number }> {
  const due = await PaymentRefundModel.find(
    { status: { $in: ['pending', 'failed'] }, nextAttemptAt: { $ne: null, $lte: now } },
    { _id: 1 },
  ).sort({ nextAttemptAt: 1 }).limit(BATCH).lean();
  const result = { refunded: 0, failed: 0 };
  for (const row of due) {
    try {
      const outcome = await attemptRefund(row._id, now);
      if (outcome === 'refunded') result.refunded += 1;
      if (outcome === 'failed') result.failed += 1;
    } catch (err) {
      logger.error({ err, refundId: row._id }, 'payments.refund_sweep_failed');
    }
  }
  return result;
}
