import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { Errors } from '../../lib/errors.js';
import { shopCategoryIconSchema } from '../../contracts/index.js';
import { CartModel, OrderModel, ShopCategoryModel, ShopInventoryModel, ShopItemModel, WishlistModel } from '../commerce/models.js';
import { ensureShelves, slugifyShelf, type Shelf } from '../commerce/shelves.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * The shelves, and everything an operator does to them (RULES R1, R9).
 *
 * The four top-level categories used to be a contract rather than data: a
 * zod enum the app validated every shop response against, so a fifth shelf
 * was a code change and an app release. They are rows now — `shop_categories`
 * — and the app is told each one's label and icon, so a shelf added this
 * afternoon draws itself on a phone installed last month.
 *
 * Two things still hold, and they are what the writes below are careful
 * about:
 *
 *   - **A slug is a key.** Every item's `category` is a shelf's `_id`, so a
 *     shelf is never renamed into a different slug: the label is what a
 *     member reads and the label is what changes. Deleting a shelf that has
 *     items on it means saying where they go.
 *   - **A subcategory is a name on the item.** The shelf lists them so the
 *     panel can offer a dropdown instead of a text box — which is what stops
 *     "T-Shirts" appearing beside "T-shirts" — but the item still carries
 *     the string, so renaming one is a write across the items that hold it,
 *     and renaming it onto a name already in use is how two are merged.
 */

const ICONS = shopCategoryIconSchema.removeCatch().options;

type Sold = { _id: string; units: number; goods: number; coinsUsed: number; moneyPaid: number; orders: number };

/** An order that happened: cancelled and refunded ones are not sales (RULES R10). */
const SOLD_STATUSES = ['placed', 'confirmed', 'shipped', 'delivered'];

/** The shelf by that slug, or a 404 naming it. */
async function shelfOr404(slug: string): Promise<Shelf> {
  const shelves = await ensureShelves();
  const shelf = shelves.find(row => row._id === slug);
  if (!shelf) throw Errors.notFound(`A “${slug}” shelf`);
  return shelf;
}

/** Two subcategory names are the same name when only their capitals differ. */
const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What an item write is allowed to file itself under.
 *
 * Called by the catalogue before it saves an item, because a dropdown in
 * the panel is a convenience and not a guarantee: the API is also called by
 * hand, and a typo'd shelf would put an item somewhere no list reads.
 */
export async function assertShelf(category: string, subcategory?: string | null): Promise<void> {
  const shelves = await ensureShelves();
  const shelf = shelves.find(row => row._id === category);
  if (!shelf) {
    throw Errors.validation({
      category: `There is no “${category}” shelf. The shelves are: ${shelves.map(row => row._id).join(', ')} — add one on Categories first.`,
    });
  }
  if (subcategory) {
    const sub = shelf.subcategories.find(entry => sameName(entry.name, subcategory));
    if (!sub) {
      throw Errors.validation({
        subcategory: `“${subcategory}” is not a subcategory of ${shelf.name}${
          shelf.subcategories.length > 0 ? ` — it has ${shelf.subcategories.map(entry => entry.name).join(', ')}` : ', which has none yet'
        }.`,
      });
    }
  }
}

/**
 * Every shelf with what it is actually carrying, and every subcategory
 * under it.
 *
 * The whole catalogue is read rather than aggregated per shelf: it is a few
 * hundred rows at most, and reading it once makes the subcategory rollups —
 * a group-by on a name the item carries — arithmetic instead of one more
 * round trip per shelf.
 */
