import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Lightbulb } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { withAlpha } from '../../utils/color';
import { formatCoins, formatMoney } from '../../utils/format';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

interface Props {
  /** The coins this order takes, as the quote has them. */
  coins: number;
  /** What is left to pay in money, in paise. */
  payable: number;
  currency: string;
}

const makeStyles = ({ spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    note: {
      borderRadius: radius.lg,
      borderWidth: 1,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.base,
    },
    grow: { flex: 1 },
  });

/** What confirming does to the wallet and the card, said before it happens. */
function wording(coins: number, payable: number, currency: string): string {
  if (coins === 0) {
    return `${formatMoney(
      payable,
      currency,
    )} will be charged after you confirm payment.`;
  }
  const deducted = `${formatCoins(
    coins,
  )} coins will be deducted after you confirm payment.`;
  return payable > 0
    ? `${deducted} The remaining ${formatMoney(
        payable,
        currency,
      )} is paid by card or UPI.`
    : deducted;
}

/**
 * The line between the sums and the pay button: what leaves the wallet, and
 * when. A member spending coins they earned by walking should read the
 * consequence before the button, not discover it on the receipt.
 */
export const CoinDeductionNote = memo(({ coins, payable, currency }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  return (
    <HStack
      align="center"
      gap="md"
      style={[
        styles.note,
        {
          backgroundColor: withAlpha(colors.gold, isDark ? 0.16 : 0.08),
          borderColor: withAlpha(colors.gold, isDark ? 0.35 : 0.2),
        },
      ]}
    >
      <Icon as={Lightbulb} size="sm" tint={colors.gold} />
      <AppText variant="micro" color="textSecondary" style={styles.grow}>
        {wording(coins, payable, currency)}
      </AppText>
    </HStack>
  );
});

CoinDeductionNote.displayName = 'CoinDeductionNote';
