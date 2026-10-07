import React, { Fragment, memo } from 'react';
import { useTheme } from '../../theme';
import type { CoinTotals } from '../../types/models';
import { formatCoins, formatMoney } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';

export interface BreakdownFigures {
  currency: string;
  /** All paise. */
  mrpTotal?: number;
  discount: number;
  subtotal: number;
  shipping: number;
  coinsApplied: number;
  coinsValue: number;
  payable: number;
  /** The coupon that applied, and what it took off the goods in paise (RULES R16). */
  coupon?: { code: string; discount: number } | null;
  /** A coins-only order's rows in coins — drawn instead of the rupees. */
  inCoins?: CoinTotals | null;
}

interface Props {
  figures: BreakdownFigures;
  /** What the last line is called: "To pay" before, "Paid" after. */
  payableLabel?: string;
  /** Units across the order; given, it heads the list as "Total Items". */
  count?: number;
  /** What the goods row is called — the till says "Subtotal". */
  itemsLabel?: string;
  /**
   * A dashed row where a coupon would go, for a shop that offers them: the
   * till shows the member the saving they did not take, rather than hiding
   * the line and leaving them to wonder whether it was applied.
   */
  emptyCouponLabel?: string;
  /** Drawn in place of the last row's figure — the till's "You pay" in coins. */
  total?: React.ReactNode;
}

/**
 * The till's arithmetic, line by line, in the order it happens: the goods
 * at list price, the saving, the goods, the coupon, the shipping, the
 * coins, and what is left to pay in money (RULES R11–R13, R16). An order
 * from a coins-only shop reads in coins, from the server's own coin rows.
 *
 * Drawn from the server's figures and never re-added on the device: the
 * checkout, the cart and the receipt all pass what the server said, so
 * three screens cannot disagree about one order.
 */
export const PriceBreakdown = memo(
  ({
    figures,
    payableLabel = 'To pay',
    count,
    itemsLabel = 'Items',
    emptyCouponLabel,
    total,
  }: Props) => {
    const { colors } = useTheme();
    const money = (paise: number) => formatMoney(paise, figures.currency);
    const coins = (amount: number) => `${formatCoins(amount)} coins`;
    const rows: { label: string; value: string; tone?: 'success' | 'muted' }[] =
      [];
    const inCoins = figures.inCoins ?? null;
    const couponApplied = Boolean(
      figures.coupon &&
        (inCoins ? inCoins.discount > 0 : figures.coupon.discount > 0),
    );
    if (count !== undefined) {
      rows.push({ label: 'Total Items', value: String(count) });
    }
    if (inCoins) {
      rows.push({ label: itemsLabel, value: coins(inCoins.goods) });
      if (figures.coupon && inCoins.discount > 0) {
        rows.push({
          label: `Coupon (${figures.coupon.code})`,
          value: `− ${coins(inCoins.discount)}`,
          tone: 'success',
        });
      }
      rows.push({
        label: 'Delivery',
        value: inCoins.shipping === 0 ? 'Free' : coins(inCoins.shipping),
        tone: inCoins.shipping === 0 ? 'success' : undefined,
      });
    } else if (figures.mrpTotal !== undefined && figures.discount > 0) {
      rows.push({ label: 'Price', value: money(figures.mrpTotal) });
      rows.push({
        label: 'Discount',
        value: `− ${money(figures.discount)}`,
        tone: 'success',
      });
    }
    if (!inCoins) {
      rows.push({ label: itemsLabel, value: money(figures.subtotal) });
      if (figures.coupon && figures.coupon.discount > 0) {
        rows.push({
          label: `Coupon (${figures.coupon.code})`,
          value: `− ${money(figures.coupon.discount)}`,
          tone: 'success',
        });
      }
      rows.push({
        label: 'Delivery',
        value: figures.shipping === 0 ? 'Free' : money(figures.shipping),
        tone: figures.shipping === 0 ? 'success' : undefined,
      });
    }
    if (!inCoins && figures.coinsApplied > 0) {
      rows.push({
        label: `${formatCoins(figures.coinsApplied)} coins`,
        value: `− ${money(figures.coinsValue)}`,
        tone: 'success',
      });
    }
    if (emptyCouponLabel && !couponApplied) {
      rows.push({ label: emptyCouponLabel, value: '—', tone: 'muted' });
    }

    return (
      <VStack gap="sm">
        {rows.map(row => (
          <Fragment key={row.label}>
            <HStack align="center" justify="between">
              <AppText variant="body" color="textSecondary">
                {row.label}
              </AppText>
              <AppText
                variant="body"
                color={row.tone === 'muted' ? 'textTertiary' : undefined}
                style={
                  row.tone === 'success' ? { color: colors.success } : undefined
                }
              >
                {row.value}
              </AppText>
            </HStack>
          </Fragment>
        ))}
        <Divider />
        <HStack align="center" justify="between">
          <AppText variant="bodyStrong">{payableLabel}</AppText>
          {total ?? (
            <AppText variant="h3">
              {inCoins ? coins(inCoins.total) : money(figures.payable)}
            </AppText>
          )}
        </HStack>
      </VStack>
    );
  },
);

PriceBreakdown.displayName = 'PriceBreakdown';
