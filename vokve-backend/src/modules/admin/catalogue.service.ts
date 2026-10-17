import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { Errors } from '../../lib/errors.js';
import { shopBadgeSchema, shopCategorySchema } from '../../contracts/index.js';
import { OrderModel, ShopInventoryModel, ShopItemModel } from '../commerce/models.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * The shelf itself (RULES R1, R11).
 *
 * The catalogue was seed data: changing a price, listing a reward or taking
 * something out of stock meant editing `seed/data.ts` and deploying. Which
 * also meant the one field that decides how a thing may be *bought* —
 * `paymentMode` — could only be set by a developer, and it is the most
 * product-ish field in the schema.
 *
 * Three things worth knowing about what this writes:
 *
 *   - **An item is never deleted.** Retiring sets `active: false`, which
 *     takes it off the shelf and leaves every order that holds it readable.
 *     Orders carry their own snapshot of what was bought (RULES R11), so a
 *     retired item does not change anybody's history.
 *   - **`paymentMode` is per item, and null means the shop's.** A coins-only
 *     reward can sit on the same shelf as a money-only product; `null`
 *     follows ⚙ `commerce.paymentMode`. This is the field the whole
 *     coins/money/mixed behaviour hangs off.
 *   - **Prices are paise.** The one place the panel shows rupees is where it
 *     draws them.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

