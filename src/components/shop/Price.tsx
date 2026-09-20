import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme, type TypographyVariant } from '../../theme';
import { formatDiscount, formatMoney } from '../../utils/format';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';

export type PriceSize = 'sm' | 'md' | 'lg';

const SIZES: Record<
  PriceSize,
  { price: TypographyVariant; mrp: TypographyVariant }
> = {
  sm: { price: 'bodyStrong', mrp: 'micro' },
  md: { price: 'h3', mrp: 'caption' },
  lg: { price: 'h2', mrp: 'body' },
};

interface Props {
  /** Paise. */
  price: number;
  /** The list price, in paise, struck through when higher; null for none. */
  mrp?: number | null;
  currency?: string;
  size?: PriceSize;
  /** Hides the "29% off" that a struck price would otherwise carry. */
  hideDiscount?: boolean;
}

/**
 * A selling price, and the list price it beats where there is one.
 *
 * Every money figure on a card, a sheet or a receipt goes through this,
 * the way every coin figure goes through `CoinAmount`, so the strike-
 * through, the saving and the grouping are decided once. The saving is
 * a percentage rather than a rupee figure because "29% off" is what a
 * shopper compares across a shelf; the rupees are already there to read.
 */
export const Price = memo(
  ({
    price,
    mrp = null,
    currency = 'INR',
    size = 'md',
    hideDiscount = false,
  }: Props) => {
    const { colors } = useTheme();
    const discount = hideDiscount ? null : formatDiscount(price, mrp);
    const variants = SIZES[size];

    return (
      <HStack align="baseline" gap="xs" wrap>
        <AppText variant={variants.price}>
          {formatMoney(price, currency)}
        </AppText>
        {mrp !== null && mrp > price ? (
          <AppText
            variant={variants.mrp}
            color="textTertiary"
            style={styles.struck}
          >
            {formatMoney(mrp, currency)}
          </AppText>
        ) : null}
        {discount ? (
          <AppText variant={variants.mrp} style={{ color: colors.success }}>
            {discount}
          </AppText>
        ) : null}
      </HStack>
    );
  },
);

Price.displayName = 'Price';

const styles = StyleSheet.create({
  struck: { textDecorationLine: 'line-through' },
});
