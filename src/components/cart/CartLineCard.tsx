import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Delete } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { CartLine, PaymentMode, Quote } from '../../types/models';
import { formatMoney } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppImage } from '../media/AppImage';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { QuantityStepper } from '../shop/QuantityStepper';
import { AppText } from '../ui/AppText';
import { CoinAmount } from '../wallet/CoinAmount';
import { Pressable } from '../form/Pressable';

/** Wide enough for the stepper beneath it, which has a fixed width. */
const COLUMN = 120;

interface Props {
  line: CartLine;
  /** The quote's own figures for this line — its coin price in a coins-only shop. */
  quoteLine: Quote['lines'][number] | undefined;
  mode: PaymentMode;
  /** The most of one line the till allows (⚙ `commerce.maxQuantityPerLine`). */
  max: number;
  busy: boolean;
  onChangeQuantity: (line: CartLine, quantity: number) => void;
  onRemove: (line: CartLine) => void;
  onPressItem: (id: string) => void;
}

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
    },
    column: { width: COLUMN },
    art: {
      width: COLUMN,
      height: COLUMN,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    soldOut: { opacity: 0.5 },
    title: { flex: 1 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    unit: { fontWeight: '600' },
  });

/**
 * One line of the basket as a card: the art with its stepper beneath, and
 * beside it the name, the size and colour chosen, the unit price, and the
 * line's total in the corner — in coins when the shop is coins-only, in
 * rupees otherwise. The bin in the corner takes the whole line; the
 * stepper stops at one, so a slip on the minus never empties it.
 */
export const CartLineCard = memo(
  ({
    line,
    quoteLine,
    mode,
    max,
    busy,
    onChangeQuantity,
    onRemove,
    onPressItem,
  }: Props) => {
    const styles = useThemedStyles(makeStyles);
    const { colors } = useTheme();
    const { item } = line;
    const swatch = line.color
      ? item.colors.find(entry => entry.name === line.color)?.hex ?? null
      : null;
    // The line's own way of being bought, not the shop's (RULES R11).
    const inCoins = (quoteLine?.paymentMode ?? mode) === 'coins';
    const unitCoins = quoteLine?.coinPrice ?? item.coinPrice;
    const lineCoins = quoteLine?.lineCoins ?? unitCoins * line.quantity;
    const lineMoney = quoteLine?.lineTotal ?? item.price * line.quantity;
    const brand = { color: colors.brandAccent };

    const change = useCallback(
      (quantity: number) => onChangeQuantity(line, quantity),
      [line, onChangeQuantity],
    );
    const remove = useCallback(() => onRemove(line), [line, onRemove]);
    const open = useCallback(
      () => onPressItem(item.id),
      [item.id, onPressItem],
    );

    return (
      <HStack gap="md" align="stretch" style={styles.card}>
        <VStack gap="md" style={styles.column}>
          <Pressable
            onPress={open}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, view details`}
          >
            <View style={[styles.art, !item.inStock && styles.soldOut]}>
              <AppImage
                uri={item.images[0]}
                width={COLUMN - 2}
                height={COLUMN - 2}
                radius="none"
                resizeMode="cover"
                accessibilityLabel={item.title}
                fallback={
                  <Emoji size={moderateScale(40)} label={item.title}>
                    {item.emoji}
                  </Emoji>
                }
              />
            </View>
          </Pressable>
          <QuantityStepper
            value={line.quantity}
            max={max}
            onChange={change}
            busy={busy}
            label={item.title}
          />
        </VStack>

        <VStack flex={1} gap="xs" justify="between">
          <VStack gap="xs">
            <HStack align="start" gap="sm">
              <AppText variant="h3" numberOfLines={2} style={styles.title}>
                {item.title}
              </AppText>
              <Pressable
                onPress={remove}
                feedback="opacity"
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.title}`}
              >
                <Icon as={Delete} size="md" color="textSecondary" />
              </Pressable>
            </HStack>
            {line.size ? (
              <AppText variant="caption" color="textSecondary">
                {`Size: ${line.size}`}
              </AppText>
            ) : null}
            {line.color ? (
              <HStack align="center" gap="xs">
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: swatch ?? colors.textTertiary },
                  ]}
                />
                <AppText variant="caption" color="textSecondary">
                  {`Color: ${line.color}`}
                </AppText>
              </HStack>
            ) : null}
            <HStack align="center" gap="xs" wrap>
              <AppText variant="caption" color="textSecondary">
                Price:
              </AppText>
              {inCoins ? (
                <HStack align="baseline" gap="xxs">
                  <CoinAmount
                    amount={unitCoins}
                    size="md"
                    tint={colors.brandAccent}
                  />
                  <AppText variant="micro" style={[brand, styles.unit]}>
                    coins
                  </AppText>
                </HStack>
              ) : (
                <AppText variant="bodyStrong" style={brand}>
                  {formatMoney(item.price, item.currency)}
                </AppText>
              )}
            </HStack>
            {!item.inStock ? (
              <AppText variant="micro" color="warning">
                Sold out — remove it to check out
              </AppText>
            ) : null}
          </VStack>

          <HStack justify="end">
            {inCoins ? (
              <HStack align="baseline" gap="xxs">
                <CoinAmount
                  amount={lineCoins}
                  size="lg"
                  tint={colors.brandAccent}
                />
                <AppText variant="micro" style={[brand, styles.unit]}>
                  coins
                </AppText>
              </HStack>
            ) : (
              <AppText variant="h2" style={brand}>
                {formatMoney(lineMoney, item.currency)}
              </AppText>
            )}
          </HStack>
        </VStack>
      </HStack>
    );
  },
);

CartLineCard.displayName = 'CartLineCard';
