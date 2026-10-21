import { ShopCategoryModel, ShopItemModel } from './models.js';

/**
 * The shelves, as both halves of the shop read them (RULES R9).
 *
 * `shop_categories` is young: the four shelves were a zod enum until an
 * operator needed a fifth, so every database that existed before this has
 * items on shelves that have no row yet. Rather than a migration that has
 * to be remembered, the first read of the shelves builds them from what the
 * items are already carrying — which is also what keeps a shelf written by
 * hand into an item from going missing from the panel.
 *
 * It lives beside the models rather than in the admin module because the
 * member's `/shop/categories` needs the same answer, and a member route
 * reaching into the operator's module to get it would be the wrong way
 * round.
 */

export type Shelf = {
  _id: string;
  name: string;
  description: string;
  icon: string;
  sort: number;
  active: boolean;
  subcategories: { name: string; sort: number; active: boolean }[];
};

/** The four the shop opened with, and the icon each was drawn with in the app. */
export const DEFAULT_SHELVES = [
  { _id: 'clothing', name: 'Clothes', icon: 'shirt', sort: 1 },
  { _id: 'gym', name: 'Gym', icon: 'dumbbell', sort: 2 },
  { _id: 'sports', name: 'Sports', icon: 'trophy', sort: 3 },
  { _id: 'accessories', name: 'Accessories', icon: 'watch', sort: 4 },
] as const;

/** `Yoga & Pilates` → `yoga-pilates`: the slug an item's `category` carries. */
export function slugifyShelf(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** `yoga-pilates` → `Yoga Pilates`: a readable label for a shelf nobody has named yet. */
export function titleOfSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Every shelf, in order, with the rows the items need but the collection
 * does not have yet.
 *
 * Two kinds of catching up, both idempotent and both cheap enough to run on
 * a read: a shelf an item names that has no row of its own, and a
 * subcategory typed onto an item that the shelf does not list. Neither
 * invents anything — the names come from the items — so an operator who
 * deletes a subcategory does not find it back the next morning: deleting
 * one moves the items off it first.
 */
export async function ensureShelves(): Promise<Shelf[]> {
  const [rows, used] = await Promise.all([
    ShopCategoryModel.find({}).lean(),
    ShopItemModel.aggregate<{ _id: string; subcategories: (string | null)[] }>([
      { $group: { _id: '$category', subcategories: { $addToSet: '$subcategory' } } },
    ]),
  ]);

  const have = new Map(rows.map(row => [row._id, { names: new Set((row.subcategories ?? []).map(sub => sub.name)) }]));
  const missing: Shelf[] = [
    // A fresh database gets the four the shop opened with, so the panel is
    // never a blank page an operator has to populate before listing a thing.
    ...(rows.length === 0
      ? DEFAULT_SHELVES.map(shelf => ({ ...shelf, description: '', active: true, subcategories: [] }))
      : []),
    ...used
      .filter(entry => entry._id && !have.has(entry._id))
      .map((entry, index) => ({
        _id: entry._id,
        name: titleOfSlug(entry._id),
        description: '',
        icon: 'category',
        sort: 100 + index,
        active: true,
        subcategories: [],
      })),
  ].filter((shelf, index, all) => all.findIndex(other => other._id === shelf._id) === index);

  await Promise.all(
    missing.map(shelf => ShopCategoryModel.updateOne({ _id: shelf._id }, { $setOnInsert: shelf }, { upsert: true })),
  );

  // The subcategories the items are actually filed under, added to whatever
  // the shelf already lists. `$addToSet` would not do: these are objects,
  // so a second run would add a second copy of one whose `sort` had moved.
  const named = new Map(
    used.map(entry => [entry._id, entry.subcategories.filter((name): name is string => Boolean(name))]),
  );
  await Promise.all(
    [...have.entries(), ...missing.map(shelf => [shelf._id, { names: new Set<string>() }] as const)].map(([slug, listed]) => {
      const extra = (named.get(slug) ?? []).filter(name => !listed.names.has(name));
      if (extra.length === 0) return null;
      return ShopCategoryModel.updateOne(
        { _id: slug },
        { $push: { subcategories: { $each: extra.map((name, index) => ({ name, sort: listed.names.size + index, active: true })) } } },
      );
    }),
  );

  const fresh = await ShopCategoryModel.find({}).sort({ sort: 1, name: 1 }).lean();
  return fresh.map(row => ({
    _id: row._id,
    name: row.name,
    description: row.description ?? '',
    icon: row.icon ?? 'category',
    sort: row.sort ?? 0,
    active: row.active !== false,
    subcategories: (row.subcategories ?? [])
      .map(sub => ({ name: sub.name, sort: sub.sort ?? 0, active: sub.active !== false }))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
  }));
}
