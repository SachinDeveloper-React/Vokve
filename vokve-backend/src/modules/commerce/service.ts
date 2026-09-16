import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { withTransaction } from '../../db/mongo.js';
import { getKV } from '../../db/redis.js';
import { toCoins, toMilli } from '../../lib/coins.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { STEP_UP_TTL_SECONDS, verifyStepUpToken } from '../../lib/tokens.js';
import {
  addressSchema,
  orderSchema,
  shopItemSchema,
  type Address,
  type Order,
  type OrderStatus,
  type ShopCategory,
  type ShopItem,
} from '../../contracts/index.js';
import { CoinBalanceModel, CoinLedgerModel } from '../economy/models.js';
import { notify } from '../notifications/service.js';
import { AuditLogModel } from '../platform/models.js';
import { AddressModel, OrderModel, ShopInventoryModel, ShopItemModel } from './models.js';

// ─── Catalogue ─────────────────────────────────────────────────────────────

type ItemRow = { _id: string; title: string; description: string; priceCoins: number; category: string; emoji: string; badge: string | null; isDeal: boolean };

function toItem(row: ItemRow, onHand: number): ShopItem {
  return shopItemSchema.parse({
    id: row._id, title: row.title, description: row.description, priceCoins: row.priceCoins, category: row.category,
    emoji: row.emoji, badge: row.badge, isDeal: row.isDeal, inStock: onHand > 0,
  });
}

/** `inStock` is the inventory's `onHand > 0` (RULES R8), joined here rather than denormalised. */
export async function listItems(filter: { category?: ShopCategory; deals?: boolean } = {}): Promise<ShopItem[]> {
  const query: Record<string, unknown> = { active: true };
  if (filter.category) query.category = filter.category;
  if (filter.deals) query.isDeal = true;
  const [rows, stock] = await Promise.all([
    ShopItemModel.find(query).sort({ sort: 1, _id: 1 }).lean(),
    ShopInventoryModel.find({}, { onHand: 1 }).lean(),
  ]);
  const onHand = new Map(stock.map(s => [s._id, s.onHand]));
  return rows.map(row => toItem(row as ItemRow, onHand.get(row._id) ?? 0));
}

export async function getItem(id: string): Promise<ShopItem> {
  const [row, stock] = await Promise.all([ShopItemModel.findOne({ _id: id, active: true }).lean(), ShopInventoryModel.findById(id).lean()]);
  if (!row) throw Errors.notFound('That reward');
  return toItem(row as ItemRow, stock?.onHand ?? 0);
}

// ─── Addresses ─────────────────────────────────────────────────────────────

export const addressBody = addressSchema.omit({ id: true }).strict();
export type AddressBody = z.infer<typeof addressBody>;

type AddressRow = { _id: string; label: string; name: string; phone: string; line1: string; line2: string; city: string; state: string; postalCode: string; country: string; isDefault: boolean };

function toAddress(row: AddressRow): Address {
  return addressSchema.parse({
    id: row._id, label: row.label, name: row.name, phone: row.phone, line1: row.line1, line2: row.line2,
    city: row.city, state: row.state, postalCode: row.postalCode, country: row.country, isDefault: row.isDefault,
  });
}

/** Default first, then newest — the order the picker shows them in. */
export async function listAddresses(userId: string): Promise<Address[]> {
  const rows = await AddressModel.find({ userId, deletedAt: null }).sort({ isDefault: -1, createdAt: -1 }).lean();
  return rows.map(r => toAddress(r as AddressRow));
}

/** The first address is the default whatever the body says: a book with one entry has no other candidate. */
export async function createAddress(userId: string, body: AddressBody): Promise<Address> {
  const count = await AddressModel.countDocuments({ userId, deletedAt: null });
  const isDefault = count === 0 || body.isDefault;
  if (isDefault) await AddressModel.updateMany({ userId, isDefault: true }, { $set: { isDefault: false } });
  const row = await AddressModel.create({ _id: newId('adr'), userId, ...body, isDefault });
  return toAddress(row.toObject() as AddressRow);
}

