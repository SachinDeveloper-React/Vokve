import React, { memo, useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { spacing, useTheme } from '../../theme';
import type { ShopCategory, ShopCategorySummary } from '../../types/models';
import { Card } from '../ui/Card';
import { ALL_FILTER, DEALS_FILTER, shopCategoriesOf } from './categories';
import { ShopCategoryChip } from './ShopCategoryChip';

/**
 * `all` and `deals` are filter states, not categories, so they live here and
 * not in the model.
 */
export type ShopFilter = ShopCategory | 'all' | 'deals';

interface Props {
  value: ShopFilter;
  onChange: (value: ShopFilter) => void;
  /**
   * The shelves the server is carrying (`GET /shop/categories`). They are
   * rows an operator writes, so the row is drawn from them; without them
   * yet, the four the shop opened with.
   */
  categories?: readonly ShopCategorySummary[] | null;
}

/**
 * The shop's category row, on its own card.
 *
 * It scrolls rather than squeezing six chips across the width: at a sixth of
 * a 375pt card each chip is under 52pt, which breaks "Accessories" in the
 * middle of the word. Scrolling keeps every label whole and leaves room for a
 * seventh chip without a redesign.
 */
export const ShopCategoryFilter = memo(({ value, onChange, categories }: Props) => {
  const { colors } = useTheme();
  const filters = useMemo(
    () => [ALL_FILTER, ...shopCategoriesOf(categories), DEALS_FILTER],
    [categories],
  );

  return (
    <Card radius="xl" padding="md">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {filters.map(filter => (
          <ShopCategoryChip
            key={filter.value}
            value={filter.value}
            label={filter.label}
            icon={filter.icon}
            tint={colors[filter.tint]}
            selected={filter.value === value}
            onPress={onChange}
          />
        ))}
      </ScrollView>
    </Card>
  );
});

ShopCategoryFilter.displayName = 'ShopCategoryFilter';

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
});