export async function listCategories() {
  const config = await getConfig();
  const [shelves, items, stock, sold, saved, baskets] = await Promise.all([
    ensureShelves(),
    ShopItemModel.find(
      {},
      { title: 1, price: 1, category: 1, subcategory: 1, active: 1, ratingAverage: 1, ratingCount: 1, popularity: 1 },
    ).lean(),
    ShopInventoryModel.find({}).lean(),
    OrderModel.aggregate<Sold>([
      { $match: { status: { $in: SOLD_STATUSES } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.itemId',
          units: { $sum: '$items.quantity' },
          goods: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          coinsUsed: { $sum: { $ifNull: ['$items.coinsUsed', 0] } },
          moneyPaid: { $sum: { $ifNull: ['$items.moneyPaid', 0] } },
          orders: { $sum: 1 },
        },
      },
    ]),
    WishlistModel.aggregate<{ _id: string; saves: number }>([{ $group: { _id: '$itemId', saves: { $sum: 1 } } }]),
    CartModel.aggregate<{ _id: string; units: number }>([
      { $unwind: '$lines' },
      { $group: { _id: '$lines.itemId', units: { $sum: '$lines.quantity' } } },
    ]),
  ]);

  const stockOf = new Map(stock.map(row => [row._id, row]));
  const soldOf = new Map(sold.map(row => [row._id, row]));
  const savedOf = new Map(saved.map(row => [row._id, row.saves]));
  const basketOf = new Map(baskets.map(row => [row._id, row.units]));

  const measure = (rows: typeof items) => {
    let onHandUnits = 0;
    let stockValue = 0;
    let out = 0;
    let low = 0;
    let units = 0;
    let goods = 0;
    let coinsUsed = 0;
    let moneyPaid = 0;
    let wanted = 0;
    let ratingSum = 0;
    let ratingCount = 0;
    for (const row of rows) {
      const inventory = stockOf.get(row._id);
      const onHand = inventory?.onHand ?? 0;
      const lowStockAt = inventory?.lowStockAt ?? 5;
      onHandUnits += onHand;
      stockValue += onHand * row.price;
      if (onHand === 0) out += 1;
      else if (onHand <= lowStockAt) low += 1;
      const sale = soldOf.get(row._id);
      units += sale?.units ?? 0;
      goods += sale?.goods ?? 0;
      coinsUsed += sale?.coinsUsed ?? 0;
      moneyPaid += sale?.moneyPaid ?? 0;
      wanted += (savedOf.get(row._id) ?? 0) + (basketOf.get(row._id) ?? 0);
      if ((row.ratingCount ?? 0) > 0) {
        ratingSum += (row.ratingAverage ?? 0) * (row.ratingCount ?? 0);
        ratingCount += row.ratingCount ?? 0;
      }
    }
    return {
      items: rows.length,
      active: rows.filter(row => row.active !== false).length,
      retired: rows.filter(row => row.active === false).length,
      outOfStock: out,
      lowStock: low,
      onHandUnits,
      /** Paise of stock sitting on the shelf, at selling price. */
      stockValue,
      unitsSold: units,
      /** Paise of goods sold, at the price each order charged. */
      goodsSold: goods,
      /** Whole coins and paise, as the till split them (RULES R11). */
      coinsUsed,
      moneyPaid,
      /** Saves plus basket units: what people want that is not an order yet. */
      wanted,
      rating: {
        average: ratingCount === 0 ? 0 : Math.round((ratingSum / ratingCount) * 10) / 10,
        count: ratingCount,
      },
    };
  };

  const data = shelves.map(shelf => {
    const mine = items.filter(row => row.category === shelf._id);
    return {
      /** The slug, which is what an item carries and what a filter sends. */
      category: shelf._id,
      name: shelf.name,
      description: shelf.description,
      icon: shelf.icon,
      sort: shelf.sort,
      /** A retired shelf is kept off the app: nothing on it is listed. */
      shelfActive: shelf.active,
      ...measure(mine),
      subcategories: shelf.subcategories.map(sub => ({
        name: sub.name,
        sort: sub.sort,
        subActive: sub.active,
        ...measure(mine.filter(row => row.subcategory === sub.name)),
      })),
      /** Items on this shelf filed under no subcategory at all. */
      unfiled: mine.filter(row => !row.subcategory).length,
    };
  });

  return {
    /** The glyphs a shelf may be drawn with, so the panel can offer them. */
    icons: ICONS,
    shop: {
      paymentMode: config.commerce.paymentMode,
      coinValuePaise: config.commerce.coinValuePaise,
      currency: config.commerce.currency,
    },
    totals: measure(items),
    data,
    nextCursor: null,
  };
}

