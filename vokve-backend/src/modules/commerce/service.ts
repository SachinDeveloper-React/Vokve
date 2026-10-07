import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { withTransaction } from '../../db/mongo.js';
import { getKV } from '../../db/redis.js';
import { toCoins, toMilli } from '../../lib/coins.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import {
  createGatewayOrder, knownMethods, methodsForOrder, offeredMethods, paymentKeyId, paymentProvider, refundGatewayPayment, spendsCoins, verifyPaymentProof,
  type PaymentMethod, type PaymentProof,
} from '../../lib/payments.js';
import { STEP_UP_TTL_SECONDS, verifyStepUpToken } from '../../lib/tokens.js';
import { isWhatsAppUsable, sendWhatsApp } from '../../lib/whatsapp.js';
import {
  addressSchema,
  cartSchema,
  checkoutResultSchema,
  deliveryPreferencesSchema,
  orderSchema,
  quoteSchema,
  reviewPageSchema,
  reviewSchema,
  shopCategorySchema,
  shopCategorySummarySchema,
  shopConfigSchema,
  shopItemSchema,
  type Address,
  type AppliedCoupon,
  type Cart,
  type CheckoutResult,
  type DeliveryPreferences,
  type Order,
  type PaymentMode,
  type TrackingChannel,
  type OrderStatus,
  type PurchaseLine,
  type Quote,
  type Review,
  type ReviewPage,
  type ShopCategory,
  type ShopCategorySummary,
  type ShopConfig,
  type ShopItem,
  type ShopSort,
} from '../../contracts/index.js';
import { CoinBalanceModel, CoinLedgerModel } from '../economy/models.js';
import { UserModel } from '../identity/models.js';
import { notify } from '../notifications/service.js';
import { AuditLogModel } from '../platform/models.js';
import {
  AddressModel, CartModel, CouponModel, CouponUsageModel, DeliveryPreferencesModel, OrderModel, ReviewModel, ShopInventoryModel, ShopItemModel,
  WishlistModel,
} from './models.js';

// ─── Config ────────────────────────────────────────────────────────────────

type CommerceConfig = Awaited<ReturnType<typeof getConfig>>['commerce'] & { stepUpThreshold: number };

async function commerceConfig(): Promise<CommerceConfig> {
  const config = await getConfig();
  return { ...config.commerce, stepUpThreshold: config.coins.stepUpThreshold };
}

/**
 * The share of the goods coins must and may cover, as the mode means it:
 * all of it in a coins-only shop, none in a money-only one, and the two
 * ⚙ shares in a mixed one.
 */
function sharesOf(cfg: CommerceConfig): { min: number; max: number } {
  if (cfg.paymentMode === 'coins') return { min: 1, max: 1 };
  if (cfg.paymentMode === 'money') return { min: 0, max: 0 };
  return { min: cfg.coinShareMin, max: cfg.coinShareMax };
}

/** The till's rules, for the app (RULES R11–R13, R16). The shares are the ones the mode puts in force. */
export async function shopConfig(): Promise<ShopConfig> {
  const cfg = await commerceConfig();
  const shares = sharesOf(cfg);
  return shopConfigSchema.parse({
    currency: cfg.currency,
    coinValuePaise: cfg.coinValuePaise,
    paymentMode: cfg.paymentMode,
    coinShareMin: shares.min,
    coinShareMax: shares.max,
    shippingFeePaise: cfg.shippingFeePaise,
    freeShippingAbovePaise: cfg.freeShippingAbovePaise,
    maxQuantityPerLine: cfg.maxQuantityPerLine,
    paymentProvider: paymentProvider(),
    paymentKeyId: paymentKeyId(),
    paymentMethods: offeredMethods(cfg.paymentMode, cfg.paymentMethods),
    stepUpThreshold: cfg.stepUpThreshold,
    deliveryEstimate: cfg.deliveryEstimate,
    returnPolicy: cfg.returnPolicy,
    couponsEnabled: cfg.couponsEnabled,
    deliveryNotice: cfg.deliveryNotice,
    offersWhatsAppUpdates: offersWhatsApp(cfg),
  });
}

/** WhatsApp updates are offered when the owner allows them and the channel can deliver them (RULES R17). */
function offersWhatsApp(cfg: CommerceConfig): boolean {
  return cfg.whatsappUpdates && isWhatsAppUsable();
}

/**
 * `paise` in whole coins, rounded up: what a thing costs when coins pay
 * all of it. Up, because a coins-only order has no money to make up a
 * shortfall.
 */
function coinsFor(paise: number, cfg: CommerceConfig): number {
  return Math.ceil(paise / cfg.coinValuePaise);
}

/**
 * How one item may be bought (RULES R11): its own setting where it has
 * one, the shop's ⚙ `commerce.paymentMode` where it has none. An item's
 * own mode wins, so a coins-only reward can sit on the same shelf as a
 * money-only one and a shop-wide mode is only the default.
 */
function modeOf(item: { paymentMode?: string | null }, cfg: CommerceConfig): PaymentMode {
  const own = item.paymentMode;
  return own === 'coins' || own === 'money' || own === 'mixed' ? own : cfg.paymentMode;
}

/** The shares a mode puts in force for one line's worth of goods. */
function sharesForMode(mode: PaymentMode, cfg: CommerceConfig): { min: number; max: number } {
  if (mode === 'coins') return { min: 1, max: 1 };
  if (mode === 'money') return { min: 0, max: 0 };
  return { min: cfg.coinShareMin, max: cfg.coinShareMax };
}

/** The most coins that may go towards `paise` worth of goods bought this way. */
function coinsCapFor(paise: number, mode: PaymentMode, cfg: CommerceConfig): number {
  if (mode === 'coins') return coinsFor(paise, cfg);
  if (mode === 'money') return 0;
  return Math.floor((paise * sharesForMode(mode, cfg).max) / cfg.coinValuePaise);
}

/**
 * The least coins `paise` worth of goods must take this way. Rounded down
 * like the cap, so a fixed split (floor = cap) is one figure.
 */
function coinsFloorFor(paise: number, mode: PaymentMode, cfg: CommerceConfig): number {
  if (mode === 'coins') return coinsFor(paise, cfg);
  if (mode === 'money') return 0;
  return Math.min(coinsCapFor(paise, mode, cfg), Math.floor((paise * sharesForMode(mode, cfg).min) / cfg.coinValuePaise));
}

/**
 * Splits `amount` across `weights` in proportion, the last part carrying
 * whatever the rounding left over, so the parts always add back up to the
 * whole. This is how a coupon reaches each line: a line's share of the
 * saving is its share of the bill, and the coins it then takes follow.
 */
function apportion(amount: number, weights: number[]): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0 || amount <= 0) return weights.map(() => 0);
  const parts = weights.map(w => Math.floor((amount * w) / total));
  const given = parts.reduce((sum, part) => sum + part, 0);
  if (parts.length > 0) parts[parts.length - 1] += amount - given;
  return parts;
}

// ─── Catalogue ─────────────────────────────────────────────────────────────

type ItemRow = {
  _id: string; title: string; description: string; price: number; mrp: number | null; category: string; emoji: string; badge: string | null;
  isDeal: boolean; featured: boolean; subcategory: string | null; tags: string[]; sizes: string[]; popularity: number; listedAt: Date; sort: number;
  /** `coins` / `money` / `mixed`, or null to follow the shop (RULES R11). */
  paymentMode?: string | null;
  ratingAverage?: number; ratingCount?: number;
  colors?: { name: string; hex: string }[]; images?: string[]; imageUrl?: string | null; ribbon?: string | null;
  highlights?: { icon: string; label: string; value: string }[]; features?: { icon: string; title: string; caption?: string }[];
  specs?: { icon: string; label: string; value: string }[];
};

function toItem(row: ItemRow, onHand: number, cfg: CommerceConfig): ShopItem {
  const mode = modeOf(row, cfg);
  return shopItemSchema.parse({
    id: row._id, title: row.title, description: row.description, price: row.price, mrp: row.mrp ?? null, currency: cfg.currency,
    coinsMax: coinsCapFor(row.price, mode, cfg), coinsMin: coinsFloorFor(row.price, mode, cfg), coinPrice: coinsFor(row.price, cfg),
    paymentMode: mode, category: row.category,
    emoji: row.emoji, badge: row.badge, isDeal: row.isDeal, inStock: onHand > 0,
    featured: row.featured, subcategory: row.subcategory, tags: row.tags ?? [], sizes: row.sizes ?? [],
    rating: { average: row.ratingAverage ?? 0, count: row.ratingCount ?? 0 },
    images: row.images?.length ? row.images : row.imageUrl ? [row.imageUrl] : [],
    ribbon: row.ribbon ?? null, colors: row.colors ?? [],
    highlights: row.highlights ?? [], features: row.features ?? [], specs: row.specs ?? [],
  });
}

