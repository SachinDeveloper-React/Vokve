import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { shopBadgeSchema } from '../../contracts/index.js';
import { CartModel, OrderModel, ReviewModel, ShopInventoryModel, ShopItemModel, WishlistModel } from '../commerce/models.js';
import { UserModel } from '../identity/models.js';
import { AuditLogModel } from '../platform/models.js';
import { assertShelf } from './categories.service.js';

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
    /**
     * What it costs when coins pay all of it. Null is not missing — it is
     * "whatever the price divides into at ⚙ `commerce.coinValuePaise`",
     * which is what the till would have charged anyway. A figure here is
     * for the reward that should cost a round 2,000 coins.
     */
    coinPrice: z.number().int().min(0).max(10_000_000).nullable().optional(),
    /** A shelf's slug — a row in `shop_categories`, checked before the write. */
    category: z.string().trim().min(1).max(40),
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

/**
 * One row of an imported sheet.
 *
 * The same item as `itemBody` with two differences, both of them about a
 * spreadsheet being a spreadsheet:
 *
 *  - **the slug is optional.** Nobody types slugs into a column; it is
 *    derived from the title when it is missing, which is also what makes
 *    re-importing the same sheet correct the rows it created last time
 *    rather than adding a second copy of each.
 *  - **`line` travels with the row**, so a refusal can name the line in the
 *    operator's own file instead of an index into an array they never saw.
 */
export const itemImportRow = itemBody
  .omit({ id: true })
  .extend({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, 'A slug looks like travel-bottle').optional(),
    line: z.number().int().min(1).max(100_000).optional(),
  })
  .strict();
export type ItemImportRow = z.infer<typeof itemImportRow>;

export interface ItemImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  /** Rows the sheet named twice; the last one wins. */
  duplicates: number;
  failed: { line: number | null; title: string; reason: string }[];
  /** The slugs written, for the audit trail and the panel's confirmation. */
  ids: string[];
}

/**
 * A title as a slug: `Travel Bottle 750ml` → `travel-bottle-750ml`.
 *
 * Deterministic on purpose — it is the key that makes an import idempotent
 * — and clipped to the 49 characters the slug pattern allows.
 */
export function slugOfTitle(title: string): string {
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 49)
    .replace(/-+$/g, '');
}

/** What went wrong with one row, in words an operator can act on. */
function reasonOf(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.details ?? {};
    const said = Object.values(details)
      .filter((value): value is string => typeof value === 'string')
      .join(' ');
    return said || error.message;
  }
  return error instanceof Error && error.message ? error.message : 'Refused.';
}

/**
 * A spreadsheet's worth of products, matched by slug.
 *
 * JSON rather than a file upload, the same as the food library's import
 * (RULES N8): the panel reads the `.xlsx`, maps its columns and sends rows,
 * so this stays the same JSON surface as every other admin route and can be
 * driven by a script just as well as by a dialog.
 *
 * `dryRun` is the half that matters. A sheet's columns are whatever somebody
 * typed, and a catalogue is the one collection where a bad import is visible
 * to every member at once — so the panel asks what *would* happen, shows it,
 * and only writes on a second press. Every row goes through `saveItem`, so
 * an import cannot write anything a typed-in form could not: the shelf has
 * to exist, the slug has to be a slug, the price has to be paise above zero,
 * and a row that fails is skipped by itself rather than taking the sheet
 * down with it.
 *
 * `data` is deliberately not returned. Two thousand catalogue items with
 * their stock and shelves is a response nobody reads; the counts, the
 * skipped lines and the slugs written are what the panel shows.
 */
export async function importItems(
  actor: string,
  rows: ItemImportRow[],
  options: { dryRun?: boolean } = {},
): Promise<ItemImportResult> {
  const dryRun = options.dryRun === true;
  const existing = await ShopItemModel.find({}, { _id: 1 }).lean<{ _id: string }[]>();
  const known = new Set(existing.map(row => row._id));

  const failed: ItemImportResult['failed'] = [];
  const ids: string[] = [];
  let created = 0;
  let updated = 0;
  let duplicates = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    const { line = null, ...item } = row;
    const title = item.title.trim();
    const id = item.id ?? slugOfTitle(title);
    if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(id)) {
      failed.push({
        line,
        title,
        reason: `“${title}” does not make a slug — add an id column with something like travel-bottle.`,
      });
      continue;
    }
    if (seen.has(id)) duplicates += 1;
    seen.add(id);

    try {
      if (dryRun) {
        // The shelf is checked even on a dry run: it is the refusal an
        // operator is most likely to hit, and finding out on the second
        // press would defeat the point of the first.
        await assertShelf(item.category, item.subcategory ?? null);
        if (known.has(id)) updated += 1;
        else created += 1;
        continue;
      }
      const result = await saveItem(actor, { ...item, id, title });
      if (result.created) created += 1;
      else updated += 1;
      // A sheet that names the same product twice is one product: the
      // second row corrects the first rather than adding a twin.
      known.add(id);
      ids.push(id);
    } catch (error) {
      failed.push({ line, title, reason: reasonOf(error) });
    }
  }

  if (!dryRun) {
    await AuditLogModel.create({
      actorType: 'admin',
      actorId: actor,
      action: 'shop.items_imported',
      subjectType: 'shop_item',
      subjectId: 'import',
      before: null,
      after: { created, updated, duplicates, failed: failed.length, ids: ids.slice(0, 50) },
    });
  }

  return { dryRun, created, updated, duplicates, failed, ids };
}