export async function updateAddress(userId: string, id: string, body: Partial<AddressBody>): Promise<Address> {
  const existing = await AddressModel.findOne({ _id: id, userId, deletedAt: null });
  if (!existing) throw Errors.notFound('That address');
  if (body.isDefault) await AddressModel.updateMany({ userId, isDefault: true, _id: { $ne: id } }, { $set: { isDefault: false } });
  // The default can be moved to another address but never switched off in
  // place: the book must always have one for redemption to ship to.
  const isDefault = existing.isDefault || (body.isDefault ?? false);
  Object.assign(existing, { ...body, isDefault });
  await existing.save();
  return toAddress(existing.toObject() as AddressRow);
}

export async function setDefaultAddress(userId: string, id: string): Promise<Address> {
  return updateAddress(userId, id, { isDefault: true });
}

/** Soft delete. If it was the default, the newest survivor takes over so redemption keeps a target. */
export async function deleteAddress(userId: string, id: string): Promise<void> {
  const row = await AddressModel.findOneAndUpdate({ _id: id, userId, deletedAt: null }, { $set: { deletedAt: new Date(), isDefault: false } });
  if (!row) throw Errors.notFound('That address');
  if (row.isDefault) {
    const next = await AddressModel.findOne({ userId, deletedAt: null }).sort({ createdAt: -1 });
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }
}

// ─── Orders ────────────────────────────────────────────────────────────────

const CANCELLABLE: readonly OrderStatus[] = ['placed', 'confirmed'];

type OrderRow = {
  _id: string; status: string; totalCoins: number; placedAt: Date; updatedAt?: Date; trackingRef: string | null;
  items: { itemId: string; title: string; emoji: string; quantity: number; priceCoins: number }[];
  addressSnapshot: Omit<Address, 'id' | 'isDefault'>;
  events?: { at: Date }[];
};

function toOrder(row: OrderRow): Order {
  const lastEvent = row.events?.[row.events.length - 1]?.at ?? row.placedAt;
  return orderSchema.parse({
    id: row._id, status: row.status, items: row.items, totalCoins: row.totalCoins, address: row.addressSnapshot,
    placedAt: row.placedAt.toISOString(), updatedAt: lastEvent.toISOString(), trackingRef: row.trackingRef,
    cancellable: CANCELLABLE.includes(row.status as OrderStatus),
  });
}

export async function listOrders(userId: string, cursor: string | undefined, limit = 20) {
  const filter: Record<string, unknown> = { userId };
  if (cursor) filter._id = { $lt: cursor }; // uuid v7 ids sort by time
  const rows = await OrderModel.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const page = rows.slice(0, limit);
  return { data: page.map(r => toOrder(r as unknown as OrderRow)), nextCursor: rows.length > limit ? page[page.length - 1]._id : null };
}

export async function getOrder(userId: string, id: string): Promise<Order> {
  const row = await OrderModel.findOne({ _id: id, userId }).lean();
  if (!row) throw Errors.notFound('That order');
  return toOrder(row as unknown as OrderRow);
}

/** How many orders the shop's header counts (RULES R7). */
export async function countOrders(userId: string): Promise<number> {
  return OrderModel.countDocuments({ userId });
}

export interface RedeemInput {
  userId: string;
  itemId: string;
  quantity: number;
  addressId: string;
  /** The step-up proof, when the price asks for one. */
  stepUpToken?: string;
  idempotencyKey?: string;
  trustTier?: string;
  deviceId?: string;
  appVersion?: string;
}

/** The tiers that may redeem at all, and the ones that must step up to (RULES T5). */
const RESTRICTED_TIERS = new Set(['restricted', 'banned']);
const STEP_UP_TIERS = new Set(['watch']);

