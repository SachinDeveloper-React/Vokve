import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { spacing, typography } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { ShopItem } from '../../types/models';
import { Box } from '../layout/Box';
import { VStack } from '../layout/Stack';
import { ZStack } from '../layout/ZStack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CoinAmount } from '../wallet/CoinAmount';
import { ShopItemBadge } from './ShopItemBadge';

/**
 * Fixed so every card in the featured row is the same width whatever its
 * title, and so the row scrolls in even steps. Wide enough for a two-word
 * name and a button; narrow enough that the next card peeks in from the edge,
 * which is what tells a user the row scrolls.
 */
export const SHOP_ITEM_CARD_WIDTH = moderateScale(140);

interface Props {
  item: ShopItem;
  onPress: (item: ShopItem) => void;
}

/**
 * One reward in the featured row.
 *
 * The card leads to the item rather than redeeming it: a reward costs up to
 * a few thousand coins, and a one-tap spend on a card the thumb brushes while
 * scrolling a horizontal row is exactly the mistake a shop must not let
 * happen. The price is still here — what a user is scrolling *for* is what
 * things cost — but the spend lives behind "View Details".
 *
 * Sold-out items stay in the row with their art dimmed rather than
 * disappearing: a user saving up for one needs to be able to see it.
 */
export const ShopItemCard = memo(({ item, onPress }: Props) => {
  const handlePress = useCallback(() => onPress(item), [item, onPress]);

  return (
    <Card radius="xl" padding="md" style={styles.card}>
      <VStack gap="sm" flex={1}>
        <ZStack anchor="bottomLeft" style={!item.inStock && styles.soldOut}>
          <Box bg="muted" radius="lg" style={styles.art}>
            <Emoji size="xl" label={item.title}>
              {item.emoji}
            </Emoji>
          </Box>

          {item.badge ? (
            <Box p="sm">
              <ShopItemBadge badge={item.badge} />
            </Box>
          ) : null}
        </ZStack>

        <VStack gap="xs" flex={1}>
          <AppText variant="bodyStrong" numberOfLines={2} style={styles.title}>
            {item.title}
          </AppText>
          <CoinAmount amount={item.priceCoins} size="md" />
        </VStack>

        <Button
          label={item.inStock ? 'View Details' : 'Sold out'}
          size="xs"
          variant={item.inStock ? 'brand' : 'secondary'}
          fullWidth
          disabled={!item.inStock}
          onPress={handlePress}
        />
      </VStack>
    </Card>
  );
});

ShopItemCard.displayName = 'ShopItemCard';

/**
 * Three measurements the primitives have no tokens for: the card's fixed
 * width, the art well's height, and a two-line floor under the title so a
 * one-line name does not pull its price up out of line with its neighbours.
 */
const styles = StyleSheet.create({
  card: { width: SHOP_ITEM_CARD_WIDTH },
  art: {
    width: SHOP_ITEM_CARD_WIDTH - spacing.md * 2,
    height: moderateScale(96),
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { minHeight: typography.bodyStrong.lineHeight * 2 },
  soldOut: { opacity: 0.5 },
});