export const catalogueQuery = z.object({
  q: z.string().max(120).default(''),
  category: z.string().trim().min(1).max(40).optional(),
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
      /** What it costs when coins pay all of it: the operator's figure, or the price rounded up as the till does. */
      coinPrice: row.coinPrice ?? Math.ceil(row.price / config.commerce.coinValuePaise),
      /** Whether that figure was typed, so the panel can say "set" rather than quietly showing arithmetic. */
      coinPriceSet: row.coinPrice != null,
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
  // A shelf that does not exist would file the item where no filter looks,
  // and the panel's dropdowns are a convenience, not a guarantee: this
  // route is also called by hand.
  await assertShelf(fields.category, fields.subcategory ?? null);
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
  // Either half of the shelf may be in the patch alone, so the one that is
  // not is read off the item: moving to a shelf without saying which
  // subcategory must not check the old shelf's name against the new shelf.
  if (fields.category !== undefined || fields.subcategory !== undefined) {
    await assertShelf(
      fields.category ?? before.category,
      fields.subcategory !== undefined ? fields.subcategory : fields.category !== undefined ? null : before.subcategory,
    );
  }

  // Moving an item to another shelf without naming a subcategory unfiles
  // it: the name it was filed under belongs to the shelf it is leaving.
  const unfiling =
    fields.category !== undefined && fields.subcategory === undefined && fields.category !== before.category
      ? { subcategory: null }
      : {};

  if (Object.keys(fields).length > 0) {
    await ShopItemModel.updateOne({ _id: id }, { $set: { ...fields, ...unfiling } });
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

// ─── One product, in full ──────────────────────────────────────────────────

/** An order that happened: a cancelled one is not a sale (RULES R10). */
const SOLD_STATUSES = ['placed', 'confirmed', 'shipped', 'delivered'];

/**
 * Everything about one item that is not on the item.
 *
 * The row itself answers "what is it and what does it cost"; a product page
 * worth opening answers the four questions after that — has it sold, who is
 * waiting for it, what are people saying about it, and who changed it last.
 * All four live in other collections, so they are one read rather than four
 * pages an operator has to join by hand.
 */
export async function itemInsight(id: string) {
  const { shop, item } = await getCatalogueItem(id);

  const [sales, recent, reviews, spread, baskets, saves, trail] = await Promise.all([
    OrderModel.aggregate<{ _id: null; orders: number; units: number; goods: number; coinsUsed: number; moneyPaid: number }>([
      { $match: { 'items.itemId': id, status: { $in: SOLD_STATUSES } } },
      { $unwind: '$items' },
      { $match: { 'items.itemId': id } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          units: { $sum: '$items.quantity' },
          goods: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          coinsUsed: { $sum: { $ifNull: ['$items.coinsUsed', 0] } },
          moneyPaid: { $sum: { $ifNull: ['$items.moneyPaid', 0] } },
        },
      },
    ]),
    OrderModel.find({ 'items.itemId': id }, { number: 1, userId: 1, status: 1, items: 1, total: 1, placedAt: 1 })
      .sort({ placedAt: -1 })
      .limit(20)
      .lean(),
    ReviewModel.find({ itemId: id }).sort({ createdAt: -1 }).limit(20).lean(),
    ReviewModel.aggregate<{ _id: number; reviews: number }>([
      { $match: { itemId: id } },
      { $group: { _id: '$rating', reviews: { $sum: 1 } } },
    ]),
    CartModel.aggregate<{ _id: null; baskets: number; units: number }>([
      { $match: { 'lines.itemId': id } },
      { $unwind: '$lines' },
      { $match: { 'lines.itemId': id } },
      { $group: { _id: null, baskets: { $addToSet: '$_id' }, units: { $sum: '$lines.quantity' } } },
      { $project: { baskets: { $size: '$baskets' }, units: 1 } },
    ]),
    WishlistModel.countDocuments({ itemId: id }),
    AuditLogModel.find({ subjectType: 'shop_item', subjectId: id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);

  const memberIds = [...new Set([...recent.map(order => order.userId), ...reviews.map(review => review.userId)])];
  const members = await UserModel.find({ _id: { $in: memberIds } }, { name: 1, email: 1 }).lean();
  const memberOf = new Map(members.map(member => [member._id, member]));
  const named = (userId: string) => ({
    id: userId,
    name: memberOf.get(userId)?.name ?? '',
    email: memberOf.get(userId)?.email ?? null,
  });

  const sale = sales[0];
  const held = baskets[0];

  return {
    shop,
    item,
    /** Sales, excluding cancelled and refunded orders. */
    sales: {
      orders: sale?.orders ?? 0,
      units: sale?.units ?? 0,
      /** Paise of goods at the price each order charged — not today's price. */
      goods: sale?.goods ?? 0,
      /** Whole coins, and paise of money, as the till split each line (RULES R11). */
      coinsUsed: sale?.coinsUsed ?? 0,
      moneyPaid: sale?.moneyPaid ?? 0,
    },
    /** Who wants it and has not bought it: the restock argument. */
    wanted: {
      baskets: held?.baskets ?? 0,
      basketUnits: held?.units ?? 0,
      wishlists: saves,
      /** Wanted by more people than there are units on the shelf. */
      short: Math.max(0, (held?.units ?? 0) + saves - item.stock.onHand),
    },
    orders: recent.map(order => {
      const line = order.items.find(entry => entry.itemId === id);
      return {
        id: order._id,
        number: order.number,
        member: named(order.userId),
        status: order.status,
        quantity: line?.quantity ?? 0,
        /** What this line was charged, as the till split it. */
        price: line?.price ?? 0,
        coinsUsed: line?.coinsUsed ?? 0,
        moneyPaid: line?.moneyPaid ?? 0,
        size: line?.size ?? null,
        color: line?.color ?? null,
        placedAt: iso(order.placedAt),
      };
    }),
    reviews: {
      /** The denormalised figures on the item are the ones every list reads. */
      average: item.rating.average,
      count: item.rating.count,
      histogram: [1, 2, 3, 4, 5].map(rating => ({ rating, reviews: spread.find(row => row._id === rating)?.reviews ?? 0 })),
      data: reviews.map(review => ({
        id: review._id,
        member: named(review.userId),
        authorName: review.authorName,
        rating: review.rating,
        title: review.title ?? null,
        body: review.body,
        verified: review.verified ?? false,
        createdAt: iso((review as { createdAt?: Date }).createdAt),
      })),
    },
    /** Who changed this item, and to what. */
    trail: trail.map(row => ({
      id: String(row._id),
      action: row.action,
      actorId: row.actorId ?? null,
      before: row.before ?? null,
      after: row.after ?? null,
      at: iso((row as { createdAt?: Date }).createdAt),
    })),
  };
}

/**
 * Deletes an item outright — the mistake case, and only that.
 *
 * Retiring is what ending a product's life looks like (`retireItem`): the
 * row stays, every order that holds it stays readable, and a basket line
 * pointing at it still resolves. This is for the other thing entirely — a
 * slug typed wrong, a draft listed by accident, a duplicate — where leaving
 * a retired row behind would be leaving litter on the shelf.
 *
 * So the one rule it enforces is the one that matters: **an item any order
 * holds is never deleted.** An order carries its own snapshot of what was
 * bought (RULES R11), so deleting the row would not corrupt the order — but
 * it would break every link from the order back to the product, which is
 * what support follows when somebody asks what they received. That is a
 * retire, and the refusal says so.
 *
 * What it does clean up is everything that points at the row and would
 * otherwise dangle: stock, basket lines, saves and reviews. A basket line
 * pointing at a row that has gone is a line the member can neither see nor
 * remove.
 */
export async function deleteItem(actor: string, id: string, note?: string) {
  const before = await ShopItemModel.findById(id).lean();
  if (!before) throw Errors.notFound('That item');

  const orders = await OrderModel.countDocuments({ 'items.itemId': id });
  if (orders > 0) {
    throw Errors.validation({
      id: `${orders} ${orders === 1 ? 'order holds' : 'orders hold'} this item, so deleting it would break the link from those orders back to the product. Retire it instead: that takes it off the member's shelf and leaves their history intact.`,
    });
  }

  const [baskets, saves, reviews] = await Promise.all([
    CartModel.updateMany({ 'lines.itemId': id }, { $pull: { lines: { itemId: id } } }),
    WishlistModel.deleteMany({ itemId: id }),
    ReviewModel.deleteMany({ itemId: id }),
  ]);
  await ShopInventoryModel.deleteOne({ _id: id });
  await ShopItemModel.deleteOne({ _id: id });

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'shop.item_deleted',
    subjectType: 'shop_item',
    subjectId: id,
    before: { title: before.title, price: before.price, category: before.category, active: before.active ?? true },
    after: {
      deleted: true,
      basketsTidied: baskets.modifiedCount ?? 0,
      savesRemoved: saves.deletedCount ?? 0,
      reviewsRemoved: reviews.deletedCount ?? 0,
      note: note ?? null,
    },
  });

  return {
    deleted: true,
    id,
    basketsTidied: baskets.modifiedCount ?? 0,
    savesRemoved: saves.deletedCount ?? 0,
    reviewsRemoved: reviews.deletedCount ?? 0,
  };
}
