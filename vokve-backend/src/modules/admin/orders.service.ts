import { z } from 'zod';
import { withTransaction } from '../../db/mongo.js';
import { toCoins, toMilli } from '../../lib/coins.js';
import { Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { refundGatewayPayment } from '../../lib/payments.js';
import { cancelOrderAsOperator } from '../commerce/service.js';
import { OrderModel, ShopInventoryModel } from '../commerce/models.js';
import { CoinBalanceModel, CoinLedgerModel } from '../economy/models.js';
import { UserModel } from '../identity/models.js';
import { notify } from '../notifications/service.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * The operator's side of an order (RULES R10).
 *
 * Reading an order was never the hard part — the three things support
 * actually has to do are move it along, undo it, and fix the address
 * somebody typed wrong. All three were impossible without a database
 * client, which in practice meant they were done with one.
 *
 * Two rules shape what is here:
 *
 *   - **One undo path.** Cancelling goes through the same `releaseOrder`
 *     the member's own cancel and the unpaid-order sweep use, so the coins,
 *     the stock, the coupon and the gateway refund cannot be forgotten by
 *     one caller and remembered by another.
 *   - **A refund is not a cancel.** A cancel is for an order that has not
 *     happened yet; a refund is for one that has — it puts the money and
 *     the coins back without pretending the stock came with them.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

const STATUSES = ['pending_payment', 'placed', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded'] as const;
type Status = (typeof STATUSES)[number];

/**
 * Where an order may go from where it is.
 *
 * Forwards only, and never out of a terminal state: an order that has been
 * delivered is refunded rather than un-delivered, and one that was cancelled
 * is a new order rather than a revived one. `pending_payment` is not in
 * anybody's reach — it is the gateway's to leave.
 */
const NEXT: Record<Status, Status[]> = {
  pending_payment: ['placed', 'cancelled'],
  placed: ['confirmed', 'shipped', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
  refunded: [],
};

/** Up to and including `confirmed`: past that the parcel has gone. */
const ADDRESS_FIXABLE: Status[] = ['pending_payment', 'placed', 'confirmed'];

// ─── Every order, not one member's ─────────────────────────────────────────

export const orderQueueQuery = z.object({
  q: z.string().max(120).default(''),
  status: z.enum(STATUSES).optional(),
  /** `coins` is an order with no money side at all (RULES R11). */
  paidWith: z.enum(['coins', 'money', 'mixed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(['newest', 'oldest', 'biggest']).default('newest'),
});
export type OrderQueueQuery = z.infer<typeof orderQueueQuery>;

/**
 * The order book: what needs packing, what is stuck unpaid, what was
 * refunded last week.
 *
 * `paidWith` is the filter the shop's own mixed economy asks for: a
 * coins-only order has no money to chase and a money-only one has no coins
 * to put back, and the two are handled by different people.
 */
export async function orderQueue(query: OrderQueueQuery) {
  const filter: Record<string, unknown> = {};
  const trimmed = query.q.trim();
  if (trimmed) {
    filter.$or = [
      { _id: trimmed },
      { number: new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { userId: trimmed },
      { trackingRef: trimmed },
    ];
  }
  if (query.status) filter.status = query.status;
  if (query.paidWith === 'coins') filter.payable = 0;
  if (query.paidWith === 'money') filter.coinsUsed = 0;
  if (query.paidWith === 'mixed') {
    filter.payable = { $gt: 0 };
    filter.coinsUsed = { $gt: 0 };
  }

  const order: Record<string, 1 | -1> =
    query.sort === 'oldest' ? { placedAt: 1 } : query.sort === 'biggest' ? { total: -1 } : { placedAt: -1 };

  const [rows, total, totals, byStatus] = await Promise.all([
    OrderModel.find(filter).sort(order).skip(query.offset).limit(query.limit).lean(),
    OrderModel.countDocuments(filter),
    OrderModel.aggregate<{ _id: null; payable: number; coinsUsed: number }>([
      { $match: filter },
      { $group: { _id: null, payable: { $sum: '$payable' }, coinsUsed: { $sum: '$coinsUsed' } } },
    ]),
    OrderModel.aggregate<{ _id: string; orders: number }>([
      { $group: { _id: '$status', orders: { $sum: 1 } } },
      { $sort: { orders: -1 } },
    ]),
  ]);

  const members = await UserModel.find({ _id: { $in: rows.map(row => row.userId) } }, { name: 1, email: 1, phone: 1 }).lean();
  const memberOf = new Map(members.map(member => [member._id, member]));
  const sum = totals[0];

  return {
    total,
    offset: query.offset,
    limit: query.limit,
    // Whole coins on the order row; `toCoins` here would read 300 as 0.3.
    totals: { orders: total, payable: sum?.payable ?? 0, coinsUsed: sum?.coinsUsed ?? 0 },
    /** Every status with a count, whatever the filter — the shape of the book. */
    byStatus: byStatus.map(row => ({ status: row._id, orders: row.orders })),
    data: rows.map(row => {
      const member = memberOf.get(row.userId);
      return {
        id: row._id,
        number: row.number,
        status: row.status,
        member: { id: row.userId, name: member?.name ?? '', email: member?.email ?? null, phone: member?.phone ?? null },
        items: row.items.length,
        firstItem: row.items[0]?.title ?? null,
        total: row.total,
        payable: row.payable,
        coinsUsed: row.coinsUsed ?? 0,
        coinsValue: row.coinsValue ?? 0,
        /** Null unless every line was coins-only, in which case these are the price. */
        inCoins: row.inCoins ?? null,
        payment: { method: row.payment?.method ?? null, status: row.payment?.status ?? null, paidAt: iso(row.payment?.paidAt) },
        trackingRef: row.trackingRef ?? null,
        city: (row.addressSnapshot as { city?: string } | undefined)?.city ?? null,
        placedAt: iso(row.placedAt),
      };
    }),
    nextCursor: null,
  };
}

// ─── Moving it along ───────────────────────────────────────────────────────

export const advanceBody = z
  .object({
    status: z.enum(STATUSES),
    /** The courier's reference. Settable at any step, usually with `shipped`. */
    trackingRef: z.string().trim().max(80).nullable().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type AdvanceBody = z.infer<typeof advanceBody>;

export async function advanceOrder(actor: string, orderId: string, body: AdvanceBody) {
  const order = await OrderModel.findById(orderId);
  if (!order) throw Errors.notFound('That order');

  const from = order.status as Status;
  if (body.status === from) {
    // Nothing to say and nothing to write: an operator pressing the step the
    // order is already on has not made a mistake worth an error.
    if (body.trackingRef !== undefined) {
      order.trackingRef = body.trackingRef;
      await order.save();
    }
    return { id: order._id, status: order.status, trackingRef: order.trackingRef ?? null, moved: false };
  }
  if (!NEXT[from].includes(body.status)) {
    throw Errors.conflict(
      'ORDER_STATUS_NOT_ALLOWED',
      `An order that is ${from} can only go to ${NEXT[from].join(', ') || 'nowhere — it is finished'}.`,
      { from, allowed: NEXT[from] },
    );
  }
  // Cancelling has to put the coins, the stock and the coupon back, which is
  // a different verb — not a status write.
  if (body.status === 'cancelled') {
    throw Errors.conflict('USE_CANCEL', 'Use the cancel action: a cancelled order has coins and stock to give back.', { from });
  }

  order.status = body.status;
  if (body.trackingRef !== undefined) order.trackingRef = body.trackingRef;
  order.events.push({ from, to: body.status, actor: 'admin', at: new Date() });
  await order.save();

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'order.status', subjectType: 'order', subjectId: order._id,
    before: { status: from }, after: { status: body.status, trackingRef: order.trackingRef ?? null, note: body.note ?? null },
  });

  // The member is told the two steps they care about; `confirmed` is ours.
  if (body.status === 'shipped' || body.status === 'delivered') {
    await notify({
      userId: order.userId,
      topic: 'reward',
      preference: 'orders',
      title: body.status === 'shipped' ? 'Your order is on its way' : 'Your order has been delivered',
      message:
        body.status === 'shipped'
          ? `${order.items[0]?.title ?? 'Your order'} has left us${order.trackingRef ? ` — tracking ${order.trackingRef}` : ''}.`
          : `${order.items[0]?.title ?? 'Your order'} has arrived. Enjoy it.`,
      dedupeKey: `order-${body.status}:${order._id}`,
    });
  }

  return { id: order._id, status: order.status, trackingRef: order.trackingRef ?? null, moved: true };
}

// ─── Undoing it ────────────────────────────────────────────────────────────

export const cancelBody = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

/** The member's own cancel, asked for by an operator — see `cancelOrderAsOperator`. */
export async function cancelOrder(actor: string, orderId: string, reason: string) {
  const order = await OrderModel.findById(orderId, { userId: 1, status: 1 }).lean();
  if (!order) throw Errors.notFound('That order');
  const result = await cancelOrderAsOperator(orderId, order.userId, actor, reason);
  return {
    id: orderId,
    status: result.order.status,
    already: result.already,
    coinsReturned: result.order.coinsUsed,
    balance: result.balance,
    payment: result.order.payment.status,
  };
}

export const refundBody = z
  .object({
    reason: z.string().trim().min(3).max(300),
    /** Leave out for the whole payment; paise, never more than was taken. */
    amount: z.number().int().min(1).optional(),
  })
  .strict();
export type RefundBody = z.infer<typeof refundBody>;

/**
 * Puts a finished order's money and coins back.
 *
 * Not a cancel: a delivered order's stock is gone, the coupon was used, and
 * pretending otherwise would put a unit back on the shelf that is in
 * somebody's house. So this is the narrow verb — the coins go back as a new
 * ledger row (RULES E2), the gateway is asked for the money, and the order
 * ends at `refunded`.
 *
 * A gateway that refuses leaves the order refunded with the payment still
 * marked paid, exactly as the member's cancel does: that mismatch is what
 * support looks for, and hiding it would be worse than the refund failing.
 */
export async function refundOrder(actor: string, orderId: string, body: RefundBody) {
  const order = await OrderModel.findById(orderId).lean();
  if (!order) throw Errors.notFound('That order');
  if (order.status === 'refunded') throw Errors.conflict('ALREADY_REFUNDED', 'That order has already been refunded.');
  if (order.status === 'cancelled') {
    throw Errors.conflict('ALREADY_CANCELLED', 'That order was cancelled, which already put the coins and the money back.');
  }
  const paidWithMoney = order.payment?.status === 'paid' && (order.payment?.amount ?? 0) > 0;
  if (!paidWithMoney && (order.coinsUsed ?? 0) === 0) {
    throw Errors.conflict('NOTHING_TO_REFUND', 'Nothing was ever taken for that order.');
  }
  const refundable = order.payment?.amount ?? 0;
  if (body.amount && body.amount > refundable) {
    throw Errors.validation({ amount: `The payment was ${refundable} paise; a refund cannot be more than that.` });
  }

  const coinsMc = toMilli(order.coinsUsed ?? 0);
  const result = await withTransaction(async session => {
    let ledgerId: string | null = null;
    let balanceMc = 0;
    if (coinsMc > 0) {
      ledgerId = newId('led');
      await CoinLedgerModel.create(
        [
          {
            _id: ledgerId,
            userId: order.userId,
            amountMc: coinsMc,
            source: 'refund',
            title: `Order refunded — ${order.items[0]?.title ?? 'item'}`,
            referenceType: 'order_refund',
            referenceId: order._id,
            actor,
          },
        ],
        { session },
      );
      const balance = await CoinBalanceModel.findOneAndUpdate(
        { _id: order.userId },
        { $inc: { balanceMc: coinsMc } },
        { session, new: true, upsert: true },
      ).lean();
      balanceMc = balance?.balanceMc ?? 0;
    } else {
      const balance = await CoinBalanceModel.findById(order.userId).session(session).lean();
      balanceMc = balance?.balanceMc ?? 0;
    }
    await OrderModel.updateOne(
      { _id: orderId },
      {
        $set: { status: 'refunded', ...(ledgerId ? { refundLedgerId: ledgerId } : {}) },
        $push: { events: { from: order.status, to: 'refunded', actor: 'admin', at: new Date() } },
      },
      { session },
    );
    return { ledgerId, balance: toCoins(balanceMc) };
  });

  let money: 'refunded' | 'failed' | 'none' = 'none';
  if (paidWithMoney && order.payment?.providerPaymentId) {
    money = await refundGatewayPayment({
      providerPaymentId: order.payment.providerPaymentId,
      amountPaise: body.amount ?? refundable,
    });
    if (money === 'refunded') {
      await OrderModel.updateOne({ _id: orderId }, { $set: { 'payment.status': 'refunded', 'payment.refundedAt': new Date() } });
    } else {
      logger.error({ orderId, paymentId: order.payment.providerPaymentId }, 'admin.refund_failed');
    }
  }

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'order.refunded', subjectType: 'order', subjectId: orderId,
    before: { status: order.status, paymentStatus: order.payment?.status ?? null },
    after: { status: 'refunded', money, coins: order.coinsUsed ?? 0, amount: body.amount ?? refundable, reason: body.reason },
  });

  await notify({
    userId: order.userId,
    topic: 'reward',
    preference: 'orders',
    title: 'Your order has been refunded',
    message: [
      (order.coinsUsed ?? 0) > 0 ? `${order.coinsUsed} coins are back in your wallet` : '',
      money === 'refunded' ? 'the payment is on its way back to you' : '',
    ]
      .filter(Boolean)
      .join(', and ') || 'We have put it right.',
    dedupeKey: `order-refunded:${orderId}`,
  });

  return {
    id: orderId,
    status: 'refunded' as const,
    coinsReturned: order.coinsUsed ?? 0,
    balance: result.balance,
    money,
    amount: body.amount ?? refundable,
  };
}

// ─── Fixing the address ────────────────────────────────────────────────────

export const addressBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    phone: z.string().trim().min(5).max(20).optional(),
    line1: z.string().trim().min(1).max(160).optional(),
    line2: z.string().trim().max(160).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    state: z.string().trim().min(1).max(80).optional(),
    postalCode: z.string().trim().min(3).max(12).optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict()
  .refine(body => Object.keys(body).some(key => key !== 'reason'), 'Change something');
export type AddressBody = z.infer<typeof addressBody>;

/**
 * Corrects the address an order is going to.
 *
 * The order carries a **snapshot**, not a reference to the member's address
 * book (RULES R4), which is why this patches the snapshot: fixing the book
 * would change where the next order goes and leave this one on its way to
 * the wrong flat. The member's own route swaps in another saved address
 * instead; this is the one for a typo, which is the support case.
 *
 * Only while the parcel has not left — past `confirmed` the address on the
 * label is already printed, and changing the row would make the record lie.
 */
export async function setOrderAddress(actor: string, orderId: string, body: AddressBody) {
  const order = await OrderModel.findById(orderId).lean();
  if (!order) throw Errors.notFound('That order');
  if (!ADDRESS_FIXABLE.includes(order.status as Status)) {
    throw Errors.conflict(
      'ADDRESS_NOT_CHANGEABLE',
      `An order that is ${order.status} has already gone — its address cannot be changed.`,
      { status: order.status },
    );
  }

  const { reason, ...patch } = body;
  const before = (order.addressSnapshot ?? {}) as Record<string, unknown>;
  const after = { ...before, ...patch };
  await OrderModel.updateOne({ _id: orderId }, { $set: { addressSnapshot: after } });

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'order.address', subjectType: 'order', subjectId: orderId,
    before, after: { ...patch, reason },
  });

  await notify({
    userId: order.userId,
    topic: 'reward',
    preference: 'orders',
    title: 'Delivery address updated',
    message: `We have corrected the address on ${order.number}. It is going to ${after.line1 ?? ''}, ${after.city ?? ''}.`,
    dedupeKey: `order-address:${orderId}:${Date.now()}`,
  });

  return { id: orderId, address: after };
}

/** Stock is the other half of an order going wrong — put one unit back or take one off. */
export const stockBody = z
  .object({
    onHand: z.number().int().min(0).max(1_000_000),
    lowStockAt: z.number().int().min(0).max(10_000).optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export type StockBody = z.infer<typeof stockBody>;

export async function setStock(actor: string, itemId: string, body: StockBody) {
  const before = await ShopInventoryModel.findById(itemId).lean();
  await ShopInventoryModel.updateOne(
    { _id: itemId },
    { $set: { onHand: body.onHand, ...(body.lowStockAt !== undefined ? { lowStockAt: body.lowStockAt } : {}) } },
    { upsert: true },
  );
  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'shop.stock', subjectType: 'shop_item', subjectId: itemId,
    before: { onHand: before?.onHand ?? null, lowStockAt: before?.lowStockAt ?? null },
    after: { onHand: body.onHand, lowStockAt: body.lowStockAt ?? before?.lowStockAt ?? 5, reason: body.reason },
  });
  const after = await ShopInventoryModel.findById(itemId).lean();
  return { itemId, onHand: after?.onHand ?? 0, lowStockAt: after?.lowStockAt ?? 5 };
}
