import React, { memo } from 'react';
import { useTheme } from '../../theme';
import type { PlannedMeal } from '../../types/models';
import type { NutritionGoals } from '../../stores/nutritionStore';
import type { PlanTotals } from '../../stores/dietPlanStore';
import { formatGrouped } from '../../utils/format';
import { MEAL_STYLE } from '../nutrition/nutritionLabels';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';

interface BarProps {
  label: string;
  value: number;
  goal: number;
  tint: string;
}

const MacroRow = memo(({ label, value, goal, tint }: BarProps) => (
  <VStack
    gap="xxs"
    accessible
    accessibilityLabel={`${label}, ${Math.round(value)} of ${Math.round(
      goal,
    )} grams planned`}
  >
    <HStack align="center" justify="between" gap="sm">
      <AppText variant="micro" numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
        {`${Math.round(value)}g / ${Math.round(goal)}g`}
      </AppText>
    </HStack>
    <ProgressBar progress={value / Math.max(1, goal)} tint={tint} height={6} />
  </VStack>
));

MacroRow.displayName = 'MacroRow';

interface Props {
  meals: PlannedMeal[];
  totals: PlanTotals;
  goals: NutritionGoals;
}

/**
 * What the day's plan is made of, rather than what it comes to.
 *
 * The macros here are the *planned* ones, measured against the same goals the
 * nutrition screen logs against — so a user can see that the plan itself is
 * short on protein before finding that out again at the end of the day.
 *
 * The split underneath says where the calories sit across the day, which is
 * the other question a plan gets asked: not "how much" but "when".
 */
export const PlanNutritionCard = memo(({ meals, totals, goals }: Props) => {
  const { colors } = useTheme();

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <VStack gap="xxs">
          <AppText variant="h3">Planned nutrition</AppText>
          <AppText variant="micro" color="textSecondary">
            What this day's plan adds up to, against your goals.
          </AppText>
        </VStack>

        <MacroRow
          label="Protein"
          value={totals.proteinG}
          goal={goals.proteinG}
          tint={colors.success}
        />
        <MacroRow
          label="Carbs"
          value={totals.carbsG}
          goal={goals.carbsG}
          tint={colors.primary}
        />
        <MacroRow
          label="Fats"
          value={totals.fatsG}
          goal={goals.fatsG}
          tint={colors.destructive}
        />

        <Divider />

        <VStack gap="sm">
          {meals.map(meal => (
            <HStack key={meal.id} align="center" justify="between" gap="sm">
              <AppText variant="micro" color="textSecondary" numberOfLines={1}>
                {MEAL_STYLE[meal.slot].label}
              </AppText>
              <AppText variant="micro" numberOfLines={1}>
                {`${formatGrouped(meal.calories)} kcal`}
              </AppText>
            </HStack>
          ))}
        </VStack>
      </VStack>
    </Card>
  );
});

PlanNutritionCard.displayName = 'PlanNutritionCard';
