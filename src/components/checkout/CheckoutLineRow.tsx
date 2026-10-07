import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { Quote } from '../../types/models';
import { formatMoney } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppImage } from '../media/AppImage';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import { CoinAmount } from '../wallet/CoinAmount';

/** The art tile, square, as the design draws it beside the name. */
const ART = moderateScale(72);

/**
 * What the row needs of a line, named rather than taken from `Quote` so a
 * placed order's item can be drawn by the same row: the till and the
 * receipt list the same thing and should not look different doing it.
 */
export type CheckoutLine = Pick<
  Quote['lines'][number],
  'title' | 'emoji' | 'image' | 'quantity' | 'size' | 'color' | 'lineTotal' | 'lineCoins'
> & {
  /** Only a basket can be out of stock; a placed order has its units. */
  inStock?: boolean;
};

interface Props {
  line: CheckoutLine;
  currency: string;
  /** An order read in coins shows the line in coins rather than rupees. */
  inCoins: boolean;
}

const makeStyles = ({ colors, radius }: ThemeShape) =>
  StyleSheet.create({
    art: {
      width: ART,
      height: ART,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    soldOut: { opacity: 0.5 },
    unit: { fontWeight: '600' },
  });

/**
 * One line of the order as the till lists it: the art, the name, the size
 * and colour chosen, how many, and what the line comes to — in coins where
 * the shop is coins-only, in rupees otherwise.
 *
 * Every figure is the quote's own, so this row and the summary beneath it
 * cannot disagree about one order.
 */
export const CheckoutLineRow = memo(({ line, currency, inCoins }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const brand = { color: colors.brandAccent };
  const meta = [
    line.size ? `Size: ${line.size}` : null,
    line.color ? `Color: ${line.color}` : null,
  ].filter(Boolean);

  return (
    <HStack align="start" gap="md">
      <View style={[styles.art, line.inStock === false && styles.soldOut]}>
        <AppImage
          uri={line.image}
          width={ART - 2}
          height={ART - 2}
          radius="none"
          resizeMode="cover"
          accessibilityLabel={line.title}
          fallback={
            <Emoji size={moderateScale(28)} label={line.title}>
              {line.emoji}
            </Emoji>
          }
        />
      </View>

      <VStack flex={1} gap="xxs">
        <AppText variant="bodyStrong" numberOfLines={2}>
          {line.title}
        </AppText>
        {meta.length > 0 ? (
          <AppText variant="caption" color="textSecondary">
            {meta.join('  •  ')}
          </AppText>
        ) : null}
        <HStack align="center" justify="between" gap="sm">
          <AppText variant="caption" color="textSecondary">
            {`Qty: ${line.quantity}`}
          </AppText>
          {inCoins ? (
            <HStack align="baseline" gap="xxs">
              <CoinAmount
                amount={line.lineCoins}
                size="md"
                tint={colors.brandAccent}
              />
              <AppText variant="micro" style={[brand, styles.unit]}>
                coins
              </AppText>
            </HStack>
          ) : (
            <AppText variant="bodyStrong" style={brand}>
              {formatMoney(line.lineTotal, currency)}
            </AppText>
          )}
        </HStack>
        {line.inStock === false ? (
          <AppText variant="micro" color="warning">
            Sold out — remove it to continue
          </AppText>
        ) : null}
      </VStack>
    </HStack>
  );
});

CheckoutLineRow.displayName = 'CheckoutLineRow';
