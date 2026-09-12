import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { moderateScale } from '../../theme/responsive';
import type { ShopItem } from '../../types/models';
import { formatCoins } from '../../utils/format';
import { BottomSheet } from '../disclosure/BottomSheet';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { CoinAmount } from '../wallet/CoinAmount';
import { SHOP_CATEGORIES } from './categories';
import { ShopItemBadge } from './ShopItemBadge';

interface Props {
  /** The reward being looked at, or null to close the sheet. */
  item: ShopItem | null;
  /** The user's coins, so the sheet can say why it cannot be redeemed. */
  balance: number;
  onRedeem: (item: ShopItem) => void;
  onClose: () => void;
}

/**
 * A reward's details, with the one button that spends coins on it.
 *
 * An item the user cannot afford still shows its price and its art — hiding
 * it would leave them unable to see what they are saving towards. The button
 * says exactly what is missing ("Need 260 more") instead of being disabled
 * with no explanation.
 *
 * The sheet closes itself after a redeem: the toast the screen raises is the
 * confirmation, and a sheet still open behind it would leave a second
 * "Redeem" one tap away from a double spend.
 */
export const ShopItemDetailSheet = memo(
  ({ item, balance, onRedeem, onClose }: Props) => {
    const handleRedeem = useCallback(() => {
      if (item) {
        onRedeem(item);
      }
      onClose();
    }, [item, onClose, onRedeem]);

    if (!item) {
      return null;
    }

    const shortfall = item.priceCoins - balance;
    const affordable = shortfall <= 0;
    const categoryLabel =
      SHOP_CATEGORIES.find(c => c.value === item.category)?.label ?? '';

    const label = !item.inStock
      ? 'Sold out'
      : affordable
      ? 'Redeem'
      : `Need ${formatCoins(shortfall)} more`;

    return (
      <BottomSheet visible onClose={onClose} title={item.title}>
        <VStack gap="base" pb="base">
          <Box bg="muted" radius="xl" style={styles.art}>
            <Emoji size={moderateScale(64)} label={item.title}>
              {item.emoji}
            </Emoji>
          </Box>

          <VStack gap="sm">
            <HStack align="center" gap="sm" wrap>
              <AppText variant="label" color="textTertiary">
                {categoryLabel}
              </AppText>
              {item.badge ? <ShopItemBadge badge={item.badge} /> : null}
            </HStack>

            <AppText variant="body" color="textSecondary">
              {item.description}
            </AppText>
          </VStack>

          <HStack align="center" justify="between" gap="base">
            <CoinAmount amount={item.priceCoins} size="lg" />

            <Button
              label={label}
              variant={affordable && item.inStock ? 'brand' : 'secondary'}
              disabled={!item.inStock || !affordable}
              onPress={handleRedeem}
            />
          </HStack>
        </VStack>
      </BottomSheet>
    );
  },
);

ShopItemDetailSheet.displayName = 'ShopItemDetailSheet';

/** The art well's height — a measurement the spacing scale does not carry. */
const styles = StyleSheet.create({
  art: {
    height: moderateScale(160),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
