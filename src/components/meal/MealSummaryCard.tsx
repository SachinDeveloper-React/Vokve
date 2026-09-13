import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { formatGrouped } from '../../utils/format';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { MacroStrip, type Macros } from './MacroStrip';

export interface MealTotals extends Macros {
  calories: number;
}

/**
 * What the meal is short of, or that it is fine.
 *
 * Measured as shares of the meal's own calories — protein and fat each supply
 * a known number of calories per gram — rather than against a daily target,
 * because this is one meal and a daily target cannot say anything about it.
 * The verdict is specific when it is not "balanced": "add some protein" is
 * something a user can act on where "unbalanced" is not.
 */
export function verdictFor(totals: MealTotals): {
  message: string;
  tone: 'success' | 'warning';
} {
  if (totals.calories === 0) {
    return { message: 'Add a food to see how the meal stacks up.', tone: 'warning' };
  }

  const proteinShare = (totals.proteinG * 4) / totals.calories;
  const fatShare = (totals.fatsG * 9) / totals.calories;

  if (proteinShare < 0.15) {
    return {
      message: 'Light on protein — an egg or some curd would balance it.',
      tone: 'warning',
    };
  }
  if (fatShare > 0.45) {
    return {
      message: 'Rich in fat. Pair it with something lighter today.',
      tone: 'warning',
    };
  }
  return { message: 'Great choice! Your meal is balanced.', tone: 'success' };
}

interface Props {
  totals: MealTotals;
}

/**
 * The meal added up, and what that adds up to.
 *
 * Directly above Save, because this is the last thing worth reading before
 * committing: the figures are what will land in the day's totals, and the line
 * under them is the only judgement the screen makes.
 */
export const MealSummaryCard = memo(({ totals }: Props) => {
  const { colors } = useTheme();
  const verdict = verdictFor(totals);

  return (
    <Card radius="xl" padding="base">
      <VStack gap="sm">
        <AppText variant="h3">Meal Nutrition Summary</AppText>

        <HStack align="center" gap="base" wrap>
          <AppText variant="metric" numberOfLines={1}>
            {`${formatGrouped(totals.calories)} kcal`}
          </AppText>

          <MacroStrip macros={totals} variant="plain" />
        </HStack>

        <AppText
          variant="micro"
          numberOfLines={2}
          style={{ color: colors[verdict.tone] }}
        >
          {verdict.message}
        </AppText>
      </VStack>
    </Card>
  );
});

MealSummaryCard.displayName = 'MealSummaryCard';
