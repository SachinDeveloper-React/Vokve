import React, { memo } from 'react';
import { TrendingDown, TrendingUp, Wallet } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { CoinsSummaryItem } from './CoinsSummaryItem';

interface Props {
  /** Coins credited this calendar month. */
  earned: number;
  /** Coins spent this calendar month, as a positive figure. */
  spent: number;
  /** What the month left behind — earned minus spent. */
  net: number;
}

/**
 * The month in three numbers, closing the wallet out.
 *
 * The lifetime pair at the top of the screen answers "how am I doing overall";
 * this answers "how am I doing now", which is the one a user can still change.
 * The period is stated once in the heading rather than repeated in all three
 * labels: at this width "Earned (This Month)" wraps, and a parenthetical broken
 * across two lines is harder to read than the heading that replaces it.
 * Spent is shown unsigned and red rather than as a negative: the label already
 * says which way it went, and a column of minus signs makes a normal month
 * look like a loss.
 */
export const CoinsSummaryCard = memo(({ earned, spent, net }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <Card
      radius="lg"
      padding="md"
      style={{
        backgroundColor: withAlpha(colors.primary, isDark ? 0.1 : 0.06),
      }}
    >
      <VStack gap="md">
        <AppText variant="label" color="textSecondary">
          Coins Summary · This Month
        </AppText>

        <HStack align="center" gap="sm">
          <CoinsSummaryItem
            icon={TrendingUp}
            tint={colors.primary}
            label="Earned"
            amount={earned}
          />
          <CoinsSummaryItem
            icon={TrendingDown}
            tint={colors.destructive}
            label="Spent"
            amount={spent}
          />
          <CoinsSummaryItem
            icon={Wallet}
            tint={colors.brandAccent}
            label="Balance"
            amount={net}
          />
        </HStack>
      </VStack>
    </Card>
  );
});

CoinsSummaryCard.displayName = 'CoinsSummaryCard';
