import {
  Dumbbell,
  LayoutGrid,
  Percent,
  Shirt,
  Sparkles,
  Watch,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { ThemeColors } from '../../constants/colors';
import type { ShopCategory } from '../../types/models';

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
 * How each category looks, declared once.
 *
 * The filter row and the "Top Categories" grid both draw every category with
 * its own icon and colour, and the two are on the same screen: a category
 * that was purple in the row and green in the grid would read as two
 * different things. Ordered as the design lists them.
 */
export const SHOP_CATEGORIES: readonly ShopCategoryPresentation[] = [
  { value: 'apparel', label: 'Apparel', icon: Shirt, tint: 'avatarPurple' },
  { value: 'accessories', label: 'Accessories', icon: Watch, tint: 'avatarGreen' },
  { value: 'gear', label: 'Fitness Gear', icon: Dumbbell, tint: 'primary' },
  { value: 'lifestyle', label: 'Lifestyle', icon: Sparkles, tint: 'brandAccent' },
];

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
