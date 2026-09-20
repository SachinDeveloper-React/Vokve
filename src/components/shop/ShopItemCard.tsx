import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { ShoppingCart } from 'lucide-react-native';
import { spacing, typography, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { ShopItem } from '../../types/models';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { ZStack } from '../layout/ZStack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { CoinAmount } from '../wallet/CoinAmount';
import { Price } from './Price';
import { RatingStars } from './RatingStars';
import { ShopItemBadge } from './ShopItemBadge';
import { WishlistButton } from './WishlistButton';
import { useAddToCart } from './useAddToCart';

/**
 * Fixed so every card in the featured row is the same width whatever its
 * title, and so the row scrolls in even steps. Wide enough for a two-word
 * name and a button; narrow enough that the next card peeks in from the edge,
 * which is what tells a user the row scrolls.
 */
export const SHOP_ITEM_CARD_WIDTH = moderateScale(156);

interface Props {
  item: ShopItem;
  /** Opens the item — the card's body, and the "Add" of a sized item. */
  onPress: (item: ShopItem) => void;
  /**
   * Take the width given rather than the row's fixed one — for a grid
   * column on the browse and search pages, where the column decides.
   */
  fill?: boolean;
}

/**
 * One item on a shelf: art, price against list price, its stars, a heart,
 * and a way into the basket.
 *
 * The card's body leads to the item; only the small "Add" puts it in the
 * basket, and a sized item does not even do that from here — a tee with
 * no size is not a thing that can be packed, so the tap opens the page
 * where the sizes are. The coins line says what the wallet can do towards
 * it, which is what a user of this shop is scrolling for.
 *
 * Sold-out items stay on the shelf with their art dimmed rather than
 * disappearing: a user saving up for one needs to be able to see it.
 */
export const ShopItemCard = memo(({ item, onPress, fill = false }: Props) => {
  const { colors } = useTheme();
  const addToCart = useAddToCart();
  const handlePress = useCallback(() => onPress(item), [item, onPress]);
  const handleAdd = useCallback(() => {
    if (item.sizes.length > 0) {
      onPress(item);
      return;
    }
    addToCart(item);
  }, [addToCart, item, onPress]);

  return (
    <Card radius="xl" padding="md" style={fill ? styles.fill : styles.card}>
      <VStack gap="sm" flex={1}>
        <Pressable
          onPress={handlePress}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel={`${item.title}, view details`}
        >
          <ZStack anchor="bottomLeft" style={!item.inStock && styles.soldOut}>
            <Box
              bg="muted"
              radius="lg"
              style={fill ? styles.artFill : styles.art}
            >
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
        </Pressable>

        <View style={styles.heart}>
          <WishlistButton item={item} size="sm" raised />
        </View>

        <VStack gap="xs" flex={1}>
          <AppText variant="bodyStrong" numberOfLines={2} style={styles.title}>
            {item.title}
          </AppText>
          <RatingStars
            value={item.rating.average}
            count={item.rating.count}
            emptyLabel="No reviews yet"
          />
          <Price
            price={item.price}
            mrp={item.mrp}
            currency={item.currency}
            size="sm"
          />
          {item.coinsMax > 0 ? (
            <HStack align="center" gap="xxs">
              <AppText variant="micro" color="textSecondary">
                up to
              </AppText>
              <CoinAmount amount={item.coinsMax} size="sm" />
            </HStack>
          ) : null}
        </VStack>

        <Button
          label={
            item.inStock
              ? item.sizes.length > 0
                ? 'Choose size'
                : 'Add'
              : 'Sold out'
          }
          size="xs"
          variant={item.inStock ? 'brand' : 'secondary'}
          fullWidth
          disabled={!item.inStock}
          icon={
            item.inStock && item.sizes.length === 0 ? (
              <Icon
                as={ShoppingCart}
                size="xs"
                tint={colors.primaryForeground}
              />
            ) : undefined
          }
          onPress={handleAdd}
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
  fill: { flex: 1 },
  art: {
    width: SHOP_ITEM_CARD_WIDTH - spacing.md * 2,
    height: moderateScale(96),
    alignItems: 'center',
    justifyContent: 'center',
  },
  artFill: {
    alignSelf: 'stretch',
    height: moderateScale(96),
    alignItems: 'center',
    justifyContent: 'center',
  },
  heart: { position: 'absolute', top: spacing.xs, right: spacing.xs },
  title: { minHeight: typography.bodyStrong.lineHeight * 2 },
  soldOut: { opacity: 0.5 },
});