// ─── The shelves themselves ────────────────────────────────────────────────

export const categoryBody = z
  .object({
    /** The slug every item will carry. Derived from the name when left out, and fixed once created. */
    slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'A slug looks like yoga-pilates').optional(),
    /** What a member reads on the chip and the tile. */
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().max(300).optional(),
    icon: z.enum(ICONS).optional(),
    sort: z.number().int().min(-10_000).max(10_000).optional(),
    active: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type CategoryBody = z.infer<typeof categoryBody>;

/** Everything but the slug, every field optional: the shelf is renamed, never re-keyed. */
export const categoryPatch = categoryBody.partial().omit({ slug: true }).strict();
export type CategoryPatch = z.infer<typeof categoryPatch>;

/** Adds a shelf. The slug is the key, so a second one by that slug is refused rather than merged. */
export async function createCategory(actor: string, body: CategoryBody) {
  const slug = body.slug ?? slugifyShelf(body.name);
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) {
    throw Errors.validation({ slug: `“${body.name}” does not make a slug — give one, like yoga-pilates.` });
  }
  const shelves = await ensureShelves();
  if (shelves.some(shelf => shelf._id === slug)) {
    throw Errors.validation({ slug: `There is already a “${slug}” shelf — ${shelves.find(shelf => shelf._id === slug)!.name}.` });
  }

  await ShopCategoryModel.create({
    _id: slug,
    name: body.name,
    description: body.description ?? '',
    icon: body.icon ?? 'category',
    // Last on the row unless somebody says otherwise, so adding one never
    // reshuffles the shelves a member already knows.
    sort: body.sort ?? shelves.reduce((top, shelf) => Math.max(top, shelf.sort), 0) + 1,
    active: body.active ?? true,
    subcategories: [],
  });

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'shop.category_created', subjectType: 'shop_category', subjectId: slug,
    before: null, after: { slug, name: body.name, icon: body.icon ?? 'category', active: body.active ?? true, note: body.note ?? null },
  });

  return { created: true, slug, ...(await listCategories()) };
}

/**
 * Renames a shelf, moves it along the row, or takes it off the app.
 *
 * The slug is not here on purpose: it is what every item, every filter link
 * and every saved search carries, so changing it would file a shelf's items
 * under a shelf that does not exist. The label is the part a member reads.
 */
export async function updateCategory(actor: string, slug: string, body: CategoryPatch) {
  const before = await shelfOr404(slug);
  const { note, ...fields } = body;
  if (Object.keys(fields).length === 0) throw Errors.validation({ name: 'Nothing to change.' });

  await ShopCategoryModel.updateOne({ _id: slug }, { $set: fields });

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'shop.category_updated', subjectType: 'shop_category', subjectId: slug,
    before: { name: before.name, icon: before.icon, sort: before.sort, active: before.active },
    after: { ...fields, note: note ?? null },
  });

  return listCategories();
}

