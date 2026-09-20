import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { withTransaction } from '../../db/mongo.js';
import { getKV } from '../../db/redis.js';
import { toCoins, toMilli } from '../../lib/coins.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import {
  createGatewayOrder, paymentKeyId, paymentProvider, refundGatewayPayment, verifyPaymentProof, type PaymentProof,
} from '../../lib/payments.js';
import { STEP_UP_TTL_SECONDS, verifyStepUpToken } from '../../lib/tokens.js';
import {
  addressSchema,
  cartSchema,
  checkoutResultSchema,
  orderSchema,
  quoteSchema,
  reviewPageSchema,
  reviewSchema,
  shopCategorySchema,
  shopCategorySummarySchema,
  shopConfigSchema,
  shopItemSchema,
  type Address,
  type Cart,
  type CheckoutResult,
  type Order,
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
  AddressModel, CartModel, OrderModel, ReviewModel, ShopInventoryModel, ShopItemModel, WishlistModel,
} from './models.js';

// ─── Config ────────────────────────────────────────────────────────────────

type CommerceConfig = Awaited<ReturnType<typeof getConfig>>['commerce'] & { stepUpThreshold: number };

async function commerceConfig(): Promise<CommerceConfig> {
  const config = await getConfig();
  return { ...config.commerce, stepUpThreshold: config.coins.stepUpThreshold };
}

/** The till's rules, for the app (RULES R11–R13). */
export async function shopConfig(): Promise<ShopConfig> {
  const cfg = await commerceConfig();
  return shopConfigSchema.parse({
    currency: cfg.currency,
    coinValuePaise: cfg.coinValuePaise,
    coinShareMax: cfg.coinShareMax,
    shippingFeePaise: cfg.shippingFeePaise,
    freeShippingAbovePaise: cfg.freeShippingAbovePaise,
    maxQuantityPerLine: cfg.maxQuantityPerLine,
    paymentProvider: paymentProvider(),
    paymentKeyId: paymentKeyId(),
    stepUpThreshold: cfg.stepUpThreshold,
  });
}

/** The most coins that may go towards `paise` worth of goods under the share cap. */
function coinsCapFor(paise: number, cfg: CommerceConfig): number {
  return Math.floor((paise * cfg.coinShareMax) / cfg.coinValuePaise);
}

// ─── Catalogue ─────────────────────────────────────────────────────────────

type ItemRow = {
  _id: string; title: string; description: string; price: number; mrp: number | null; category: string; emoji: string; badge: string | null;
  isDeal: boolean; featured: boolean; subcategory: string | null; tags: string[]; sizes: string[]; popularity: number; listedAt: Date; sort: number;
  ratingAverage?: number; ratingCount?: number;
};