export interface CatalogueQuery {
  category?: ShopCategory;
  subcategory?: string;
  deals?: boolean;
  featured?: boolean;
  /** Free text over title, description, tags and subcategory. */
  q?: string;
  sort?: ShopSort;
  /** Only what can be bought right now. */
  inStock?: boolean;
  /** Paise, inclusive. */
  minPrice?: number;
  maxPrice?: number;
  /** Items rated at least this (1–5); an unrated item never passes. */
  minRating?: number;
  cursor?: string;
  limit?: number;
}

/** The catalogue is small and ordered server-side, so the cursor is simply where the last page ended. */
function offsetOf(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString('utf8').replace(/^offset:/, ''));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
function cursorFor(offset: number): string {
  return Buffer.from(`offset:${offset}`, 'utf8').toString('base64url');
}

const SORTS: Record<ShopSort, Record<string, 1 | -1>> = {
  popular: { popularity: -1, sort: 1, _id: 1 },
  price_asc: { price: 1, sort: 1, _id: 1 },
  price_desc: { price: -1, sort: 1, _id: 1 },
  newest: { listedAt: -1, sort: 1, _id: 1 },
  rating: { ratingAverage: -1, ratingCount: -1, popularity: -1, _id: 1 },
};

/** The words a search matches on, case-folded; a typed "sho" finds "Shorts" because a prefix is a match. */
function searchFilter(q: string): Record<string, unknown> | null {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (words.length === 0) return null;
  // Every word has to land somewhere on the item, in any field.
  return {
    $and: words.map(word => {
      const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      return { $or: [{ title: re }, { description: re }, { tags: re }, { subcategory: re }] };
    }),
  };
}

/**
 * The catalogue, filtered, searched, sorted and paged. `inStock` is the
 * inventory's `onHand > 0` (RULES R8), joined here rather than denormalised —
 * which is why the in-stock filter is applied after the read: stock is the
 * one thing about an item that changes by the minute.
 */
export async function listItems(query: CatalogueQuery = {}): Promise<{ data: ShopItem[]; nextCursor: string | null; total: number }> {
  const filter: Record<string, unknown> = { active: true };
  if (query.category) filter.category = query.category;
  if (query.subcategory) filter.subcategory = query.subcategory;
  if (query.deals) filter.isDeal = true;
  if (query.featured) filter.featured = true;
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    filter.price = {
      ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}),
      ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}),
    };
  }
  if (query.minRating !== undefined) filter.ratingAverage = { $gte: query.minRating };
  const search = query.q ? searchFilter(query.q) : null;
  if (search) Object.assign(filter, search);

  const [cfg, rows, stock] = await Promise.all([
    commerceConfig(),
    ShopItemModel.find(filter).sort(SORTS[query.sort ?? 'popular']).lean(),
    ShopInventoryModel.find({}, { onHand: 1 }).lean(),
  ]);
  const onHand = new Map(stock.map(s => [s._id, s.onHand]));
  let items = rows.map(row => toItem(row as unknown as ItemRow, onHand.get(row._id) ?? 0, cfg));
  if (query.inStock) items = items.filter(item => item.inStock);

  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const offset = offsetOf(query.cursor);
  const page = items.slice(offset, offset + limit);
  const end = offset + page.length;
  return { data: page, nextCursor: end < items.length ? cursorFor(end) : null, total: items.length };
}

/** What each shelf holds, for the home tiles and a category page's chips. */
export async function listCategories(): Promise<ShopCategorySummary[]> {
  const [rows, stock] = await Promise.all([
    ShopItemModel.find({ active: true }, { category: 1, subcategory: 1, sort: 1 }).sort({ sort: 1 }).lean(),
    ShopInventoryModel.find({}, { onHand: 1 }).lean(),
  ]);
  const onHand = new Map(stock.map(s => [s._id, s.onHand]));
  return shopCategorySchema.options.map(category => {
    const mine = rows.filter(r => r.category === category);
    const subcategories: { name: string; count: number }[] = [];
    for (const row of mine) {
      if (!row.subcategory) continue;
      const found = subcategories.find(sc => sc.name === row.subcategory);
      if (found) found.count += 1;
      else subcategories.push({ name: row.subcategory, count: 1 });
    }
    return shopCategorySummarySchema.parse({
      category,
      count: mine.length,
      inStock: mine.filter(r => (onHand.get(r._id) ?? 0) > 0).length,
      subcategories,
    });
  });
}

export async function getItem(id: string): Promise<ShopItem> {
  const [cfg, row, stock] = await Promise.all([
    commerceConfig(), ShopItemModel.findOne({ _id: id, active: true }).lean(), ShopInventoryModel.findById(id).lean(),
  ]);
  if (!row) throw Errors.notFound('That item');
  return toItem(row as unknown as ItemRow, stock?.onHand ?? 0, cfg);
}

/** Several items at once, with stock, in the order asked for; missing ids are skipped. */
async function loadItems(ids: string[], cfg: CommerceConfig): Promise<Map<string, { item: ShopItem; onHand: number; row: ItemRow }>> {
  const unique = [...new Set(ids)];
  const [rows, stock] = await Promise.all([
    ShopItemModel.find({ _id: { $in: unique }, active: true }).lean(),
    ShopInventoryModel.find({ _id: { $in: unique } }, { onHand: 1 }).lean(),
  ]);
  const onHand = new Map(stock.map(s => [s._id, s.onHand]));
  const out = new Map<string, { item: ShopItem; onHand: number; row: ItemRow }>();
  for (const row of rows) {
    const units = onHand.get(row._id) ?? 0;
    out.set(row._id, { item: toItem(row as unknown as ItemRow, units, cfg), onHand: units, row: row as unknown as ItemRow });
  }
  return out;
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
  // place: the book must always have one for an order to ship to.
  const isDefault = existing.isDefault || (body.isDefault ?? false);
  Object.assign(existing, { ...body, isDefault });
  await existing.save();
  return toAddress(existing.toObject() as AddressRow);
}

export async function setDefaultAddress(userId: string, id: string): Promise<Address> {
  return updateAddress(userId, id, { isDefault: true });
}

/** Soft delete. If it was the default, the newest survivor takes over so checkout keeps a target. */
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

// ─── Delivery preferences ──────────────────────────────────────────────────

type DeliveryRow = { instructions?: string; whatsappUpdates?: boolean; leaveAtDoor?: boolean };

/** The member's delivery preferences (RULES R17), or the defaults — nothing asked for. */
export async function getDeliveryPreferences(userId: string): Promise<DeliveryPreferences> {
  const row = (await DeliveryPreferencesModel.findById(userId).lean()) as DeliveryRow | null;
  return deliveryPreferencesSchema.parse({
    instructions: row?.instructions ?? '', whatsappUpdates: row?.whatsappUpdates ?? false, leaveAtDoor: row?.leaveAtDoor ?? false,
  });
}

export const deliveryPreferencesBody = z.object({
  instructions: z.string().trim().max(120).optional(),
  whatsappUpdates: z.boolean().optional(),
  leaveAtDoor: z.boolean().optional(),
}).strict();
export type DeliveryPreferencesBody = z.infer<typeof deliveryPreferencesBody>;

/**
 * Settles what an order — or the saved defaults — asks for: the member's
 * saved preferences with `patch` over them, the instructions trimmed, and
 * WhatsApp updates only where they are offered, so nothing records a
 * promise the server cannot keep.
 */
async function resolveDelivery(userId: string, patch: DeliveryPreferencesBody | undefined, cfg: CommerceConfig): Promise<DeliveryPreferences> {
  const asked = { ...(await getDeliveryPreferences(userId)), ...patch };
  return deliveryPreferencesSchema.parse({
    instructions: asked.instructions.trim(),
    whatsappUpdates: asked.whatsappUpdates && offersWhatsApp(cfg),
    leaveAtDoor: asked.leaveAtDoor,
  });
}

export async function setDeliveryPreferences(userId: string, patch: DeliveryPreferencesBody): Promise<DeliveryPreferences> {
  const next = await resolveDelivery(userId, patch, await commerceConfig());
  await DeliveryPreferencesModel.updateOne({ _id: userId }, { $set: next }, { upsert: true });
  return next;
}

/**
 * Tells the member about their order: in the app, and by WhatsApp too when
 * the order asked for it and the channel can deliver. A WhatsApp failure is
 * logged and never undoes what the order already did.
 */
