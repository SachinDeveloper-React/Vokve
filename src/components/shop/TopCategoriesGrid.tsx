import React, { memo } from 'react';
import { useTheme } from '../../theme';
import type { ShopCategory, ShopItem } from '../../types/models';
import { Grid } from '../layout/Grid';
import { VStack } from '../layout/Stack';
import { SHOP_CATEGORIES } from './categories';
import { ShopCategoryTile } from './ShopCategoryTile';
import { ShopSectionHeader } from './ShopSectionHeader';

interface Props {
  /** The whole catalogue — the grid counts each category's share itself. */
  items: ShopItem[];
  onPressCategory: (category: ShopCategory) => void;
}

/**
 * The four category tiles, with a live count on each.
 *
 * Counts are derived from the catalogue here rather than passed in: a count
 * that was stored beside the category would be one more number able to
 * disagree with the row it describes.
 *
 * Two columns on a phone, four on anything wider. Four across a 375pt screen
 * leaves each tile under 60pt inside, which breaks "Accessories" in the
 * middle of the word.
 */
export const TopCategoriesGrid = memo(({ items, onPressCategory }: Props) => {
  const { colors } = useTheme();

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
            count={items.filter(item => item.category === category.value).length}
            onPress={onPressCategory}
          />
        ))}
      </Grid>
    </VStack>
  );
});

TopCategoriesGrid.displayName = 'TopCategoriesGrid';
