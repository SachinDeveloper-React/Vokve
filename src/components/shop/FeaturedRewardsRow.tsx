import React, { memo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import type { ShopItem } from '../../types/models';
import { Box } from '../layout/Box';
import { VStack } from '../layout/Stack';
import { EmptyState } from '../ui/EmptyState';
import { ShopItemCard } from './ShopItemCard';
import { ShopSectionHeader } from './ShopSectionHeader';

interface Props {
  items: ShopItem[];
  onPressItem: (item: ShopItem) => void;
  onPressViewAll: () => void;
}

/**
 * The featured shelf: a titled, horizontally scrolling row of rewards.
 *
 * A horizontal row rather than the two-column grid the shop used to open
 * with. The grid put every reward on screen at once and pushed the category
 * tiles and the guarantees below the fold; a shelf shows the first three and
 * leaves the rest of the page — where a user finds the category they wanted
 * — in view.
 *
 * An empty filter says so in place, at the shelf's own height, so the page
 * below it does not jump when the user taps a category with nothing in it.
 */
export const FeaturedRewardsRow = memo(
  ({ items, onPressItem, onPressViewAll }: Props) => (
    <VStack gap="md">
      <ShopSectionHeader title="Featured Rewards" onPressViewAll={onPressViewAll} />

      {items.length === 0 ? (
        <Box py="xl">
          <EmptyState
            title="Nothing here yet"
            message="No rewards in this category right now. Check back after the next drop."
          />
        </Box>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          // Pulled out to the screen edges so cards can scroll past the
          // gutter instead of being clipped inside it.
          style={styles.bleed}
        >
          {items.map(item => (
            <ShopItemCard key={item.id} item={item} onPress={onPressItem} />
          ))}
        </ScrollView>
      )}
    </VStack>
  ),
);

FeaturedRewardsRow.displayName = 'FeaturedRewardsRow';

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -spacing.base },
  row: {
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
  },
});
