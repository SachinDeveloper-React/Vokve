import React, { memo } from 'react';
import { useTheme } from '../../theme';
import type {
  ShopCategory,
  ShopCategorySummary,
  ShopItem,
} from '../../types/models';
import { Grid } from '../layout/Grid';
import { VStack } from '../layout/Stack';
import { SHOP_CATEGORIES } from './categories';
import { ShopCategoryTile } from './ShopCategoryTile';
import { ShopSectionHeader } from './ShopSectionHeader';

interface Props {
  /** The catalogue on hand — what the grid counts from before the server has said. */
  items: ShopItem[];
  /**
   * The server's own per-shelf figures (`GET /shop/categories`), which win
   * once present: the catalogue on hand is one page of the shelf, and a
   * count from it would fall short the day the shelf outgrows a page.
   */
  summaries?: ShopCategorySummary[] | null;
  onPressCategory: (category: ShopCategory) => void;
}

/**
 * The four category tiles, with a live count on each.
 *
 * Two columns on a phone, four on anything wider. Four across a 375pt screen
 * leaves each tile under 60pt inside, which breaks "Accessories" in the
 * middle of the word.
 */
export const TopCategoriesGrid = memo(
  ({ items, summaries = null, onPressCategory }: Props) => {
    const { colors } = useTheme();
    const countOf = (category: ShopCategory) =>
      summaries?.find(summary => summary.category === category)?.count ??
      items.filter(item => item.category === category).length;

    return (
      <VStack gap="md">
        <ShopSectionHeader title="Top Categories" />

        <Grid columns={{ compact: 2, medium: 4 }} gap="md">
          {SHOP_CATEGORIES.map(category => (
            <ShopCategoryTile
              key={category.value}
              category={category.value}
              label={category.label}
              icon={category.icon}
              tint={colors[category.tint]}
              count={countOf(category.value)}
              onPress={onPressCategory}
            />
          ))}
        </Grid>
      </VStack>
    );
  },
);

TopCategoriesGrid.displayName = 'TopCategoriesGrid';