async function notifyOrder(
  order: { userId: string; delivery?: { whatsappUpdates?: boolean } | null },
  note: { title: string; message: string; dedupeKey: string },
): Promise<void> {
  await notify({ userId: order.userId, topic: 'reward', preference: 'orders', ...note });
  if (!order.delivery?.whatsappUpdates || !isWhatsAppUsable()) return;
  try {
    const user = await UserModel.findById(order.userId, { phone: 1 }).lean();
    if (user?.phone) await sendWhatsApp(user.phone, `${note.title}: ${note.message}`);
  } catch (err) {
    logger.warn({ err, dedupeKey: note.dedupeKey }, 'commerce.whatsapp_failed');
  }
}

// ─── Wishlist ──────────────────────────────────────────────────────────────

/** Saved items, newest save first, with stock and price as they are now. */
export async function listWishlist(userId: string): Promise<ShopItem[]> {
  const rows = await WishlistModel.find({ userId }).sort({ addedAt: -1 }).lean();
  const cfg = await commerceConfig();
  const items = await loadItems(rows.map(r => r.itemId), cfg);
  return rows.flatMap(r => {
    const found = items.get(r.itemId);
    return found ? [found.item] : [];
  });
}

export async function wishlistIds(userId: string): Promise<string[]> {
  const rows = await WishlistModel.find({ userId }, { itemId: 1 }).sort({ addedAt: -1 }).lean();
  return rows.map(r => r.itemId);
}

/** Saving twice is one save: the key is the pair. */
export async function addToWishlist(userId: string, itemId: string): Promise<void> {
  const exists = await ShopItemModel.exists({ _id: itemId, active: true });
  if (!exists) throw Errors.notFound('That item');
  await WishlistModel.updateOne({ _id: `${userId}:${itemId}` }, { $setOnInsert: { userId, itemId, addedAt: new Date() } }, { upsert: true });
}

export async function removeFromWishlist(userId: string, itemId: string): Promise<void> {
  await WishlistModel.deleteOne({ _id: `${userId}:${itemId}` });
}

// ─── Reviews ───────────────────────────────────────────────────────────────

export const reviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(80).optional().nullable(),
  body: z.string().trim().min(10, 'Say a little more — at least ten characters.').max(1000),
}).strict();
export type ReviewBody = z.infer<typeof reviewBody>;

export type ReviewSort = 'recent' | 'top';

type ReviewRow = { _id: string; itemId: string; userId: string; authorName: string; rating: number; title: string | null; body: string; verified: boolean; createdAt: Date; updatedAt: Date };

function toReview(row: ReviewRow, readerId: string | null): Review {
  return reviewSchema.parse({
    id: row._id, itemId: row.itemId, rating: row.rating, title: row.title ?? null, body: row.body, authorName: row.authorName,
    verified: row.verified, mine: row.userId === readerId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  });
}

const REVIEW_SORTS: Record<ReviewSort, Record<string, 1 | -1>> = {
  recent: { createdAt: -1, _id: -1 },
  top: { rating: -1, createdAt: -1, _id: -1 },
};

/** The stars, how many, and how they fall — one aggregate, for the item's summary and the page's histogram. */
async function summarise(itemId: string): Promise<{ average: number; count: number; histogram: number[] }> {
  const groups = await ReviewModel.aggregate<{ _id: number; n: number }>([{ $match: { itemId } }, { $group: { _id: '$rating', n: { $sum: 1 } } }]);
  const histogram = [0, 0, 0, 0, 0];
  let count = 0;
  let sum = 0;
  for (const g of groups) {
    histogram[g._id - 1] = g.n;
    count += g.n;
    sum += g._id * g.n;
  }
  return { average: count === 0 ? 0 : Math.round((sum / count) * 10) / 10, count, histogram };
}

/** Writes the summary onto the item, so lists and sorts never touch `reviews` (RULES R15). */
async function recomputeRating(itemId: string): Promise<void> {
  const { average, count } = await summarise(itemId);
  await ShopItemModel.updateOne({ _id: itemId }, { $set: { ratingAverage: average, ratingCount: count } });
}

export async function listReviews(itemId: string, readerId: string | null, sort: ReviewSort = 'recent', cursor?: string, limit = 10): Promise<ReviewPage> {
  const exists = await ShopItemModel.exists({ _id: itemId, active: true });
  if (!exists) throw Errors.notFound('That item');
  const offset = offsetOf(cursor);
  const [rows, summary, mine] = await Promise.all([
    ReviewModel.find({ itemId }).sort(REVIEW_SORTS[sort]).skip(offset).limit(limit + 1).lean(),
    summarise(itemId),
    readerId ? ReviewModel.findOne({ itemId, userId: readerId }).lean() : null,
  ]);
  const page = rows.slice(0, limit);
  return reviewPageSchema.parse({
    data: page.map(r => toReview(r as unknown as ReviewRow, readerId)),
    nextCursor: rows.length > limit ? cursorFor(offset + limit) : null,
    summary,
    mine: mine ? toReview(mine as unknown as ReviewRow, readerId) : null,
  });
}

/** What a review is signed with: a first name, never the account. */
async function authorNameFor(userId: string): Promise<string> {
  const user = await UserModel.findById(userId, { name: 1 }).lean();
  const first = (user?.name ?? '').trim().split(/\s+/)[0];
  return first ? first : 'A VOKVE member';
}

const BOUGHT_STATUSES: readonly OrderStatus[] = ['placed', 'confirmed', 'shipped', 'delivered'];

/**
 * Creates the reader's review of an item, or replaces it — one per user per
 * item, so a change of mind is an edit rather than a second voice. Whether
 * they bought it is decided now, from their orders, and kept.
 */
export async function upsertReview(userId: string, itemId: string, body: ReviewBody): Promise<Review> {
  const exists = await ShopItemModel.exists({ _id: itemId, active: true });
  if (!exists) throw Errors.notFound('That item');
  const [authorName, bought] = await Promise.all([
    authorNameFor(userId),
    OrderModel.exists({ userId, 'items.itemId': itemId, status: { $in: BOUGHT_STATUSES } }),
  ]);
  const row = await ReviewModel.findOneAndUpdate(
    { itemId, userId },
    { $set: { rating: body.rating, title: body.title || null, body: body.body, authorName, verified: Boolean(bought) }, $setOnInsert: { _id: newId('rev') } },
    { upsert: true, new: true },
  ).lean();
  await recomputeRating(itemId);
  return toReview(row as unknown as ReviewRow, userId);
}

export async function deleteReview(userId: string, itemId: string): Promise<void> {
  const gone = await ReviewModel.deleteOne({ itemId, userId });
  if (gone.deletedCount === 0) throw Errors.notFound('Your review');
  await recomputeRating(itemId);
}

// ─── Quote ─────────────────────────────────────────────────────────────────

/** A line as the till sees it: the catalogue row it points at, checked and priced. */
interface PricedLine {
  item: ShopItem;
  row: ItemRow;
  onHand: number;
  quantity: number;
  size: string | null;
  color: string | null;
}

/**
 * Turns requested lines into priced ones: the item must exist and be on
 * sale, the quantity within the per-line cap, and a sized or coloured item
 * must name one of its sizes or colours. Two lines for the same item, size
 * and colour are merged.
 */
async function priceLines(lines: PurchaseLine[], cfg: CommerceConfig): Promise<PricedLine[]> {
  if (lines.length === 0) return [];
  const items = await loadItems(lines.map(l => l.itemId), cfg);
  const merged = new Map<string, PricedLine>();
  for (const line of lines) {
    const found = items.get(line.itemId);
    if (!found) throw new ApiError(404, 'ITEM_UNAVAILABLE', 'One of the items is no longer available.', { itemId: line.itemId });
    const { item } = found;
    let size: string | null = null;
    if (item.sizes.length > 0) {
      if (!line.size) throw new ApiError(422, 'SIZE_REQUIRED', `Pick a size for ${item.title}.`, { itemId: item.id, sizes: item.sizes });
      if (!item.sizes.includes(line.size)) throw new ApiError(422, 'SIZE_INVALID', `${item.title} does not come in ${line.size}.`, { itemId: item.id, sizes: item.sizes });
      size = line.size;
    }
    let color: string | null = null;
    if (item.colors.length > 0) {
      const names = item.colors.map(c => c.name);
      if (!line.color) throw new ApiError(422, 'COLOR_REQUIRED', `Pick a colour for ${item.title}.`, { itemId: item.id, colors: names });
      if (!names.includes(line.color)) throw new ApiError(422, 'COLOR_INVALID', `${item.title} does not come in ${line.color}.`, { itemId: item.id, colors: names });
      color = line.color;
    }
    const key = `${item.id}:${size ?? ''}:${color ?? ''}`;
    const existing = merged.get(key);
    const quantity = (existing?.quantity ?? 0) + line.quantity;
    if (quantity > cfg.maxQuantityPerLine) {
      throw new ApiError(422, 'QUANTITY_LIMIT', `You can order up to ${cfg.maxQuantityPerLine} of ${item.title} at a time.`, { itemId: item.id, max: cfg.maxQuantityPerLine });
    }
    merged.set(key, { item, row: found.row, onHand: found.onHand, quantity, size, color });
  }
  return [...merged.values()];
}

