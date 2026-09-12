import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { CoinAmount } from './CoinAmount';

interface Props {
  label: string;
  amount: number;
}

/**
 * One half of the lifetime pair under the balance — earned, or spent.
 *
 * Takes an equal share of the row it sits in, so the two halves line up on a
 * grid rather than being pushed around by how long each figure happens to be.
 *
 * The figure is tinted to the text colour rather than left gold. Gold is what
 * marks the balance the user can actually spend; two more gold numbers
 * directly beneath it would put three equal claims on the eye and bury the one
 * that matters.
 */
export const LifetimeCoinStat = memo(({ label, amount }: Props) => {
  const { colors } = useTheme();

  return (
    <VStack flex={1} gap="xxs">
      <AppText variant="micro" color="textSecondary">
        {label}
      </AppText>
      <CoinAmount amount={amount} size="md" tint={colors.text} />
    </VStack>
  );
});

LifetimeCoinStat.displayName = 'LifetimeCoinStat';
