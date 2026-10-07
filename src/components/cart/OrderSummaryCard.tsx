import React, { Fragment, memo } from 'react';
import { StyleSheet } from 'react-native';
import { Lightbulb, TriangleAlert } from 'lucide-react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { Quote } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { formatCoins, formatMoney } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { PayAmount } from '../shop/PayAmount';
import { AppText } from '../ui/AppText';

interface Props {
  quote: Quote;
  /** Units across the basket. */
  count: number;
}

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.base,
      gap: spacing.md,
    },
    note: {
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    grow: { flex: 1 },
  });

/** What the member is told happens to their coins and money on confirming. */
function noteFor(quote: Quote): string {
  if (quote.paymentMode === 'coins') {
    return 'Coins will be deducted from your balance after you confirm your order.';
  }
  if (quote.coinsApplied > 0) {
    return quote.coinsMin < quote.coinsMax
      ? 'Coins will be deducted from your balance and the rest paid by card or UPI after you confirm. You can use fewer coins at checkout.'
      : 'Coins will be deducted from your balance and the rest paid by card or UPI after you confirm your order.';
  }
  return "You'll pay by card or UPI after you confirm your order.";
}

/**
 * The basket's sums, as the server quoted them (RULES R11–R13, R16): how
 * many things, what they cost, the coupon, the delivery when it is
 * charged, the coins when they go part of the way, and what the member
 * pays — with a line on when the coins leave the wallet. A coins-only shop
 * reads every row in coins, from the quote's own coin rows; the rest read
 * in rupees. Nothing here is added up on the device.
 */
export const OrderSummaryCard = memo(({ quote, count }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors, isDark } = useTheme();
  const coins = quote.inCoins;
  const money = (paise: number) => formatMoney(paise, quote.currency);
  const coupon = quote.coupon && !quote.coupon.problem ? quote.coupon : null;

  const rows: { label: string; value: string; tone?: 'success' }[] = [
    { label: 'Total Items', value: String(count) },
    {
      label: 'Total Price',
      value: coins
        ? `${formatCoins(coins.goods)} coins`
        : money(quote.subtotal),
    },
  ];
  if (coupon) {
    rows.push({
      label: `Coupon (${coupon.code})`,
      value: coins
        ? `− ${formatCoins(coins.discount)} coins`
        : `− ${money(coupon.discount)}`,
      tone: 'success',
    });
  }
  if (quote.shipping > 0) {
    rows.push({
      label: 'Delivery',
      value: coins
        ? `${formatCoins(coins.shipping)} coins`
        : money(quote.shipping),
    });
  }
  if (!coins && quote.coinsApplied > 0) {
    rows.push({
      label: `Coins (${formatCoins(quote.coinsApplied)})`,
      value: `− ${money(quote.coinsValue)}`,
      tone: 'success',
    });
  }

  return (
    <VStack style={styles.card}>
      <AppText variant="h3">Order Summary</AppText>
      <VStack gap="sm">
        {rows.map(row => (
          <Fragment key={row.label}>
            <HStack align="center" justify="between" gap="md">
              <AppText variant="caption" color="textSecondary">
                {row.label}
              </AppText>
              <AppText
                variant="bodyStrong"
                style={
                  row.tone === 'success' ? { color: colors.success } : undefined
                }
              >
                {row.value}
              </AppText>
            </HStack>
          </Fragment>
        ))}
      </VStack>
      <Divider />
      <HStack align="center" justify="between" gap="md">
        <AppText variant="bodyStrong">You Pay</AppText>
        <PayAmount quote={quote} size="lg" />
      </HStack>

      {quote.coinsShort > 0 ? (
        <HStack
          align="center"
          gap="sm"
          style={[
            styles.note,
            { backgroundColor: withAlpha(colors.warning, isDark ? 0.2 : 0.1) },
          ]}
        >
          <Icon as={TriangleAlert} size="sm" tint={colors.warning} />
          <AppText variant="micro" color="warning" style={styles.grow}>
            {`You need ${formatCoins(
              quote.coinsShort,
            )} more coins for this order.`}
          </AppText>
        </HStack>
      ) : (
        <HStack
          align="center"
          gap="sm"
          style={[
            styles.note,
            {
              backgroundColor: withAlpha(
                colors.brandAccent,
                isDark ? 0.16 : 0.08,
              ),
            },
          ]}
        >
          <Icon as={Lightbulb} size="sm" tint={colors.gold} />
          <AppText variant="micro" color="textSecondary" style={styles.grow}>
            {noteFor(quote)}
          </AppText>
        </HStack>
      )}
    </VStack>
  );
});

OrderSummaryCard.displayName = 'OrderSummaryCard';
