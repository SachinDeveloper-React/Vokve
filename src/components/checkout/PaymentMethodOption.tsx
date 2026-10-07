import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ChevronRight,
  Coins,
  CreditCard,
  Landmark,
  type LucideIcon,
} from 'lucide-react-native';
import {
  fontWeight,
  useTheme,
  useThemedStyles,
  type ThemeShape,
} from '../../theme';
import type { PaymentMethod } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

/**
 * What each way of paying is called and promises. A fixed enum the server
 * narrows (⚙ `commerce.paymentMethods`) rather than wording it, so the two
 * cannot disagree about what "Coins + UPI / Card" means.
 */
export const METHOD_COPY: Record<
  PaymentMethod,
  { title: string; caption: string }
> = {
  coins: {
    title: 'Pay with Coins',
    caption: 'Use your VOKVE coins balance',
  },
  coins_upi: {
    title: 'Coins + UPI / Card',
    caption: 'Use coins and pay remaining amount',
  },
  upi: { title: 'Pay with UPI', caption: 'Google Pay, PhonePe, Paytm etc.' },
  card: {
    title: 'Pay with Debit/Credit Card',
    caption: 'Visa, Mastercard, RuPay etc.',
  },
  netbanking: {
    title: 'Net Banking',
    caption: 'All major banks supported',
  },
};

const GLYPHS: Partial<Record<PaymentMethod, LucideIcon>> = {
  coins: Coins,
  card: CreditCard,
  netbanking: Landmark,
};

interface Props {
  method: PaymentMethod;
  selected: boolean;
  /** What this way would take, at the row's end once it is chosen. */
  amount?: React.ReactNode;
  /** A line under the amount — what the wallet holds. */
  note?: string;
  onSelect: (method: PaymentMethod) => void;
}

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    row: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.muted,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
    },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    glyph: { width: 28, alignItems: 'center' },
    upi: { fontWeight: fontWeight.bold },
    end: { alignItems: 'flex-end' },
  });

/**
 * One way to pay, as a radio row: the mark, a glyph that says at a glance
 * what it is, the name and what it means, and — on the one that is chosen
 * — what it would take. The rest carry a chevron, because picking them
 * leads on to the gateway's own sheet rather than finishing here.
 *
 * Only the ways the till said this order can be paid reach the page, so
 * every row here is one the member can actually pick: an order of
 * coins-only goods is one row, "Pay with Coins", already chosen.
 */
export const PaymentMethodOption = memo(
  ({ method, selected, amount, note, onSelect }: Props) => {
    const styles = useThemedStyles(makeStyles);
    const { colors, isDark } = useTheme();
    const copy = METHOD_COPY[method];
    const glyph = GLYPHS[method];
    const select = useCallback(() => onSelect(method), [method, onSelect]);

    return (
      <Pressable
        onPress={select}
        feedback="opacity"
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${copy.title}. ${copy.caption}`}
      >
        <HStack
          align="center"
          gap="md"
          style={[
            styles.row,
            selected && {
              borderColor: colors.brandAccent,
              backgroundColor: withAlpha(
                colors.brandAccent,
                isDark ? 0.14 : 0.07,
              ),
            },
          ]}
        >
          <View
            style={[
              styles.radio,
              selected && { borderColor: colors.brandAccent },
            ]}
          >
            {selected ? (
              <View
                style={[styles.dot, { backgroundColor: colors.brandAccent }]}
              />
            ) : null}
          </View>

          <View style={styles.glyph}>
            {glyph ? (
              <Icon
                as={glyph}
                size="md"
                tint={method === 'coins' ? colors.gold : colors.textSecondary}
              />
            ) : method === 'upi' ? (
              <AppText
                variant="micro"
                style={[styles.upi, { color: colors.avatarPurple }]}
              >
                UPI
              </AppText>
            ) : (
              <HStack align="center" gap="xxs">
                <Icon as={Coins} size="xs" tint={colors.gold} />
                <AppText variant="micro" color="textSecondary">
                  + ₹
                </AppText>
              </HStack>
            )}
          </View>

          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong">{copy.title}</AppText>
            <AppText variant="micro" color="textTertiary">
              {copy.caption}
            </AppText>
          </VStack>

          {amount ? (
            <VStack gap="xxs" style={styles.end}>
              {amount}
              {note ? (
                <AppText variant="micro" color="textTertiary">
                  {note}
                </AppText>
              ) : null}
            </VStack>
          ) : (
            <Icon as={ChevronRight} size="sm" color="textSecondary" />
          )}
        </HStack>
      </Pressable>
    );
  },
);

PaymentMethodOption.displayName = 'PaymentMethodOption';