const facet = z.object({ icon: z.string().trim().max(40).optional(), label: z.string().trim().max(60), value: z.string().trim().max(120) }).strict();
const feature = z.object({ icon: z.string().trim().max(40).optional(), title: z.string().trim().max(60), caption: z.string().trim().max(160) }).strict();
const colour = z.object({ name: z.string().trim().min(1).max(40), hex: z.string().trim().regex(/^#?[0-9a-fA-F]{3,8}$/) }).strict();

export const itemBody = z
  .object({
    /** The slug, and the id a cart line keys on. Fixed once created. */
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, 'A slug looks like travel-bottle'),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    /** Paise. 1 is the floor the schema already enforces. */
    price: z.number().int().min(1).max(100_000_000),
    /** The struck-through list price, where there is one. */
    mrp: z.number().int().min(0).max(100_000_000).nullable().optional(),
    category: shopCategorySchema,
    subcategory: z.string().trim().max(60).nullable().optional(),
    /**
     * How this item may be bought: coins only, money only, or both at the
     * shop's shares. Null follows ⚙ `commerce.paymentMode`.
     */
    paymentMode: z.enum(['coins', 'money', 'mixed']).nullable().optional(),
    emoji: z.string().trim().max(8).optional(),
    imageUrl: z.string().trim().max(500).nullable().optional(),
    images: z.array(z.string().trim().max(500)).max(10).optional(),
    badge: shopBadgeSchema.nullable().optional(),
    ribbon: z.string().trim().max(40).nullable().optional(),
    isDeal: z.boolean().optional(),
    featured: z.boolean().optional(),
    tags: z.array(z.string().trim().max(40)).max(20).optional(),
    sizes: z.array(z.string().trim().max(16)).max(20).optional(),
    colors: z.array(colour).max(20).optional(),
    highlights: z.array(facet).max(12).optional(),
    features: z.array(feature).max(12).optional(),
    specs: z.array(facet).max(20).optional(),
    sort: z.number().int().min(-10_000).max(10_000).optional(),
    active: z.boolean().optional(),
    /** Written straight to `shop_inventory`, since nobody lists a thing they have none of. */
    onHand: z.number().int().min(0).max(1_000_000).optional(),
    lowStockAt: z.number().int().min(0).max(10_000).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type ItemBody = z.infer<typeof itemBody>;

/** Everything but the id, and every field optional: a patch. */
export const itemPatch = itemBody.partial().omit({ id: true }).strict();
export type ItemPatch = z.infer<typeof itemPatch>;

export const catalogueQuery = z.object({
  q: z.string().max(120).default(''),
  category: shopCategorySchema.optional(),
  paymentMode: z.enum(['coins', 'money', 'mixed', 'shop']).optional(),
  /** The shelf as a member sees it, or everything including what is retired. */
  state: z.enum(['any', 'active', 'retired', 'out_of_stock', 'low_stock']).default('any'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(['sort', 'newest', 'price_asc', 'price_desc', 'popular', 'title']).default('sort'),
});
export type CatalogueQuery = z.infer<typeof catalogueQuery>;

/**
 * The shelf as the operator needs it: retired rows included, stock beside
 * each item, and how each one may be paid for spelled out rather than left
 * as a null to look up.
 */
export async function listCatalogue(query: CatalogueQuery) {
  const config = await getConfig();
  const filter: Record<string, unknown> = {};
  const trimmed = query.q.trim();
  if (trimmed) {
    const like = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ _id: like }, { title: like }, { tags: like }];
  }
  if (query.category) filter.category = query.category;
  if (query.paymentMode === 'shop') filter.paymentMode = null;
  else if (query.paymentMode) filter.paymentMode = query.paymentMode;
  if (query.state === 'active') filter.active = true;
  if (query.state === 'retired') filter.active = false;

  const order: Record<string, 1 | -1> =
    query.sort === 'newest'
      ? { listedAt: -1 }
      : query.sort === 'price_asc'
        ? { price: 1 }
        : query.sort === 'price_desc'
          ? { price: -1 }
          : query.sort === 'popular'
            ? { popularity: -1 }
            : query.sort === 'title'
              ? { title: 1 }
              : { sort: 1, title: 1 };

  const [rows, total] = await Promise.all([
    ShopItemModel.find(filter).sort(order).skip(query.offset).limit(query.limit).lean(),
    ShopItemModel.countDocuments(filter),
  ]);

  const ids = rows.map(row => row._id);
  const [stock, sold] = await Promise.all([
    ShopInventoryModel.find({ _id: { $in: ids } }).lean(),
    OrderModel.aggregate<{ _id: string; orders: number; units: number }>([
      { $match: { 'items.itemId': { $in: ids }, status: { $nin: ['cancelled', 'pending_payment'] } } },
      { $unwind: '$items' },
      { $match: { 'items.itemId': { $in: ids } } },
      { $group: { _id: '$items.itemId', orders: { $sum: 1 }, units: { $sum: '$items.quantity' } } },
    ]),
  ]);
  const stockOf = new Map(stock.map(row => [row._id, row]));
  const soldOf = new Map(sold.map(row => [row._id, row]));

  const data = rows.map(row => {
    const inventory = stockOf.get(row._id);
    const onHand = inventory?.onHand ?? 0;
    const lowStockAt = inventory?.lowStockAt ?? 5;
    const mode = (row.paymentMode as 'coins' | 'money' | 'mixed' | null) ?? null;
    return {
      id: row._id,
      title: row.title,
      description: row.description ?? '',
      /** Paise. */
      price: row.price,
      mrp: row.mrp ?? null,
      /** What it costs when coins pay all of it, rounded up as the till does. */
      coinPrice: Math.ceil(row.price / config.commerce.coinValuePaise),
      category: row.category,
      subcategory: row.subcategory ?? null,
      paymentMode: mode,
      /** The mode in force: the item's own, or the shop's where it has none. */
      effectivePaymentMode: mode ?? config.commerce.paymentMode,
      emoji: row.emoji ?? null,
      imageUrl: row.imageUrl ?? null,
      images: row.images ?? [],
      badge: row.badge ?? null,
      ribbon: row.ribbon ?? null,
      isDeal: row.isDeal ?? false,
      featured: row.featured ?? false,
      tags: row.tags ?? [],
      sizes: row.sizes ?? [],
      colors: (row.colors ?? []).map(entry => ({ name: entry.name, hex: entry.hex })),
      highlights: row.highlights ?? [],
      features: row.features ?? [],
      specs: row.specs ?? [],
      popularity: row.popularity ?? 0,
      rating: { average: row.ratingAverage ?? 0, count: row.ratingCount ?? 0 },
      stock: { onHand, lowStockAt, low: onHand > 0 && onHand <= lowStockAt, out: onHand === 0 },
      sold: { orders: soldOf.get(row._id)?.orders ?? 0, units: soldOf.get(row._id)?.units ?? 0 },
      active: row.active ?? true,
      sort: row.sort ?? 0,
      listedAt: iso(row.listedAt),
      updatedAt: iso((row as { updatedAt?: Date }).updatedAt),
    };
  });

  const filtered =
    query.state === 'out_of_stock'
      ? data.filter(item => item.stock.out)
      : query.state === 'low_stock'
        ? data.filter(item => item.stock.low)
        : data;

  return {
    total,
    offset: query.offset,
    limit: query.limit,
    /** The shop-wide default, so a null `paymentMode` reads as something. */
    shop: {
      paymentMode: config.commerce.paymentMode,
      coinValuePaise: config.commerce.coinValuePaise,
      coinShareMin: config.commerce.coinShareMin,
      coinShareMax: config.commerce.coinShareMax,
      currency: config.commerce.currency,
    },
    data: filtered,
    nextCursor: null,
  };
}

export async function getCatalogueItem(id: string) {
  const page = await listCatalogue({ q: id, state: 'any', limit: 100, offset: 0, sort: 'sort' });
  const item = page.data.find(row => row.id === id);
  if (!item) throw Errors.notFound('That item');
  return { shop: page.shop, item };
}

/** Writes an item, creating it where the slug is new. Idempotent on the slug. */
export async function saveItem(actor: string, body: ItemBody) {
  const { id, note, onHand, lowStockAt, ...fields } = body;
  const before = await ShopItemModel.findById(id).lean();

  await ShopItemModel.updateOne(
    { _id: id },
    {
      $set: { ...fields, ...(fields.paymentMode === undefined ? {} : { paymentMode: fields.paymentMode }) },
      // The starting figures of a new row, which a later write must not reset.
      // Nothing that can also appear in `$set` may be named here: Mongo
      // refuses an update that touches one path twice, so listing `active`
      // in both made "create it retired" a 500. The schema's own default
      // covers the field when the patch leaves it out.
      $setOnInsert: { _id: id, popularity: 0, ratingAverage: 0, ratingCount: 0, listedAt: new Date() },
    },
    { upsert: true },
  );
  if (onHand !== undefined || lowStockAt !== undefined) {
    await ShopInventoryModel.updateOne(
      { _id: id },
      { $set: { ...(onHand !== undefined ? { onHand } : {}), ...(lowStockAt !== undefined ? { lowStockAt } : {}) } },
      { upsert: true },
    );
  }

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: before ? 'shop.item_updated' : 'shop.item_created',
    subjectType: 'shop_item', subjectId: id,
    before: before ? { title: before.title, price: before.price, paymentMode: before.paymentMode ?? null, active: before.active } : null,
    after: { ...fields, onHand, lowStockAt, note: note ?? null },
  });

  return { created: !before, ...(await getCatalogueItem(id)) };
}

/** A patch, for the one field somebody came to change. */
export async function patchItem(actor: string, id: string, body: ItemPatch) {
  const before = await ShopItemModel.findById(id).lean();
  if (!before) throw Errors.notFound('That item');
  const { note, onHand, lowStockAt, ...fields } = body;

  if (Object.keys(fields).length > 0) {
    await ShopItemModel.updateOne({ _id: id }, { $set: fields });
  }
  if (onHand !== undefined || lowStockAt !== undefined) {
    await ShopInventoryModel.updateOne(
      { _id: id },
      { $set: { ...(onHand !== undefined ? { onHand } : {}), ...(lowStockAt !== undefined ? { lowStockAt } : {}) } },
      { upsert: true },
    );
  }

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'shop.item_updated', subjectType: 'shop_item', subjectId: id,
    before: Object.fromEntries(Object.keys(fields).map(key => [key, (before as Record<string, unknown>)[key] ?? null])),
    after: { ...fields, onHand, lowStockAt, note: note ?? null },
  });

  return getCatalogueItem(id);
}

/**
 * Takes an item off the shelf, or puts it back.
 *
 * Never a delete: every order that holds it stays readable, and a basket
 * line pointing at a row that no longer exists is a broken basket.
 */
export async function retireItem(actor: string, id: string, active: boolean, note?: string) {
  const before = await ShopItemModel.findById(id).lean();
  if (!before) throw Errors.notFound('That item');
  await ShopItemModel.updateOne({ _id: id }, { $set: { active } });
  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: active ? 'shop.item_restored' : 'shop.item_retired',
    subjectType: 'shop_item', subjectId: id,
    before: { active: before.active ?? true }, after: { active, note: note ?? null },
  });
  return getCatalogueItem(id);
}
