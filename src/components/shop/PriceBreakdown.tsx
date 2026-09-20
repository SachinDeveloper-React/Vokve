import React, { Fragment, memo } from 'react';
import { useTheme } from '../../theme';
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
}

interface Props {
  figures: BreakdownFigures;
  /** What the last line is called: "To pay" before, "Paid" after. */
  payableLabel?: string;
}

/**
 * The till's arithmetic, line by line, in the order it happens: the goods
 * at list price, the saving, the goods, the shipping, the coins, and what
 * is left to pay in money (RULES R11–R13).
 *
 * Drawn from the server's figures and never re-added on the device: the
 * checkout, the cart and the receipt all pass what the server said, so
 * three screens cannot disagree about one order.
 */
export const PriceBreakdown = memo(
  ({ figures, payableLabel = 'To pay' }: Props) => {
    const { colors } = useTheme();
    const money = (paise: number) => formatMoney(paise, figures.currency);
    const rows: { label: string; value: string; tone?: 'success' | 'muted' }[] =
      [];
    if (figures.mrpTotal !== undefined && figures.discount > 0) {
      rows.push({ label: 'Price', value: money(figures.mrpTotal) });
      rows.push({
        label: 'Discount',
        value: `− ${money(figures.discount)}`,
        tone: 'success',
      });
    }
    rows.push({
      label: figures.discount > 0 ? 'Items' : 'Items',
      value: money(figures.subtotal),
    });
    rows.push({
      label: 'Delivery',
      value: figures.shipping === 0 ? 'Free' : money(figures.shipping),
      tone: figures.shipping === 0 ? 'success' : undefined,
    });
    if (figures.coinsApplied > 0) {
      rows.push({
        label: `${formatCoins(figures.coinsApplied)} coins`,
        value: `− ${money(figures.coinsValue)}`,
        tone: 'success',
      });
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
          <AppText variant="h3">{money(figures.payable)}</AppText>
        </HStack>
      </VStack>
    );
  },
);

PriceBreakdown.displayName = 'PriceBreakdown';
