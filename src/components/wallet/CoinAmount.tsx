import React, { memo } from 'react';
import { Coins } from 'lucide-react-native';
import { useTheme, type TypographyVariant } from '../../theme';
import { formatCoins } from '../../utils/format';
import { HStack } from '../layout/Stack';
import { Icon, type IconSize } from '../media/Icon';
import { AppText } from '../ui/AppText';

export type CoinAmountSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<
  CoinAmountSize,
  { text: TypographyVariant; icon: IconSize }
> = {
  sm: { text: 'micro', icon: 'xs' },
  md: { text: 'bodyStrong', icon: 'sm' },
  lg: { text: 'h2', icon: 'md' },
  xl: { text: 'metric', icon: 'xl' },
};

interface Props {
  amount: number;
  size?: CoinAmountSize;
  /**
   * Prefixes a credit with `+`. Ledger rows want it — `+100` next to `-450`
   * says which way the coins went without relying on the colour, which a
   * colourblind reader may not be able to tell apart.
   */
  signed?: boolean;
  /** Overrides the coin gold — a spent row is deliberately muted. */
  tint?: string;
  /**
   * Writes the unit out — `200 Coins` rather than `200`. For the places a coin
   * figure stands on its own, away from the wallet's own context: a reward
   * chip on the challenge board has nothing else nearby to say what the
   * number counts.
   */
  withUnit?: boolean;
}

/**
 * A coin figure: the coin glyph and the number, always in that pairing.
 *
 * Every place coins appear goes through this — the wallet balance, a ledger
 * row, a shop price — so the currency is never a bare number the user has to
 * infer the meaning of, and the glyph can be swapped for real coin art in one
 * edit.
 */
export const CoinAmount = memo(
  ({ amount, size = 'md', signed = false, tint, withUnit = false }: Props) => {
    const { colors } = useTheme();
    const color = tint ?? colors.gold;
    const { text, icon } = SIZES[size];
    const prefix = signed && amount > 0 ? '+' : '';

    return (
      <HStack align="center" gap="xxs">
        <Icon as={Coins} size={icon} tint={color} />
        <AppText
          variant={text}
          style={{ color }}
          accessibilityLabel={`${formatCoins(amount)} coins`}
        >
          {prefix}
          {formatCoins(amount)}
          {withUnit ? ' Coins' : ''}
        </AppText>
      </HStack>
    );
  },
);

CoinAmount.displayName = 'CoinAmount';
