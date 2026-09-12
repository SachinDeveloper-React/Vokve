import React, { memo } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { CoinAmount } from './CoinAmount';

interface Props {
  icon: LucideIcon;
  /** Colours both the glyph and the figure. Pass a theme colour. */
  tint: string;
  label: string;
  /** Always passed unsigned — the label says which direction it went. */
  amount: number;
}

/**
 * One figure in the month's summary strip.
 *
 * A bare glyph rather than a badge: three discs in a 66pt-tall strip would be
 * the largest things in it, and the strip is meant to be read as three numbers
 * with the icons only telling them apart. Labels are single words for the same
 * reason — three of them share one row, and any that wrapped would push its
 * figure a line below the other two.
 */
export const CoinsSummaryItem = memo(({ icon, tint, label, amount }: Props) => (
  <HStack flex={1} align="center" gap="sm">
    <Icon as={icon} size="sm" tint={tint} />

    <VStack flex={1} gap="xxs">
      <AppText variant="micro" color="textSecondary" numberOfLines={1}>
        {label}
      </AppText>
      <CoinAmount amount={amount} size="sm" tint={tint} />
    </VStack>
  </HStack>
));

CoinsSummaryItem.displayName = 'CoinsSummaryItem';