// ─── Coupons ───────────────────────────────────────────────────────────────

/** What the member typed, as a code is stored: trimmed, upper-case. */
export function normaliseCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

/** A sum as the member reads it in this shop: rupees, or coins in a coins-only one. */
function amountWords(paise: number, cfg: CommerceConfig): string {
  if (cfg.paymentMode === 'coins') return `${coinsFor(paise, cfg).toLocaleString('en-IN')} coins`;
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const subtotalOf = (lines: { item: { price: number }; quantity: number }[]) =>
  lines.reduce((sum, l) => sum + l.item.price * l.quantity, 0);

type CouponRow = {
  _id: string; title: string; kind: 'percent' | 'flat'; value: number; maxDiscount: number | null; minSubtotal: number;
  startsAt: Date | null; endsAt: Date | null; maxRedemptions: number | null; redemptions: number; perUserLimit: number; active: boolean;
};

interface CouponCheck {
  /** The coupon as a quote shows it; `problem` set when it takes nothing off. */
  applied: AppliedCoupon;
  /** The 422 code a checkout or an apply refuses with; null when it applies. */
  errorCode: string | null;
  row: CouponRow | null;
}

/**
 * Whether `code` takes anything off `subtotal` paise of goods for this
 * member, and how much (RULES R16): it must exist and be active, inside its
 * dates, not fully claimed, under the member's own limit, and the goods
 * must reach its minimum. A percent coupon is rounded down and capped; no
 * coupon takes more than the goods.
 */
async function checkCoupon(code: string, userId: string, subtotal: number, cfg: CommerceConfig): Promise<CouponCheck> {
  const [row, usage] = await Promise.all([
    CouponModel.findById(code).lean() as Promise<CouponRow | null>,
    CouponUsageModel.findById(`${code}:${userId}`).lean(),
  ]);
  const refuse = (errorCode: string, problem: string): CouponCheck =>
    ({ applied: { code, title: row?.title ?? code, discount: 0, problem }, errorCode, row });
  const now = Date.now();
  if (!row || !row.active) return refuse('COUPON_INVALID', "That code isn't valid.");
  if (row.startsAt && row.startsAt.getTime() > now) return refuse('COUPON_NOT_STARTED', 'This coupon is not open yet.');
  if (row.endsAt && row.endsAt.getTime() <= now) return refuse('COUPON_EXPIRED', 'This coupon has expired.');
  if (row.maxRedemptions !== null && row.redemptions >= row.maxRedemptions) return refuse('COUPON_USED_UP', 'This coupon has been fully claimed.');
  if ((usage?.count ?? 0) >= row.perUserLimit) {
    return refuse('COUPON_ALREADY_USED', row.perUserLimit === 1 ? "You've already used this coupon." : `You've used this coupon ${row.perUserLimit} times already.`);
  }
  if (subtotal < row.minSubtotal) return refuse('COUPON_MIN_ORDER', `Add ${amountWords(row.minSubtotal - subtotal, cfg)} more to use ${code}.`);
  const off = row.kind === 'percent' ? Math.floor((subtotal * row.value) / 100) : row.value;
  const discount = Math.min(subtotal, row.maxDiscount === null ? off : Math.min(off, row.maxDiscount));
  return { applied: { code, title: row.title, discount, problem: null }, errorCode: null, row };
}

/** How many whole coins the wallet holds — the till never spends a fraction. */
async function wholeCoins(userId: string): Promise<number> {
  const bal = await CoinBalanceModel.findById(userId).lean();
  return Math.floor(toCoins(bal?.balanceMc ?? 0));
}

/** `'max'` asks for as many coins as the order and the wallet allow. */
export type CoinsRequest = number | 'max';

/**
 * The till's arithmetic (RULES R11–R13, R16). The coupon comes off the
 * goods first, shipping is decided on what is left, and then each line's
 * own mode says what coins it takes: a coins-only line takes its whole
 * (discounted) price in coins, a money-only line none, and a mixed one
 * between the share floor and the share cap. The order's floor and cap
 * are those added up, so a basket holding all three kinds is quoted
 * correctly rather than being forced into one mode.
 *
 * An order whose every line is coins-only is read in coins throughout —
 * delivery too — and the rows the app draws add up to what is taken. The
 * wallet clamps the most coins, never the least: a wallet short of the
 * floor is reported as `coinsShort`, and the order cannot be placed.
 */
function buildQuote(lines: PricedLine[], balance: number, coins: CoinsRequest, cfg: CommerceConfig, coupon: AppliedCoupon | null = null): Quote {
  const subtotal = subtotalOf(lines);
  const mrpTotal = lines.reduce((sum, l) => sum + (l.item.mrp ?? l.item.price) * l.quantity, 0);
  const couponOff = coupon && !coupon.problem ? Math.min(coupon.discount, subtotal) : 0;
  const goods = subtotal - couponOff;
  const shipping = lines.length === 0 || (cfg.freeShippingAbovePaise !== null && goods >= cfg.freeShippingAbovePaise) ? 0 : cfg.shippingFeePaise;
  const total = goods + shipping;

  // The coupon reaches each line in proportion to what it costs, so the
  // coins a line then takes are of the price actually paid for it.
  const offPerLine = apportion(couponOff, lines.map(l => l.item.price * l.quantity));
  const perLine = lines.map((l, index) => ({
    mode: modeOf(l.item, cfg),
    goods: l.item.price * l.quantity - offPerLine[index],
  }));
  // Delivery is paid in coins only where there is no money side at all.
  const allCoins = perLine.length > 0 && perLine.every(l => l.mode === 'coins');

  let floor: number;
  let cap: number;
  let inCoins: Quote['inCoins'] = null;
  if (allCoins) {
    const goodsCoins = lines.reduce((sum, l) => sum + coinsFor(l.item.price, cfg) * l.quantity, 0);
    const discountCoins = Math.min(goodsCoins, Math.floor(couponOff / cfg.coinValuePaise));
    const shippingCoins = coinsFor(shipping, cfg);
    const totalCoins = goodsCoins - discountCoins + shippingCoins;
    inCoins = { goods: goodsCoins, discount: discountCoins, shipping: shippingCoins, total: totalCoins };
    floor = cap = totalCoins;
  } else {
    cap = perLine.reduce((sum, l) => sum + coinsCapFor(l.goods, l.mode, cfg), 0);
    floor = perLine.reduce((sum, l) => sum + coinsFloorFor(l.goods, l.mode, cfg), 0);
    // Never take more coins than the bill is worth: a big coupon can leave
    // a coins-only line's rounded-up price above what is still owed.
    cap = Math.min(cap, Math.ceil(total / cfg.coinValuePaise));
    floor = Math.min(floor, cap);
  }
  const coinsMax = Math.max(0, Math.min(cap, balance));
  const coinsShort = Math.max(0, floor - balance);
  const coinsApplied = coinsShort > 0 ? floor : coins === 'max' ? coinsMax : Math.max(floor, Math.min(Math.floor(coins), coinsMax));
  const coinsValue = coinsApplied * cfg.coinValuePaise;
  return quoteSchema.parse({
    currency: cfg.currency,
    paymentMode: perLine.length === 0 ? cfg.paymentMode : allCoins ? 'coins' : perLine.every(l => l.mode === 'money') ? 'money' : 'mixed',
    lines: lines.map(l => ({
      itemId: l.item.id, title: l.item.title, emoji: l.item.emoji, image: l.item.images[0] ?? null, quantity: l.quantity, size: l.size, color: l.color,
      price: l.item.price, mrp: l.item.mrp, lineTotal: l.item.price * l.quantity,
      coinPrice: coinsFor(l.item.price, cfg), lineCoins: coinsFor(l.item.price, cfg) * l.quantity,
      paymentMode: modeOf(l.item, cfg), inStock: l.onHand >= l.quantity,
    })),
    mrpTotal, discount: mrpTotal - subtotal, subtotal,
    coupon: coupon ? { ...coupon, discount: couponOff } : null,
    shipping, total,
    coinValuePaise: cfg.coinValuePaise, coinsMax, coinsMin: floor, coinsShort, coinsApplied, coinsValue,
    paymentMethods: methodsForOrder(cfg.paymentMethods, { coinsMin: floor, coinsMax, total, coinValuePaise: cfg.coinValuePaise }),
    // A coins-only order rounds its coins up, so they can be worth a few paise more than the total.
    payable: Math.max(0, total - coinsValue),
    needsStepUp: coinsApplied > 0 && coinsApplied >= cfg.stepUpThreshold,
    inCoins,
  });
}

/**
 * The till's arithmetic for some lines, with no side effects (RULES R11–R13,
 * R16). A coupon that does not apply is quoted with its `problem` rather
 * than refused, so the screen can say why.
 */
export async function quote(userId: string, lines: PurchaseLine[], coins: CoinsRequest = 'max', couponCode: string | null = null): Promise<Quote> {
  const cfg = await commerceConfig();
  const [priced, balance] = await Promise.all([priceLines(lines, cfg), wholeCoins(userId)]);
  const coupon = cfg.couponsEnabled && couponCode
    ? (await checkCoupon(normaliseCouponCode(couponCode), userId, subtotalOf(priced), cfg)).applied
    : null;
  return buildQuote(priced, balance, coins, cfg, coupon);
}

// ─── Cart ──────────────────────────────────────────────────────────────────

type CartRow = { lines: { itemId: string; quantity: number; size: string | null; color?: string | null; addedAt: Date }[]; couponCode?: string | null };

/**
 * The basket with its items and a quote at the most coins allowed (RULES
 * R14). A line whose item has since gone off sale is dropped — and the
 * drop written back — rather than shown as an error the user cannot fix.
 * The coupon, if one was applied, is quoted with it (R16).
 */
export async function getCart(userId: string): Promise<Cart> {
  const cfg = await commerceConfig();
  const doc = (await CartModel.findById(userId).lean()) as CartRow | null;
  const lines = doc?.lines ?? [];
  const items = await loadItems(lines.map(l => l.itemId), cfg);
  const kept = lines.filter(l => items.has(l.itemId));
  if (kept.length !== lines.length) {
    await CartModel.updateOne({ _id: userId }, { $set: { lines: kept } });
  }
  const priced = kept.map(l => {
    const found = items.get(l.itemId)!;
    return { item: found.item, row: found.row, onHand: found.onHand, quantity: l.quantity, size: l.size, color: l.color ?? null };
  });
  const balance = await wholeCoins(userId);
  const code = cfg.couponsEnabled ? doc?.couponCode ?? null : null;
  const coupon = code ? (await checkCoupon(code, userId, subtotalOf(priced), cfg)).applied : null;
  return cartSchema.parse({
    lines: kept.map(l => ({ item: items.get(l.itemId)!.item, quantity: l.quantity, size: l.size, color: l.color ?? null, addedAt: l.addedAt.toISOString() })),
    count: kept.reduce((sum, l) => sum + l.quantity, 0),
    quote: buildQuote(priced, balance, 'max', cfg, coupon),
  });
}

/**
 * Sets a line's quantity — adding it if new, removing it at zero. The line
 * is keyed by item, size and colour, so a medium and a large of the same
 * tee are two lines, as they are two things to pack.
 */
export async function setCartLine(userId: string, line: { itemId: string; quantity: number; size?: string | null; color?: string | null }): Promise<Cart> {
  const cfg = await commerceConfig();
  const doc = (await CartModel.findById(userId).lean()) as CartRow | null;
  const lines = [...(doc?.lines ?? [])];
  if (line.quantity > 0) {
    // Price it alone to run the same checks a checkout would — size, colour, cap, existence.
    const [priced] = await priceLines([{ itemId: line.itemId, quantity: line.quantity, size: line.size ?? null, color: line.color ?? null }], cfg);
    const index = lines.findIndex(l => l.itemId === priced.item.id && (l.size ?? null) === priced.size && (l.color ?? null) === priced.color);
    if (index >= 0) lines[index] = { ...lines[index], quantity: priced.quantity };
    else lines.push({ itemId: priced.item.id, quantity: priced.quantity, size: priced.size, color: priced.color, addedAt: new Date() });
  } else {
    const size = line.size ?? null;
    const color = line.color ?? null;
    const index = lines.findIndex(l => l.itemId === line.itemId && (l.size ?? null) === size && (l.color ?? null) === color);
    if (index >= 0) lines.splice(index, 1);
  }
  await CartModel.updateOne({ _id: userId }, { $set: { lines } }, { upsert: true });
  return getCart(userId);
}

export async function removeCartLine(userId: string, itemId: string, size: string | null, color: string | null = null): Promise<Cart> {
  return setCartLine(userId, { itemId, quantity: 0, size, color });
}

export async function clearCart(userId: string): Promise<Cart> {
  await CartModel.updateOne({ _id: userId }, { $set: { lines: [], couponCode: null } }, { upsert: true });
  return getCart(userId);
}

/**
 * Puts a coupon on the basket (RULES R16) — only one that applies to it
 * now, so a typo or a minimum not yet reached is answered at once with the
 * reason (`422 COUPON_*`) instead of sitting on the basket doing nothing.
 * One coupon at a time: a second replaces the first.
 */
export async function applyCoupon(userId: string, rawCode: string): Promise<Cart> {
  const cfg = await commerceConfig();
  if (!cfg.couponsEnabled) throw new ApiError(422, 'COUPONS_DISABLED', 'Coupons are not available right now.');
  const code = normaliseCouponCode(rawCode);
  const cart = await getCart(userId);
  if (cart.lines.length === 0) throw new ApiError(422, 'CART_EMPTY', 'Add something to your cart before applying a coupon.');
  const check = await checkCoupon(code, userId, cart.quote.subtotal, cfg);
  if (check.errorCode) {
    throw new ApiError(422, check.errorCode, check.applied.problem ?? "That code isn't valid.", {
      code, ...(check.errorCode === 'COUPON_MIN_ORDER' && check.row ? { minSubtotal: check.row.minSubtotal } : {}),
    });
  }
  await CartModel.updateOne({ _id: userId }, { $set: { couponCode: code } }, { upsert: true });
  return getCart(userId);
}

export async function removeCoupon(userId: string): Promise<Cart> {
  await CartModel.updateOne({ _id: userId }, { $set: { couponCode: null } }, { upsert: true });
  return getCart(userId);
}

// ─── Orders ────────────────────────────────────────────────────────────────

const CANCELLABLE: readonly OrderStatus[] = ['pending_payment', 'placed', 'confirmed'];

type OrderRow = {
  _id: string; number: string; userId: string; status: string;
  estimatedDelivery?: { from: Date; to: Date } | null; currency: string; subtotal: number; discount: number; shipping: number; total: number;
  coinsUsed: number; coinsValue: number; payable: number;
  payment: { provider: string | null; method?: PaymentMethod | null; status: string; amount: number; currency: string; providerOrderId: string | null; providerPaymentId: string | null; paidAt: Date | null; expiresAt: Date | null };
  placedAt: Date; updatedAt?: Date; trackingRef: string | null;
  items: { itemId: string; title: string; emoji: string; quantity: number; size: string | null; color?: string | null; price: number; mrp: number | null }[];
  addressSnapshot: Omit<Address, 'id' | 'isDefault'>;
  events?: { at: Date }[];
  coupon?: { code: string; title: string; discount: number } | null;
  inCoins?: Quote['inCoins'];
  delivery?: DeliveryPreferences | null;
};

function toOrder(row: OrderRow): Order {
  const lastEvent = row.events?.[row.events.length - 1]?.at ?? row.placedAt;
  return orderSchema.parse({
    id: row._id, number: row.number, status: row.status, items: row.items, currency: row.currency,
    subtotal: row.subtotal, discount: row.discount, shipping: row.shipping, total: row.total,
    coupon: row.coupon ?? null, inCoins: row.inCoins ?? null,
    coinsUsed: row.coinsUsed, coinsValue: row.coinsValue, payable: row.payable,
    payment: {
      provider: row.payment.provider, method: row.payment.method ?? null, status: row.payment.status, amount: row.payment.amount, currency: row.payment.currency,
      providerOrderId: row.payment.providerOrderId, paidAt: row.payment.paidAt?.toISOString() ?? null, expiresAt: row.payment.expiresAt?.toISOString() ?? null,
    },
    address: row.addressSnapshot,
    delivery: row.delivery ?? null,
    estimatedDelivery: row.estimatedDelivery
      ? { from: row.estimatedDelivery.from.toISOString(), to: row.estimatedDelivery.to.toISOString() }
      : null,
    trackingChannels: trackingChannelsFor((row.delivery as DeliveryPreferences | null) ?? null),
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

/** How many orders the shop's header counts (RULES R7) — an unpaid one is not yet an order. */
export async function countOrders(userId: string): Promise<number> {
  return OrderModel.countDocuments({ userId, status: { $ne: 'pending_payment' } });
}

// ─── Checkout ──────────────────────────────────────────────────────────────

export interface CheckoutInput {
  userId: string;
  /** The lines to buy, or `fromCart` to buy the basket. */
  lines?: PurchaseLine[];
  fromCart?: boolean;
  addressId: string;
  /** The coins to put towards it; the quote said how many may, and how many must. */
  coins: number;
  /**
   * The coupon the member saw taking money off (RULES R16). Sent only then:
   * a coupon the quote showed not applying is left out, and one that stops
   * applying in between is refused rather than quietly charged without.
   */
  couponCode?: string | null;
  /** How the member wants it handed over (RULES R17); their saved preferences fill what is left out. */
  delivery?: DeliveryPreferencesBody;
  /**
   * How the member chose to pay on the payment page (RULES R12). Left out
   * by an older client, which is read as "whatever the coins and the bill
   * come to" — the way the till worked before the page existed.
   */
  paymentMethod?: PaymentMethod;
  /** The step-up proof, when the coins ask for one. */
  stepUpToken?: string;
  idempotencyKey?: string;
  trustTier?: string;
  deviceId?: string;
  appVersion?: string;
}

/** The tiers that may buy at all, and the ones that must step up to (RULES T5). */
const RESTRICTED_TIERS = new Set(['restricted', 'banned']);
const STEP_UP_TIERS = new Set(['watch']);

/** What the ledger row is called: the one item, or the first and a count. */
function orderTitle(lines: { item: { title: string } }[]): string {
  const [first] = lines;
  if (!first) return 'Order';
  return lines.length > 1 ? `${first.item.title} + ${lines.length - 1} more` : first.item.title;
}

/**
 * Places an order (BACKEND §8.5, RULES R2–R4, R11–R13, R16, T5, O8).
 *
 * The gates run first, outside the transaction, in the order a user can fix
 * them: the tier (nothing to do but appeal), the address (add one), the
 * coupon (remove it), the quote (a size, a quantity, a wallet short of what
 * the mode asks, coins outside the floor and the limit), the step-up (enter
 * a code). Then one transaction: the coupon is claimed — from the pool, and
 * against the member's own limit — the coins part is taken with a `$gte`
 * filter — the overspend guard — the stock with another per line, the
 * order is written, the basket lines and coupon it came from are cleared,
 * and any step failing rolls back the rest. An order that still owes money is born
 * `pending_payment` with its stock and coins held for the payment window;
 * one the coins covered is `placed` at once.
 *
 * The gateway order is created after the transaction, because it is a
 * network call to someone else and a transaction that waits on one is a
 * lock held for as long as they take. If it fails, the order is released
 * again before the error is returned.
 */
/**
 * Checks the method the payment page offered is one this shop takes and
 * one this order can be paid by (RULES R12).
 *
 * The method and the coins have to agree: "Pay with Coins" is only honest
 * when the coins clear the whole bill, "Coins + UPI / Card" only when they
 * cover part of it and something is left, and a gateway-only method only
 * when the order takes no coins at all. The page works these out from the
 * same quote, so a refusal here means the quote moved underneath it — a
 * price change, a coupon running out — and the member is told to look
 * again rather than charged a way they did not pick.
 *
 * A request with no method is the older client, and is read from the sums.
 */
/**
 * The reference a member reads out to support: `VKV` + the day + four
 * digits — `VKV2609191234`. Short enough to say down a phone line, which
 * a uuid is not; the order's `_id` is still what everything keys on.
 *
 * The suffix is checked against the day's orders rather than trusted to
 * chance: four digits collide about half the time inside a year at even a
 * modest daily volume, and two orders answering to one number is the sort
 * of thing support discovers at the worst moment. Six digits on the (never
 * seen) day that every attempt collides.
 */
async function nextOrderNumber(placedAt: Date): Promise<string> {
  const day = [
    String(placedAt.getFullYear() % 100).padStart(2, '0'),
    String(placedAt.getMonth() + 1).padStart(2, '0'),
    String(placedAt.getDate()).padStart(2, '0'),
  ].join('');
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `VKV${day}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;
    if (!(await OrderModel.exists({ number: candidate }))) return candidate;
  }
  return `VKV${day}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
}

/** When the courier should have it: the day it was placed plus the ⚙ window. */
function deliveryWindowFrom(placedAt: Date, cfg: CommerceConfig): { from: Date; to: Date } {
  const day = (days: number) => new Date(placedAt.getTime() + days * 86_400_000);
  const min = Math.max(0, cfg.deliveryDaysMin);
  return { from: day(min), to: day(Math.max(min, cfg.deliveryDaysMax)) };
}

/**
 * Where this order's news can actually be sent (RULES R17). Email always,
 * because that is the channel that works; WhatsApp only where the member
 * asked for it *and* a provider can deliver it. SMS is never listed —
 * there is no provider (D-31), and promising one would be a lie on the
 * confirmation screen.
 */
function trackingChannelsFor(delivery: DeliveryPreferences | null): TrackingChannel[] {
  const channels: TrackingChannel[] = ['email'];
  if (delivery?.whatsappUpdates && isWhatsAppUsable()) channels.push('whatsapp');
  return channels;
}

function resolveMethod(chosen: PaymentMethod | undefined, q: Quote, cfg: CommerceConfig): PaymentMethod | null {
  // Two different refusals: one for a way this shop does not take at all,
  // one for a way this particular order is not the shape for. `q.paymentMethods`
  // is what the payment page listed, so it settles what an older client meant.
  const menu = knownMethods(cfg.paymentMethods);
  if (!chosen) {
    if (q.paymentMethods.length === 0) return null;
    const implied: PaymentMethod = q.payable === 0 ? 'coins' : q.coinsApplied > 0 ? 'coins_upi' : 'upi';
    return q.paymentMethods.includes(implied) ? implied : q.paymentMethods[0];
  }
  if (!menu.includes(chosen)) {
    throw new ApiError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'That way of paying is not available right now.', { method: chosen, offered: q.paymentMethods });
  }
  const wrong = (message: string) =>
    new ApiError(422, 'PAYMENT_METHOD_MISMATCH', message, { method: chosen, coins: q.coinsApplied, payable: q.payable });
  if (chosen === 'coins' && q.payable > 0) {
    throw wrong('Your coins do not cover this order. Pick coins with UPI or a card.');
  }
  if (chosen === 'coins_upi' && (q.coinsApplied === 0 || q.payable === 0)) {
    throw wrong('This order is not part coins and part money. Pick another way to pay.');
  }
  if (!spendsCoins(chosen) && q.coinsApplied > 0) {
    throw wrong('This order is set to spend coins. Pick a way to pay that uses them.');
  }
  if (!spendsCoins(chosen) && q.payable === 0) {
    throw wrong('There is nothing left to pay for this order.');
  }
  return chosen;
}

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const cfg = await commerceConfig();
  const config = await getConfig();

  const tier = input.trustTier ?? 'normal';
  if (!config.trust.shadow && RESTRICTED_TIERS.has(tier)) {
    throw Errors.forbidden('PURCHASES_RESTRICTED', 'Purchases are paused on your account. Contact support to appeal.');
  }

  const address = await AddressModel.findOne({ _id: input.addressId, userId: input.userId, deletedAt: null }).lean();
  if (!address) throw new ApiError(422, 'ADDRESS_REQUIRED', 'Add a delivery address to place an order.', { addressId: input.addressId });

  let requested: PurchaseLine[] = input.lines ?? [];
  if (input.fromCart) {
    const cart = (await CartModel.findById(input.userId).lean()) as CartRow | null;
    requested = (cart?.lines ?? []).map(l => ({ itemId: l.itemId, quantity: l.quantity, size: l.size ?? null, color: l.color ?? null }));
  }
  if (requested.length === 0) throw new ApiError(422, 'CART_EMPTY', 'There is nothing to order yet.');

  const couponCode = input.couponCode ? normaliseCouponCode(input.couponCode) : null;
  if (couponCode && !cfg.couponsEnabled) {
    throw new ApiError(422, 'COUPONS_DISABLED', 'Coupons are not available right now.', { code: couponCode });
  }
  const priced = await priceLines(requested, cfg);
  const balance = await wholeCoins(input.userId);
  const coupon = couponCode ? await checkCoupon(couponCode, input.userId, subtotalOf(priced), cfg) : null;
  if (coupon?.errorCode) {
    throw new ApiError(422, coupon.errorCode, coupon.applied.problem ?? "That code isn't valid.", { code: couponCode });
  }
  const q = buildQuote(priced, balance, input.coins, cfg, coupon?.applied ?? null);
  if (q.coinsShort > 0) {
    throw new ApiError(422, 'INSUFFICIENT_COINS', `You have ${balance} coins; this order needs ${q.coinsMin}.`, { required: q.coinsMin, balance });
  }
  if (input.coins > q.coinsMax) {
    throw new ApiError(422, 'COINS_OVER_LIMIT', `Up to ${q.coinsMax} coins can go towards this order.`, { coinsMax: q.coinsMax, requested: input.coins });
  }
  if (input.coins < q.coinsMin) {
    throw new ApiError(422, 'COINS_UNDER_MINIMUM',
      q.paymentMode === 'coins' ? `This order takes ${q.coinsMin} coins.` : `At least ${q.coinsMin} coins must go towards this order.`,
      { coinsMin: q.coinsMin, requested: input.coins });
  }
  const soldOut = q.lines.find(l => !l.inStock);
  if (soldOut) throw new ApiError(409, 'OUT_OF_STOCK', `${soldOut.title} is sold out.`, { itemId: soldOut.itemId });

  const paymentMethod = resolveMethod(input.paymentMethod, q, cfg);

  const needsStepUp = q.needsStepUp || (!config.trust.shadow && STEP_UP_TIERS.has(tier));
  if (needsStepUp) await consumeStepUp(input.userId, input.stepUpToken, cfg.stepUpThreshold);

  const orderId = newId('ord');
  const now = new Date();
  const number = await nextOrderNumber(now);
  const window = deliveryWindowFrom(now, cfg);
  const snapshot = { label: address.label, name: address.name, phone: address.phone, line1: address.line1, line2: address.line2, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country };
  const coinsMc = toMilli(q.coinsApplied);
  const pending = q.payable > 0;
  const status: OrderStatus = pending ? 'pending_payment' : 'placed';
  const expiresAt = pending ? new Date(now.getTime() + cfg.paymentWindowMinutes * 60_000) : null;
  const title = orderTitle(priced);
  const delivery = await resolveDelivery(input.userId, input.delivery, cfg);
  // The member's usage row exists before the transaction, so the claim
  // inside it is a conditional update two racing orders contend on.
  if (coupon) {
    await CouponUsageModel.updateOne(
      { _id: `${coupon.applied.code}:${input.userId}` },
      { $setOnInsert: { code: coupon.applied.code, userId: input.userId, count: 0 } },
      { upsert: true },
    );
  }

  const result = await withTransaction(async session => {
    let balanceMc = toMilli(balance);
    let ledgerId: string | null = null;
    if (coupon) {
      const code = coupon.applied.code;
      const claimed = await CouponModel.updateOne(
        { _id: code, active: true, $or: [{ maxRedemptions: null }, { $expr: { $lt: ['$redemptions', '$maxRedemptions'] } }] },
        { $inc: { redemptions: 1 } },
        { session },
      );
      if (claimed.modifiedCount === 0) throw new ApiError(422, 'COUPON_USED_UP', 'This coupon has just been fully claimed.', { code });
      const used = await CouponUsageModel.updateOne(
        { _id: `${code}:${input.userId}`, count: { $lt: coupon.row!.perUserLimit } },
        { $inc: { count: 1 } },
        { session },
      );
      if (used.modifiedCount === 0) throw new ApiError(422, 'COUPON_ALREADY_USED', "You've already used this coupon.", { code });
    }
    if (coinsMc > 0) {
      const bal = await CoinBalanceModel.findOneAndUpdate(
        { _id: input.userId, balanceMc: { $gte: coinsMc } },
        { $inc: { balanceMc: -coinsMc } },
        { session, new: true },
      ).lean();
      if (!bal) {
        const current = await CoinBalanceModel.findById(input.userId).session(session).lean();
        const have = Math.floor(toCoins(current?.balanceMc ?? 0));
        throw new ApiError(422, 'INSUFFICIENT_COINS', `You have ${have} coins; this order asks for ${q.coinsApplied}.`, { required: q.coinsApplied, balance: have });
      }
      balanceMc = bal.balanceMc;
      ledgerId = newId('led');
      await CoinLedgerModel.create([{
        _id: ledgerId, userId: input.userId, amountMc: -coinsMc, source: 'purchase', title,
        referenceType: 'order', referenceId: orderId, idempotencyKey: input.idempotencyKey ?? null,
        actor: 'user', deviceId: input.deviceId, appVersion: input.appVersion,
      }], { session });
    }
    for (const line of priced) {
      const stock = await ShopInventoryModel.findOneAndUpdate(
        { _id: line.item.id, onHand: { $gte: line.quantity } },
        { $inc: { onHand: -line.quantity } },
        { session, new: true },
      ).lean();
      if (!stock) throw new ApiError(409, 'OUT_OF_STOCK', `${line.item.title} is sold out.`, { itemId: line.item.id });
      if (stock.onHand <= stock.lowStockAt) logger.warn({ itemId: line.item.id, onHand: stock.onHand }, 'commerce.low_stock');
      // "Popular" is what sells: one more for this item.
      await ShopItemModel.updateOne({ _id: line.item.id }, { $inc: { popularity: line.quantity } }, { session });
    }
    const [order] = await OrderModel.create([{
      _id: orderId, number, userId: input.userId, status, currency: q.currency,
      estimatedDelivery: { from: window.from, to: window.to },
      subtotal: q.subtotal, discount: q.discount, shipping: q.shipping, total: q.total,
      coinsUsed: q.coinsApplied, coinsValue: q.coinsValue, payable: q.payable,
      coupon: q.coupon ? { code: q.coupon.code, title: q.coupon.title, discount: q.coupon.discount } : null,
      inCoins: q.inCoins,
      delivery,
      payment: {
        provider: pending ? paymentProvider() : null, method: paymentMethod, status: pending ? 'pending' : 'not_required', amount: q.payable, currency: q.currency,
        providerOrderId: null, providerPaymentId: null, paidAt: null, expiresAt,
      },
      items: priced.map(l => ({
        itemId: l.item.id, title: l.item.title, emoji: l.item.emoji, image: l.item.images[0] ?? null, coinPrice: coinsFor(l.item.price, cfg),
        quantity: l.quantity, size: l.size, color: l.color, price: l.item.price, mrp: l.item.mrp,
      })),
      addressSnapshot: snapshot, addressId: address._id, placedAt: now, ledgerId,
      events: [{ from: null, to: status, actor: 'user', at: now }],
    }], { session });
    if (input.fromCart) {
      await CartModel.updateOne({ _id: input.userId }, { $set: { lines: [], couponCode: null } }, { session });
    }
    await AuditLogModel.create([{
      actorType: 'user', actorId: input.userId, deviceId: input.deviceId, action: 'order.created',
      subjectType: 'order', subjectId: orderId,
      after: { status, lines: priced.map(l => ({ itemId: l.item.id, quantity: l.quantity })), coinsUsed: q.coinsApplied, payable: q.payable, coupon: couponCode },
    }], { session });
    return { order: order.toObject() as unknown as OrderRow, balance: toCoins(balanceMc) };
  });

  let payment: CheckoutResult['payment'] = null;
  if (pending) {
    try {
      const gateway = await createGatewayOrder({ orderId, amountPaise: q.payable, currency: q.currency, method: paymentMethod });
      await OrderModel.updateOne({ _id: orderId }, { $set: { 'payment.providerOrderId': gateway.providerOrderId, 'payment.provider': gateway.provider } });
      result.order.payment.providerOrderId = gateway.providerOrderId;
      result.order.payment.provider = gateway.provider;
      payment = { provider: gateway.provider, method: paymentMethod, orderId, providerOrderId: gateway.providerOrderId, amount: q.payable, currency: q.currency, keyId: gateway.keyId, expiresAt: expiresAt!.toISOString() };
    } catch (err) {
      await releaseOrder(orderId, input.userId, 'system', 'payment_unavailable');
      throw err;
    }
  } else {
    await notifyOrder({ userId: input.userId, delivery }, {
      title: 'Order placed',
      message: `${title} is on its way to ${snapshot.name}. ${q.coinsApplied} coins were used.`,
      dedupeKey: `order-placed:${orderId}`,
    });
  }

  return checkoutResultSchema.parse({ order: toOrder(result.order), balance: result.balance, payment });
}

/**
 * Checks and burns a step-up token (RULES O8): signed by us, for this user,
 * not yet used. The `jti` goes into the KV for the token's own lifetime, so
 * a replay inside the window is refused and nothing needs cleaning up after.
 */
async function consumeStepUp(userId: string, token: string | undefined, threshold: number): Promise<void> {
  const details = { threshold };
  if (!token) throw Errors.forbidden('STEP_UP_REQUIRED', 'Confirm it is you to use this many coins.');
  const claims = verifyStepUpToken(token);
  if (!claims || claims.sub !== userId) throw new ApiError(403, 'STEP_UP_INVALID', 'That confirmation has expired. Please confirm again.', details);
  const fresh = await getKV().setIfAbsent(`stepup:${claims.jti}`, STEP_UP_TTL_SECONDS);
  if (!fresh) throw new ApiError(403, 'STEP_UP_INVALID', 'That confirmation was already used. Please confirm again.', details);
}

/**
 * Marks an order paid on the app's proof from the gateway (RULES R12) and
 * moves it to `placed`. Idempotent: an order already paid answers with
 * itself, so a retry after a dropped connection is not a second capture.
 */
export async function payOrder(userId: string, id: string, proof: PaymentProof): Promise<{ order: Order; balance: number }> {
  const order = await OrderModel.findOne({ _id: id, userId });
  if (!order) throw Errors.notFound('That order');
  const balance = toCoins((await CoinBalanceModel.findById(userId).lean())?.balanceMc ?? 0);
  if (order.payment.status === 'paid') return { order: toOrder(order.toObject() as unknown as OrderRow), balance };
  if (order.status !== 'pending_payment') {
    throw Errors.conflict('ORDER_NOT_PENDING', `This order is ${order.status.replace('_', ' ')} and has no payment to take.`, { status: order.status });
  }
  if (order.payment.expiresAt && order.payment.expiresAt.getTime() < Date.now()) {
    await releaseOrder(order._id, userId, 'system', 'payment_expired');
    throw Errors.conflict('PAYMENT_EXPIRED', 'The payment window for this order has closed. Please order again.');
  }
  if (!verifyPaymentProof(order.payment.providerOrderId ?? '', proof)) {
    throw new ApiError(422, 'PAYMENT_INVALID', 'That payment could not be verified.');
  }

  const now = new Date();
  order.payment.status = 'paid';
  order.payment.providerPaymentId = proof.providerPaymentId;
  order.payment.paidAt = now;
  order.status = 'placed';
  order.events.push({ from: 'pending_payment', to: 'placed', actor: 'user', at: now });
  await order.save();
  await AuditLogModel.create({ actorType: 'user', actorId: userId, action: 'order.paid', subjectType: 'order', subjectId: order._id, after: { providerPaymentId: proof.providerPaymentId, amount: order.payment.amount } });

  const first = order.items[0];
  await notifyOrder({ userId, delivery: order.delivery as DeliveryPreferences | null }, {
    title: 'Order placed',
    message: `${first ? (order.items.length > 1 ? `${first.title} + ${order.items.length - 1} more` : first.title) : 'Your order'} is on its way to ${(order.addressSnapshot as { name: string }).name}.`,
    dedupeKey: `order-placed:${order._id}`,
  });
  return { order: toOrder(order.toObject() as unknown as OrderRow), balance };
}

/**
 * Cancels while the order is still ours to stop (RULES R5, R6): one
 * transaction puts the coins back as a `refund` row, restores the stock and
 * records the transition; the money, if any was taken, goes back through
 * the gateway after. A second cancel finds the order already cancelled and
 * returns it unchanged rather than refunding twice.
 */
export async function cancelOrder(userId: string, id: string, deviceId?: string): Promise<{ order: Order; balance: number }> {
  const result = await releaseOrder(id, userId, 'user', 'cancelled', deviceId);
  if (!result.already) {
    await notifyOrder({ userId, delivery: result.order.delivery }, {
      title: 'Order cancelled',
      message: result.order.coinsUsed > 0
        ? `${result.order.coinsUsed} coins are back in your wallet${result.order.payment.status === 'refunded' ? ', and the payment is being refunded' : ''}.`
        : result.order.payment.status === 'refunded' ? 'The payment is being refunded.' : 'Nothing was charged.',
      dedupeKey: `order-cancelled:${id}`,
    });
  }
  return { order: result.order, balance: result.balance };
}

/**
 * The one way an order is undone, whoever asks: the user cancelling, the
 * scheduler timing out an unpaid one, the checkout unwinding after a
 * gateway failure. Coins and stock go back inside a transaction; the money
 * goes back through the gateway afterwards, and a refund the gateway
 * refuses leaves the order cancelled with the payment still marked paid,
 * which is what support looks for.
 */
async function releaseOrder(id: string, userId: string, actor: 'user' | 'system', reason: string, deviceId?: string): Promise<{ order: Order; balance: number; already: boolean }> {
  const result = await withTransaction(async session => {
    const order = await OrderModel.findOne({ _id: id, userId }).session(session);
    if (!order) throw Errors.notFound('That order');
    if (order.status === 'cancelled') {
      const bal = await CoinBalanceModel.findById(userId).session(session).lean();
      return { row: order.toObject() as unknown as OrderRow, balance: toCoins(bal?.balanceMc ?? 0), already: true, paidId: null as string | null };
    }
    if (!CANCELLABLE.includes(order.status as OrderStatus)) {
      throw Errors.conflict('ORDER_NOT_CANCELLABLE', `An order that is ${order.status} can no longer be cancelled.`, { status: order.status });
    }

    let balanceMc: number;
    if (order.coinsUsed > 0) {
      const coinsMc = toMilli(order.coinsUsed);
      const refundId = newId('led');
      await CoinLedgerModel.create([{
        _id: refundId, userId, amountMc: coinsMc, source: 'refund', title: `Order cancelled — ${order.items[0]?.title ?? 'item'}`,
        referenceType: 'order_cancel', referenceId: order._id, actor, deviceId,
      }], { session });
      const bal = await CoinBalanceModel.findOneAndUpdate({ _id: userId }, { $inc: { balanceMc: coinsMc } }, { session, new: true, upsert: true }).lean();
      balanceMc = bal?.balanceMc ?? 0;
      order.refundLedgerId = refundId;
    } else {
      const bal = await CoinBalanceModel.findById(userId).session(session).lean();
      balanceMc = bal?.balanceMc ?? 0;
    }
    for (const line of order.items) {
      await ShopInventoryModel.updateOne({ _id: line.itemId }, { $inc: { onHand: line.quantity } }, { session });
    }
    // The coupon goes back too: to the pool, and to the member's own count.
    const coupon = order.coupon as { code?: string } | null;
    if (coupon?.code) {
      await CouponModel.updateOne({ _id: coupon.code, redemptions: { $gt: 0 } }, { $inc: { redemptions: -1 } }, { session });
      await CouponUsageModel.updateOne({ _id: `${coupon.code}:${userId}`, count: { $gt: 0 } }, { $inc: { count: -1 } }, { session });
    }
    const from = order.status;
    order.status = 'cancelled';
    order.events.push({ from, to: 'cancelled', actor, at: new Date() });
    await order.save({ session });
    await AuditLogModel.create([{ actorType: actor, actorId: actor === 'user' ? userId : 'scheduler', deviceId, action: 'order.cancelled', subjectType: 'order', subjectId: order._id, before: { status: from }, after: { status: 'cancelled', reason } }], { session });
    return { row: order.toObject() as unknown as OrderRow, balance: toCoins(balanceMc), already: false, paidId: order.payment.status === 'paid' ? order.payment.providerPaymentId : null };
  });

  if (!result.already && result.paidId) {
    const outcome = await refundGatewayPayment({ providerPaymentId: result.paidId, amountPaise: result.row.payment.amount });
    if (outcome === 'refunded') {
      await OrderModel.updateOne({ _id: id }, { $set: { 'payment.status': 'refunded', 'payment.refundedAt': new Date() } });
      result.row.payment.status = 'refunded';
    } else {
      logger.error({ orderId: id, paymentId: result.paidId }, 'commerce.refund_failed');
    }
  }
  return { order: toOrder(result.row), balance: result.balance, already: result.already };
}

/**
 * Lets go of orders whose payment window closed without a payment: the
 * stock back on the shelf, the coins back in the wallet. Run by the
 * scheduler; each is released alone, so one that fails does not hold the
 * rest.
 */
export async function expireUnpaidOrders(now = new Date()): Promise<{ released: number }> {
  const rows = await OrderModel.find({ status: 'pending_payment', 'payment.expiresAt': { $lt: now } }, { _id: 1, userId: 1 }).lean();
  let released = 0;
  for (const row of rows) {
    try {
      const result = await releaseOrder(row._id, row.userId, 'system', 'payment_expired');
      if (!result.already) {
        released += 1;
        await notifyOrder({ userId: row.userId, delivery: result.order.delivery }, {
          title: 'Order expired',
          message: 'The payment window closed, so the order was released. Your coins are back in your wallet.',
          dedupeKey: `order-expired:${row._id}`,
        });
      }
    } catch (err) {
      logger.error({ err, orderId: row._id }, 'commerce.expire_failed');
    }
  }
  return { released };
}