/**
 * Spends coins on a reward (BACKEND §8.5, RULES R2–R4, T5, O8).
 *
 * The gates run first, outside the transaction, in the order a user can fix
 * them: the tier (nothing to do but appeal), the address (add one), the
 * step-up (enter a code). Then one transaction: the balance is decremented
 * with a `$gte` filter — the overspend guard — the stock with another, the
 * order and its ledger row are written, and any of the four failing rolls
 * back the rest. The ledger's unique reference makes a retried request find
 * its own row rather than pay twice; the idempotency middleware in front of
 * the route replays the whole response before this is even reached.
 */
export async function redeem(input: RedeemInput): Promise<{ order: Order; balance: number }> {
  const config = await getConfig();

  const tier = input.trustTier ?? 'normal';
  if (!config.trust.shadow && RESTRICTED_TIERS.has(tier)) {
    throw Errors.forbidden('REDEMPTION_RESTRICTED', 'Redemptions are paused on your account. Contact support to appeal.');
  }

  const item = await ShopItemModel.findOne({ _id: input.itemId, active: true }).lean();
  if (!item) throw Errors.notFound('That reward');
  const total = item.priceCoins * input.quantity;

  const address = await AddressModel.findOne({ _id: input.addressId, userId: input.userId, deletedAt: null }).lean();
  if (!address) throw new ApiError(422, 'ADDRESS_REQUIRED', 'Add a shipping address to redeem rewards.', { addressId: input.addressId });

  const needsStepUp = total >= config.coins.stepUpThreshold || (!config.trust.shadow && STEP_UP_TIERS.has(tier));
  if (needsStepUp) await consumeStepUp(input.userId, input.stepUpToken, config.coins.stepUpThreshold);

  const orderId = newId('ord');
  const snapshot = { label: address.label, name: address.name, phone: address.phone, line1: address.line1, line2: address.line2, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country };
  const totalMc = toMilli(total);

  const result = await withTransaction(async session => {
    const bal = await CoinBalanceModel.findOneAndUpdate(
      { _id: input.userId, balanceMc: { $gte: totalMc } },
      { $inc: { balanceMc: -totalMc } },
      { session, new: true },
    ).lean();
    if (!bal) {
      const current = await CoinBalanceModel.findById(input.userId).session(session).lean();
      const balance = toCoins(current?.balanceMc ?? 0);
      throw new ApiError(422, 'INSUFFICIENT_COINS', `You need ${total - balance} more coins for this.`, { required: total, balance });
    }
    const stock = await ShopInventoryModel.findOneAndUpdate(
      { _id: item._id, onHand: { $gte: input.quantity } },
      { $inc: { onHand: -input.quantity } },
      { session, new: true },
    ).lean();
    if (!stock) throw new ApiError(409, 'OUT_OF_STOCK', `${item.title} is sold out.`, { itemId: item._id });

    const ledgerId = newId('led');
    await CoinLedgerModel.create([{
      _id: ledgerId, userId: input.userId, amountMc: -totalMc, source: 'purchase', title: item.title,
      referenceType: 'order', referenceId: orderId, idempotencyKey: input.idempotencyKey ?? null,
      actor: 'user', deviceId: input.deviceId, appVersion: input.appVersion,
    }], { session });
    const [order] = await OrderModel.create([{
      _id: orderId, userId: input.userId, status: 'placed', totalCoins: total,
      items: [{ itemId: item._id, title: item.title, emoji: item.emoji, quantity: input.quantity, priceCoins: item.priceCoins }],
      addressSnapshot: snapshot, addressId: address._id, ledgerId,
      events: [{ from: null, to: 'placed', actor: 'user', at: new Date() }],
    }], { session });
    await AuditLogModel.create([{
      actorType: 'user', actorId: input.userId, deviceId: input.deviceId, action: 'order.placed',
      subjectType: 'order', subjectId: orderId, after: { itemId: item._id, quantity: input.quantity, totalCoins: total },
    }], { session });
    if (stock.onHand <= stock.lowStockAt) logger.warn({ itemId: item._id, onHand: stock.onHand }, 'commerce.low_stock');
    return { order: toOrder(order.toObject() as unknown as OrderRow), balance: toCoins(bal.balanceMc) };
  });

  await notify({
    userId: input.userId, topic: 'reward', preference: 'orders',
    title: 'Order placed',
    message: `${item.title} is on its way to ${snapshot.name}. ${total} coins were deducted.`,
    dedupeKey: `order-placed:${orderId}`,
  });
  return result;
}