function toItem(row: ItemRow, onHand: number, cfg: CommerceConfig): ShopItem {
  return shopItemSchema.parse({
    id: row._id, title: row.title, description: row.description, price: row.price, mrp: row.mrp ?? null, currency: cfg.currency,
    coinsMax: coinsCapFor(row.price, cfg), category: row.category,
    emoji: row.emoji, badge: row.badge, isDeal: row.isDeal, inStock: onHand > 0,
    featured: row.featured, subcategory: row.subcategory, tags: row.tags ?? [], sizes: row.sizes ?? [],
    rating: { average: row.ratingAverage ?? 0, count: row.ratingCount ?? 0 },
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
}

/**
 * Turns requested lines into priced ones: the item must exist and be on
 * sale, the quantity within the per-line cap, and a sized item must name
 * one of its sizes. Two lines for the same item and size are merged.
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
    const key = `${item.id}:${size ?? ''}`;
    const existing = merged.get(key);
    const quantity = (existing?.quantity ?? 0) + line.quantity;
    if (quantity > cfg.maxQuantityPerLine) {
      throw new ApiError(422, 'QUANTITY_LIMIT', `You can order up to ${cfg.maxQuantityPerLine} of ${item.title} at a time.`, { itemId: item.id, max: cfg.maxQuantityPerLine });
    }
    merged.set(key, { item, row: found.row, onHand: found.onHand, quantity, size });
  }
  return [...merged.values()];
}

/** How many whole coins the wallet holds — the till never spends a fraction. */
async function wholeCoins(userId: string): Promise<number> {
  const bal = await CoinBalanceModel.findById(userId).lean();
  return Math.floor(toCoins(bal?.balanceMc ?? 0));
}

/** `'max'` asks for as many coins as the order and the wallet allow. */
export type CoinsRequest = number | 'max';

function buildQuote(lines: PricedLine[], balance: number, coins: CoinsRequest, cfg: CommerceConfig): Quote {
  const subtotal = lines.reduce((sum, l) => sum + l.item.price * l.quantity, 0);
  const mrpTotal = lines.reduce((sum, l) => sum + (l.item.mrp ?? l.item.price) * l.quantity, 0);
  const shipping = lines.length === 0 || (cfg.freeShippingAbovePaise !== null && subtotal >= cfg.freeShippingAbovePaise) ? 0 : cfg.shippingFeePaise;
  const total = subtotal + shipping;
  const coinsMax = Math.max(0, Math.min(coinsCapFor(subtotal, cfg), balance));
  const coinsApplied = coins === 'max' ? coinsMax : Math.max(0, Math.min(Math.floor(coins), coinsMax));
  const coinsValue = coinsApplied * cfg.coinValuePaise;
  return quoteSchema.parse({
    currency: cfg.currency,
    lines: lines.map(l => ({
      itemId: l.item.id, title: l.item.title, emoji: l.item.emoji, quantity: l.quantity, size: l.size,
      price: l.item.price, mrp: l.item.mrp, lineTotal: l.item.price * l.quantity, inStock: l.onHand >= l.quantity,
    })),
    mrpTotal, discount: mrpTotal - subtotal, subtotal, shipping, total,
    coinValuePaise: cfg.coinValuePaise, coinsMax, coinsApplied, coinsValue,
    payable: total - coinsValue,
    needsStepUp: coinsApplied > 0 && coinsApplied >= cfg.stepUpThreshold,
  });
}

/** The till's arithmetic for some lines, with no side effects (RULES R11–R13). */
export async function quote(userId: string, lines: PurchaseLine[], coins: CoinsRequest = 'max'): Promise<Quote> {
  const cfg = await commerceConfig();
  const [priced, balance] = await Promise.all([priceLines(lines, cfg), wholeCoins(userId)]);
  return buildQuote(priced, balance, coins, cfg);
}

// ─── Cart ──────────────────────────────────────────────────────────────────

type CartRow = { lines: { itemId: string; quantity: number; size: string | null; addedAt: Date }[] };

/**
 * The basket with its items and a quote at the most coins allowed (RULES
 * R14). A line whose item has since gone off sale is dropped — and the
 * drop written back — rather than shown as an error the user cannot fix.
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
    return { item: found.item, row: found.row, onHand: found.onHand, quantity: l.quantity, size: l.size };
  });
  const balance = await wholeCoins(userId);
  return cartSchema.parse({
    lines: kept.map(l => ({ item: items.get(l.itemId)!.item, quantity: l.quantity, size: l.size, addedAt: l.addedAt.toISOString() })),
    count: kept.reduce((sum, l) => sum + l.quantity, 0),
    quote: buildQuote(priced, balance, 'max', cfg),
  });
}

/**
 * Sets a line's quantity — adding it if new, removing it at zero. The line
 * is keyed by item and size, so a medium and a large of the same tee are
 * two lines, as they are two things to pack.
 */
export async function setCartLine(userId: string, line: { itemId: string; quantity: number; size?: string | null }): Promise<Cart> {
  const cfg = await commerceConfig();
  const doc = (await CartModel.findById(userId).lean()) as CartRow | null;
  const lines = [...(doc?.lines ?? [])];
  if (line.quantity > 0) {
    // Price it alone to run the same checks a checkout would — size, cap, existence.
    const [priced] = await priceLines([{ itemId: line.itemId, quantity: line.quantity, size: line.size ?? null }], cfg);
    const index = lines.findIndex(l => l.itemId === priced.item.id && (l.size ?? null) === priced.size);
    if (index >= 0) lines[index] = { ...lines[index], quantity: priced.quantity };
    else lines.push({ itemId: priced.item.id, quantity: priced.quantity, size: priced.size, addedAt: new Date() });
  } else {
    const size = line.size ?? null;
    const index = lines.findIndex(l => l.itemId === line.itemId && (l.size ?? null) === size);
    if (index >= 0) lines.splice(index, 1);
  }
  await CartModel.updateOne({ _id: userId }, { $set: { lines } }, { upsert: true });
  return getCart(userId);
}

export async function removeCartLine(userId: string, itemId: string, size: string | null): Promise<Cart> {
  return setCartLine(userId, { itemId, quantity: 0, size });
}

export async function clearCart(userId: string): Promise<Cart> {
  await CartModel.updateOne({ _id: userId }, { $set: { lines: [] } }, { upsert: true });
  return getCart(userId);
}

// ─── Orders ────────────────────────────────────────────────────────────────

const CANCELLABLE: readonly OrderStatus[] = ['pending_payment', 'placed', 'confirmed'];

type OrderRow = {
  _id: string; userId: string; status: string; currency: string; subtotal: number; discount: number; shipping: number; total: number;
  coinsUsed: number; coinsValue: number; payable: number;
  payment: { provider: string | null; status: string; amount: number; currency: string; providerOrderId: string | null; providerPaymentId: string | null; paidAt: Date | null; expiresAt: Date | null };
  placedAt: Date; updatedAt?: Date; trackingRef: string | null;
  items: { itemId: string; title: string; emoji: string; quantity: number; size: string | null; price: number; mrp: number | null }[];
  addressSnapshot: Omit<Address, 'id' | 'isDefault'>;
  events?: { at: Date }[];
};

function toOrder(row: OrderRow): Order {
  const lastEvent = row.events?.[row.events.length - 1]?.at ?? row.placedAt;
  return orderSchema.parse({
    id: row._id, status: row.status, items: row.items, currency: row.currency,
    subtotal: row.subtotal, discount: row.discount, shipping: row.shipping, total: row.total,
    coinsUsed: row.coinsUsed, coinsValue: row.coinsValue, payable: row.payable,
    payment: {
      provider: row.payment.provider, status: row.payment.status, amount: row.payment.amount, currency: row.payment.currency,
      providerOrderId: row.payment.providerOrderId, paidAt: row.payment.paidAt?.toISOString() ?? null, expiresAt: row.payment.expiresAt?.toISOString() ?? null,
    },
    address: row.addressSnapshot,
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
  /** The coins to put towards it; the quote said how many may. */
  coins: number;
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
 * Places an order (BACKEND §8.5, RULES R2–R4, R11–R13, T5, O8).
 *
 * The gates run first, outside the transaction, in the order a user can fix
 * them: the tier (nothing to do but appeal), the address (add one), the
 * quote (a size, a quantity, coins over the limit), the step-up (enter a
 * code). Then one transaction: the coins part is taken with a `$gte`
 * filter — the overspend guard — the stock with another per line, the
 * order is written, the basket lines it came from are cleared, and any
 * step failing rolls back the rest. An order that still owes money is born
 * `pending_payment` with its stock and coins held for the payment window;
 * one the coins covered is `placed` at once.
 *
 * The gateway order is created after the transaction, because it is a
 * network call to someone else and a transaction that waits on one is a
 * lock held for as long as they take. If it fails, the order is released
 * again before the error is returned.
 */
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
    requested = (cart?.lines ?? []).map(l => ({ itemId: l.itemId, quantity: l.quantity, size: l.size ?? null }));
  }
  if (requested.length === 0) throw new ApiError(422, 'CART_EMPTY', 'There is nothing to order yet.');

  const priced = await priceLines(requested, cfg);
  const balance = await wholeCoins(input.userId);
  const q = buildQuote(priced, balance, input.coins, cfg);
  if (input.coins > q.coinsMax) {
    throw new ApiError(422, 'COINS_OVER_LIMIT', `Up to ${q.coinsMax} coins can go towards this order.`, { coinsMax: q.coinsMax, requested: input.coins });
  }
  const soldOut = q.lines.find(l => !l.inStock);
  if (soldOut) throw new ApiError(409, 'OUT_OF_STOCK', `${soldOut.title} is sold out.`, { itemId: soldOut.itemId });

  const needsStepUp = q.needsStepUp || (!config.trust.shadow && STEP_UP_TIERS.has(tier));
  if (needsStepUp) await consumeStepUp(input.userId, input.stepUpToken, cfg.stepUpThreshold);

  const orderId = newId('ord');
  const snapshot = { label: address.label, name: address.name, phone: address.phone, line1: address.line1, line2: address.line2, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country };
  const coinsMc = toMilli(q.coinsApplied);
  const now = new Date();
  const pending = q.payable > 0;
  const status: OrderStatus = pending ? 'pending_payment' : 'placed';
  const expiresAt = pending ? new Date(now.getTime() + cfg.paymentWindowMinutes * 60_000) : null;
  const title = orderTitle(priced);

  const result = await withTransaction(async session => {
    let balanceMc = toMilli(balance);
    let ledgerId: string | null = null;
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
      _id: orderId, userId: input.userId, status, currency: q.currency,
      subtotal: q.subtotal, discount: q.discount, shipping: q.shipping, total: q.total,
      coinsUsed: q.coinsApplied, coinsValue: q.coinsValue, payable: q.payable,
      payment: {
        provider: pending ? paymentProvider() : null, status: pending ? 'pending' : 'not_required', amount: q.payable, currency: q.currency,
        providerOrderId: null, providerPaymentId: null, paidAt: null, expiresAt,
      },
      items: priced.map(l => ({ itemId: l.item.id, title: l.item.title, emoji: l.item.emoji, quantity: l.quantity, size: l.size, price: l.item.price, mrp: l.item.mrp })),
      addressSnapshot: snapshot, addressId: address._id, placedAt: now, ledgerId,
      events: [{ from: null, to: status, actor: 'user', at: now }],
    }], { session });
    if (input.fromCart) {
      await CartModel.updateOne({ _id: input.userId }, { $set: { lines: [] } }, { session });
    }
    await AuditLogModel.create([{
      actorType: 'user', actorId: input.userId, deviceId: input.deviceId, action: 'order.created',
      subjectType: 'order', subjectId: orderId,
      after: { status, lines: priced.map(l => ({ itemId: l.item.id, quantity: l.quantity })), coinsUsed: q.coinsApplied, payable: q.payable },
    }], { session });
    return { order: order.toObject() as unknown as OrderRow, balance: toCoins(balanceMc) };
  });

  let payment: CheckoutResult['payment'] = null;
  if (pending) {
    try {
      const gateway = await createGatewayOrder({ orderId, amountPaise: q.payable, currency: q.currency });
      await OrderModel.updateOne({ _id: orderId }, { $set: { 'payment.providerOrderId': gateway.providerOrderId, 'payment.provider': gateway.provider } });
      result.order.payment.providerOrderId = gateway.providerOrderId;
      result.order.payment.provider = gateway.provider;
      payment = { provider: gateway.provider, orderId, providerOrderId: gateway.providerOrderId, amount: q.payable, currency: q.currency, keyId: gateway.keyId, expiresAt: expiresAt!.toISOString() };
    } catch (err) {
      await releaseOrder(orderId, input.userId, 'system', 'payment_unavailable');
      throw err;
    }
  } else {
    await notify({
      userId: input.userId, topic: 'reward', preference: 'orders',
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
  await notify({
    userId, topic: 'reward', preference: 'orders',
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
    await notify({
      userId, topic: 'reward', preference: 'orders',
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
        await notify({
          userId: row.userId, topic: 'reward', preference: 'orders',
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
