import {
  CupSoda,
  Dumbbell,
  Footprints,
  Gift,
  Headphones,
  HeartPulse,
  LayoutGrid,
  Percent,
  Shirt,
  ShoppingBag,
  Tag,
  Trophy,
  Watch,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { ThemeColors } from '../../constants/colors';
import type {
  ShopCategory,
  ShopCategoryIcon,
  ShopCategorySummary,
} from '../../types/models';

/**
 * A colour token name rather than a colour: the row and the tile grid render
 * in both themes, and a literal picked for one of them would be wrong in the
 * other. Resolved with `colors[tint]` at render.
 */
export type CategoryTint = Extract<
  keyof ThemeColors,
  'brandAccent' | 'primary' | 'avatarPurple' | 'avatarGreen' | 'warning'
>;

export interface ShopCategoryPresentation {
  value: ShopCategory;
  label: string;
  icon: LucideIcon;
  tint: CategoryTint;
}

/**
 * The glyph each icon key draws.
 *
 * The shelves are rows an operator writes, so the server sends a key and
 * this maps it to something the app ships. A key this build has never heard
 * of falls through to the plain grid tile — which is the whole point: a
 * shelf added this afternoon has to draw itself on a phone installed last
 * month.
 */
const GLYPHS: Record<ShopCategoryIcon, LucideIcon> = {
  shirt: Shirt,
  dumbbell: Dumbbell,
  trophy: Trophy,
  watch: Watch,
  shoe: Footprints,
  bottle: CupSoda,
  bag: ShoppingBag,
  headphones: Headphones,
  heart: HeartPulse,
  gift: Gift,
  tag: Tag,
  category: LayoutGrid,
};

/**
 * The colours the design gave the shop's own four, by slug.
 *
 * By slug and not by position: a shelf keeps its colour when another is
 * added in front of it, which matters because the filter row and the tile
 * grid are on the same screen — one that was purple above and green below
 * would read as two different shelves.
 */
const TINTS: Record<string, CategoryTint> = {
  clothing: 'avatarPurple',
  gym: 'primary',
  sports: 'brandAccent',
  accessories: 'avatarGreen',
};

/** The five the theme offers, for a shelf the design never named. */
const SPARE: readonly CategoryTint[] = [
  'avatarPurple',
  'primary',
  'brandAccent',
  'avatarGreen',
  'warning',
];

/**
 * A stable colour for a shelf nobody chose one for: the same slug always
 * lands on the same tint, so it does not change colour between launches.
 */
function tintOf(slug: string): CategoryTint {
  const known = TINTS[slug];
  if (known) return known;
  let sum = 0;
  for (let index = 0; index < slug.length; index += 1) {
    sum = (sum + slug.charCodeAt(index)) % 997;
  }
  return SPARE[sum % SPARE.length];
}

/** `yoga-pilates` → `Yoga Pilates`, for a shelf the server sent no label for. */
function labelOfSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * What the shop draws before the server has answered.
 *
 * The four it opened with, in the order the design lists them. Only a
 * fallback now: `GET /shop/categories` is the real list, and it is what
 * every screen below prefers — but a cold start with no cached catalogue
 * still has a filter row rather than an empty card.
 */
export const SHOP_CATEGORIES: readonly ShopCategoryPresentation[] = [
  { value: 'clothing', label: 'Clothes', icon: Shirt, tint: 'avatarPurple' },
  { value: 'gym', label: 'Gym', icon: Dumbbell, tint: 'primary' },
  { value: 'sports', label: 'Sports', icon: Trophy, tint: 'brandAccent' },
  {
    value: 'accessories',
    label: 'Accessories',
    icon: Watch,
    tint: 'avatarGreen',
  },
];

/**
 * The shelves to draw, from what the server said.
 *
 * The summaries are already in the operator's order, so this keeps it: the
 * row, the grid and the search chips are then one list in one order, which
 * is how somebody reading the panel expects their shelves to appear.
 */
export function shopCategoriesOf(
  summaries?: readonly ShopCategorySummary[] | null,
): readonly ShopCategoryPresentation[] {
  if (!summaries || summaries.length === 0) return SHOP_CATEGORIES;
  return summaries.map(summary => ({
    value: summary.category,
    label: summary.label || labelOfSlug(summary.category),
    icon: GLYPHS[summary.icon] ?? LayoutGrid,
    tint: tintOf(summary.category),
  }));
}

/**
 * The presentation for one shelf, for a screen opened on it.
 *
 * Falls back to the shelf's own slug rather than to another shelf: a page
 * opened on a category the summaries have not arrived for should say what
 * it is, not quietly claim to be Clothes.
 */
export function presentationOf(
  category: ShopCategory,
  summaries?: readonly ShopCategorySummary[] | null,
): ShopCategoryPresentation {
  const known = shopCategoriesOf(summaries).find(
    entry => entry.value === category,
  );
  return (
    known ?? {
      value: category,
      label: labelOfSlug(category),
      icon: LayoutGrid,
      tint: tintOf(category),
    }
  );
}

/**
 * The two filter chips that are not categories. `all` clears the filter;
 * `deals` cuts across every category to the items flagged as deals.
 */
export const ALL_FILTER = {
  value: 'all',
  label: 'All',
  icon: LayoutGrid,
  tint: 'brandAccent',
} as const;

export const DEALS_FILTER = {
  value: 'deals',
  label: 'Deals',
  icon: Percent,
  tint: 'warning',
} as const;