/**
 * Checks and burns a step-up token (RULES O8): signed by us, for this user,
 * not yet used. The `jti` goes into the KV for the token's own lifetime, so
 * a replay inside the window is refused and nothing needs cleaning up after.
 */
async function consumeStepUp(userId: string, token: string | undefined, threshold: number): Promise<void> {
  const details = { threshold };
  if (!token) throw Errors.forbidden('STEP_UP_REQUIRED', 'Confirm it is you to redeem this reward.');
  const claims = verifyStepUpToken(token);
  if (!claims || claims.sub !== userId) throw new ApiError(403, 'STEP_UP_INVALID', 'That confirmation has expired. Please confirm again.', details);
  const fresh = await getKV().setIfAbsent(`stepup:${claims.jti}`, STEP_UP_TTL_SECONDS);
  if (!fresh) throw new ApiError(403, 'STEP_UP_INVALID', 'That confirmation was already used. Please confirm again.', details);
}

/**
 * Cancels while the order is still ours to stop (RULES R5, R6): one
 * transaction puts the coins back as a `refund` row, restores the stock and
 * records the transition. A second cancel finds the order already cancelled
 * and returns it unchanged rather than refunding twice.
 */
export async function cancelOrder(userId: string, id: string, deviceId?: string): Promise<{ order: Order; balance: number }> {
  const result = await withTransaction(async session => {
    const order = await OrderModel.findOne({ _id: id, userId }).session(session);
    if (!order) throw Errors.notFound('That order');
    if (order.status === 'cancelled') {
      const bal = await CoinBalanceModel.findById(userId).session(session).lean();
      return { order: toOrder(order.toObject() as unknown as OrderRow), balance: toCoins(bal?.balanceMc ?? 0), already: true };
    }
    if (!CANCELLABLE.includes(order.status as OrderStatus)) {
      throw Errors.conflict('ORDER_NOT_CANCELLABLE', `An order that is ${order.status} can no longer be cancelled.`, { status: order.status });
    }

    const totalMc = toMilli(order.totalCoins);
    const refundId = newId('led');
    await CoinLedgerModel.create([{
      _id: refundId, userId, amountMc: totalMc, source: 'refund', title: `Order cancelled — ${order.items[0]?.title ?? 'reward'}`,
      referenceType: 'order_cancel', referenceId: order._id, actor: 'user', deviceId,
    }], { session });
    const bal = await CoinBalanceModel.findOneAndUpdate({ _id: userId }, { $inc: { balanceMc: totalMc } }, { session, new: true, upsert: true }).lean();
    for (const line of order.items) {
      await ShopInventoryModel.updateOne({ _id: line.itemId }, { $inc: { onHand: line.quantity } }, { session });
    }
    const from = order.status;
    order.status = 'cancelled';
    order.refundLedgerId = refundId;
    order.events.push({ from, to: 'cancelled', actor: 'user', at: new Date() });
    await order.save({ session });
    await AuditLogModel.create([{ actorType: 'user', actorId: userId, deviceId, action: 'order.cancelled', subjectType: 'order', subjectId: order._id, before: { status: from }, after: { status: 'cancelled' } }], { session });
    return { order: toOrder(order.toObject() as unknown as OrderRow), balance: toCoins(bal?.balanceMc ?? 0), already: false };
  });

  if (!result.already) {
    await notify({
      userId, topic: 'reward', preference: 'orders',
      title: 'Order cancelled',
      message: `${result.order.totalCoins} coins are back in your wallet.`,
      dedupeKey: `order-cancelled:${id}`,
    });
  }
  return { order: result.order, balance: result.balance };
}