export const categoryDeleteBody = z
  .object({
    /** The shelf its items move to. Required while any item is still on this one. */
    moveTo: z.string().trim().min(1).max(40).nullable().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type CategoryDeleteBody = z.infer<typeof categoryDeleteBody>;

/**
 * Deletes a shelf.
 *
 * Guarded the way every delete in the panel is guarded: an item whose
 * `category` names a shelf that has gone is an item no filter finds and no
 * tile counts, so the items come first. Either the shelf is empty, or
 * `moveTo` says which shelf they go to and they are moved in the same
 * write. Retiring it instead (`active: false`) takes it off the app and
 * leaves everything where it is.
 */
export async function deleteCategory(actor: string, slug: string, body: CategoryDeleteBody) {
  const shelf = await shelfOr404(slug);
  const holding = await ShopItemModel.countDocuments({ category: slug });
  const moveTo = body.moveTo ?? null;

  if (holding > 0 && moveTo === null) {
    throw Errors.validation({
      moveTo: `${holding} item(s) are on ${shelf.name}, so deleting it would leave them on a shelf that does not exist. Say which shelf they move to, or retire this one instead.`,
    });
  }
  if (moveTo !== null) {
    if (moveTo === slug) throw Errors.validation({ moveTo: 'They cannot move to the shelf being deleted.' });
    await shelfOr404(moveTo);
  }

  const moved = holding > 0 ? await ShopItemModel.updateMany({ category: slug }, { $set: { category: moveTo, subcategory: null } }) : null;
  await ShopCategoryModel.deleteOne({ _id: slug });

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'shop.category_deleted', subjectType: 'shop_category', subjectId: slug,
    before: { name: shelf.name, icon: shelf.icon, subcategories: shelf.subcategories.map(sub => sub.name), items: holding },
    after: { deleted: true, movedTo: moveTo, items: moved?.modifiedCount ?? 0, note: body.note ?? null },
  });

  return {
    deleted: true,
    /** Items that changed shelf, each one unfiled as it went: their old subcategory was this shelf's. */
    moved: moved?.modifiedCount ?? 0,
    movedTo: moveTo,
    ...(await listCategories()),
  };
}

// ─── The subcategories under them ──────────────────────────────────────────

export const subcategoryCreateBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    sort: z.number().int().min(-10_000).max(10_000).optional(),
    active: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type SubcategoryCreateBody = z.infer<typeof subcategoryCreateBody>;

/** Adds a name to a shelf's list, which is what the item form's second dropdown offers. */
export async function createSubcategory(actor: string, slug: string, body: SubcategoryCreateBody) {
  const shelf = await shelfOr404(slug);
  if (shelf.subcategories.some(sub => sameName(sub.name, body.name))) {
    throw Errors.validation({ name: `${shelf.name} already has a “${body.name}”.` });
  }

  await ShopCategoryModel.updateOne(
    { _id: slug },
    {
      $push: {
        subcategories: {
          name: body.name,
          sort: body.sort ?? shelf.subcategories.reduce((top, sub) => Math.max(top, sub.sort), 0) + 1,
          active: body.active ?? true,
        },
      },
    },
  );

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'shop.subcategory_created', subjectType: 'shop_category', subjectId: `${slug}:${body.name}`,
    before: null, after: { category: slug, name: body.name, note: body.note ?? null },
  });

  return { created: true, ...(await listCategories()) };
}

