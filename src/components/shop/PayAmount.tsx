import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme, type TypographyVariant } from '../../theme';
import type { Quote } from '../../types/models';
import { formatMoney } from '../../utils/format';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { CoinAmount, type CoinAmountSize } from '../wallet/CoinAmount';

interface Props {
  quote: Pick<Quote, 'coinsApplied' | 'payable' | 'currency'>;
  size?: 'md' | 'lg';
}

const SIZES: Record<
  'md' | 'lg',
  { coins: CoinAmountSize; money: TypographyVariant; alone: TypographyVariant }
> = {
  md: { coins: 'md', money: 'bodyStrong', alone: 'h3' },
  lg: { coins: 'lg', money: 'h3', alone: 'h2' },
};

/**
 * What the member pays, as the till's quote splits it: the coins, the
 * money, or the coins and then "+ the money" — in the brand orange, the
 * way the redemption pages show the figure they are built around.
 *
 * Drawn from the server's quote and never summed here, so the product
 * page, the basket and its bar all show the figure the checkout charges.
 */
export const PayAmount = memo(({ quote, size = 'lg' }: Props) => {
  const { colors } = useTheme();
  const look = SIZES[size];
  const brand = { color: colors.brandAccent };
  const coins = quote.coinsApplied;
  const money = quote.payable;
  return (
    <HStack align="center" gap="xs" wrap>
      {coins > 0 ? (
        <HStack align="baseline" gap="xxs">
          <CoinAmount
            amount={coins}
            size={look.coins}
            tint={colors.brandAccent}
          />
          <AppText variant="micro" style={[brand, styles.unit]}>
            coins
          </AppText>
        </HStack>
      ) : null}
      {money > 0 || coins === 0 ? (
        <AppText variant={coins > 0 ? look.money : look.alone} style={brand}>
          {`${coins > 0 ? '+ ' : ''}${formatMoney(money, quote.currency)}`}
        </AppText>
      ) : null}
    </HStack>
  );
});

PayAmount.displayName = 'PayAmount';

const styles = StyleSheet.create({
  unit: { fontWeight: '600' },
});