export const subcategoryPatchBody = z
  .object({
    /** The new name. Written across every item that holds the old one; an existing name merges the two. */
    name: z.string().trim().min(1).max(60).optional(),
    sort: z.number().int().min(-10_000).max(10_000).optional(),
    active: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type SubcategoryPatchBody = z.infer<typeof subcategoryPatchBody>;

/**
 * Renames a subcategory — and merges two by renaming one onto the other.
 *
 * The item carries the name, so this is two writes that have to agree: the
 * shelf's list, and every item filed under the old name. A member's basket
 * and a placed order are both untouched — a basket keys on the item's slug,
 * and an order carries its own snapshot of what was bought (RULES R11).
 */
export async function updateSubcategory(actor: string, slug: string, from: string, body: SubcategoryPatchBody) {
  const shelf = await shelfOr404(slug);
  const current = shelf.subcategories.find(sub => sameName(sub.name, from));
  if (!current) throw Errors.notFound(`A “${from}” subcategory under ${shelf.name}`);

  const to = body.name ?? current.name;
  const merging = to !== current.name ? shelf.subcategories.find(sub => sameName(sub.name, to)) : undefined;
  let moved = 0;

  if (to !== current.name) {
    const result = await ShopItemModel.updateMany({ category: slug, subcategory: current.name }, { $set: { subcategory: to } });
    moved = result.modifiedCount ?? 0;
    if (merging) {
      // Two rows for one name would show the shelf twice and give the item
      // form two identical options, so the one being renamed goes.
      await ShopCategoryModel.updateOne({ _id: slug }, { $pull: { subcategories: { name: current.name } } });
    }
  }

  if (!merging) {
    const set: Record<string, unknown> = {};
    if (body.name !== undefined) set['subcategories.$.name'] = to;
    if (body.sort !== undefined) set['subcategories.$.sort'] = body.sort;
    if (body.active !== undefined) set['subcategories.$.active'] = body.active;
    if (Object.keys(set).length > 0) {
      await ShopCategoryModel.updateOne({ _id: slug, 'subcategories.name': current.name }, { $set: set });
    }
  }

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor,
    action: merging ? 'shop.subcategory_merged' : 'shop.subcategory_renamed',
    subjectType: 'shop_category', subjectId: `${slug}:${current.name}`,
    before: { category: slug, name: current.name, sort: current.sort, active: current.active },
    after: { name: to, sort: body.sort ?? current.sort, active: body.active ?? current.active, items: moved, note: body.note ?? null },
  });

  return {
    moved,
    /** Set when the new name already had a row: this was a merge, not a rename. */
    mergedWith: merging ? to : null,
    ...(await listCategories()),
  };
}

export const subcategoryDeleteBody = z
  .object({
    /** Where its items are filed instead: another subcategory of the same shelf, or null to unfile them. */
    reassignTo: z.string().trim().max(60).nullable().default(null),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type SubcategoryDeleteBody = z.infer<typeof subcategoryDeleteBody>;

/**
 * Removes a subcategory, and says where its items went.
 *
 * Unlike a shelf, there is nothing to guard against: an item with no
 * subcategory is a perfectly ordinary item, which is why `reassignTo` is
 * null by default. It is there for the other case — the name was a
 * duplicate, and the items belong under its neighbour.
 */
export async function deleteSubcategory(actor: string, slug: string, name: string, body: SubcategoryDeleteBody) {
  const shelf = await shelfOr404(slug);
  const current = shelf.subcategories.find(sub => sameName(sub.name, name));
  if (!current) throw Errors.notFound(`A “${name}” subcategory under ${shelf.name}`);

  const to = body.reassignTo === '' ? null : body.reassignTo;
  if (to !== null) {
    if (sameName(to, current.name)) throw Errors.validation({ reassignTo: 'That is the subcategory being deleted.' });
    if (!shelf.subcategories.some(sub => sameName(sub.name, to))) {
      throw Errors.validation({ reassignTo: `${shelf.name} has no “${to}” to move them to.` });
    }
  }

  const result = await ShopItemModel.updateMany({ category: slug, subcategory: current.name }, { $set: { subcategory: to } });
  await ShopCategoryModel.updateOne({ _id: slug }, { $pull: { subcategories: { name: current.name } } });

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'shop.subcategory_deleted', subjectType: 'shop_category', subjectId: `${slug}:${current.name}`,
    before: { category: slug, name: current.name, items: result.matchedCount ?? 0 },
    after: { deleted: true, reassignedTo: to, items: result.modifiedCount ?? 0, note: body.note ?? null },
  });

  return {
    deleted: true,
    /** Items that were filed under it, now under `reassignedTo` or under nothing. */
    moved: result.modifiedCount ?? 0,
    reassignedTo: to,
    ...(await listCategories()),
  };
}

// ─── Moving items between shelves ──────────────────────────────────────────

export const subcategoryBody = z
  .object({
    category: z.string().trim().min(1).max(40),
    /** The name as it is typed on the items now. */
    from: z.string().trim().min(1).max(60),
    /** The name to give them, or null to leave them unfiled. */
    to: z.string().trim().max(60).nullable(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type SubcategoryBody = z.infer<typeof subcategoryBody>;

/**
 * Renames a subcategory across every item that holds it — and merges two by
 * renaming one to the other's name.
 *
 * The older of the two ways to do this, kept because it works on a name the
 * shelf has never listed: an item filed by hand, or a row imported from
 * somewhere else. `updateSubcategory` is the one the panel's pencil calls.
 */
export async function renameSubcategory(actor: string, body: SubcategoryBody) {
  const to = body.to === null || body.to === '' ? null : body.to;
  if (to === body.from) throw Errors.validation({ to: 'That is the name it already has.' });

  const holding = await ShopItemModel.countDocuments({ category: body.category, subcategory: body.from });
  if (holding === 0) {
    throw Errors.notFound(`A “${body.from}” subcategory under ${body.category}`);
  }
  const merging = to === null ? 0 : await ShopItemModel.countDocuments({ category: body.category, subcategory: to });

  const result = await ShopItemModel.updateMany(
    { category: body.category, subcategory: body.from },
    { $set: { subcategory: to } },
  );

  // The shelf's own list has to follow the items, or the item form would go
  // on offering a name nothing is filed under.
  await ShopCategoryModel.updateOne({ _id: body.category }, { $pull: { subcategories: { name: body.from } } });
  if (to !== null && merging === 0) {
    await ShopCategoryModel.updateOne({ _id: body.category }, { $push: { subcategories: { name: to, sort: 0, active: true } } });
  }

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: to === null ? 'shop.subcategory_cleared' : merging > 0 ? 'shop.subcategory_merged' : 'shop.subcategory_renamed',
    subjectType: 'shop_category',
    subjectId: `${body.category}:${body.from}`,
    before: { category: body.category, subcategory: body.from, items: holding },
    after: { subcategory: to, items: result.modifiedCount ?? 0, mergedInto: merging > 0 ? to : null, note: body.note ?? null },
  });

  return {
    moved: result.modifiedCount ?? 0,
    /** Set when the new name already had items: this was a merge, not a rename. */
    mergedWith: merging > 0 ? merging : null,
    ...(await listCategories()),
  };
}

export const recategoriseBody = z
  .object({
    /** The slugs to move. */
    ids: z.array(z.string().trim().min(1).max(80)).min(1).max(100),
    category: z.string().trim().min(1).max(40),
    /** Optional: set, or clear with null, as they move. */
    subcategory: z.string().trim().max(60).nullable().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type RecategoriseBody = z.infer<typeof recategoriseBody>;

/** Moves a handful of items onto another shelf, in one write and one audit row. */
export async function recategoriseItems(actor: string, body: RecategoriseBody) {
  await assertShelf(body.category, body.subcategory ?? null);
  const ids = [...new Set(body.ids)];
  const before = await ShopItemModel.find({ _id: { $in: ids } }, { category: 1, subcategory: 1, title: 1 }).lean();
  if (before.length === 0) throw Errors.notFound('Those items');
  const missing = ids.filter(id => !before.some(row => row._id === id));

  const result = await ShopItemModel.updateMany(
    { _id: { $in: before.map(row => row._id) } },
    {
      $set: {
        category: body.category,
        ...(body.subcategory === undefined ? {} : { subcategory: body.subcategory === '' ? null : body.subcategory }),
      },
    },
  );

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'shop.items_recategorised',
    subjectType: 'shop_category',
    subjectId: body.category,
    before: before.map(row => ({ id: row._id, category: row.category, subcategory: row.subcategory ?? null })),
    after: { category: body.category, subcategory: body.subcategory ?? null, items: result.modifiedCount ?? 0, note: body.note ?? null },
  });

  return {
    moved: result.modifiedCount ?? 0,
    /** Slugs nothing matched — a typed id that is not on the shelf. */
    missing,
    ...(await listCategories()),
  };
}
