import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { formatGrouped } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { ProgressRing } from '../fitness/ProgressRing';

interface MacroProps {
  value: number;
  label: string;
  tint: string;
}

const MacroFigure = memo(({ value, label, tint }: MacroProps) => (
  <VStack
    flex={1}
    align="center"
    gap="xxs"
    accessible
    accessibilityLabel={`${label}, ${Math.round(value)} grams`}
  >
    <AppText variant="h3" numberOfLines={1} style={{ color: tint }}>
      {`${Math.round(value)}g`}
    </AppText>
    <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
      {label}
    </AppText>
  </VStack>
));

MacroFigure.displayName = 'MacroFigure';

interface Props {
  calories: number;
  goal: number;
  proteinG: number;
  carbsG: number;
  fatsG: number;
}

/**
 * What the day's plan adds up to, against the calorie goal.
 *
 * "750 kcal remaining" rather than a percentage: this is a plan, and the
 * question it answers is how much room is left to plan *into*. Once the plan
 * passes the goal the line says so instead, because a plan that quietly reads
 * "0 remaining" at 2,400 kcal would be hiding the only thing worth noticing.
 */
export const PlanCaloriesCard = memo(
  ({ calories, goal, proteinG, carbsG, fatsG }: Props) => {
    const { colors } = useTheme();
    const remaining = goal - calories;
    const isWithin = remaining >= 0;

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack align="center" gap="base">
            <ProgressRing
              progress={calories / Math.max(1, goal)}
              size={moderateScale(104)}
              strokeWidth={moderateScale(8)}
              tint={isWithin ? colors.success : colors.destructive}
            >
              <VStack align="center" gap="none">
                <AppText variant="h2" numberOfLines={1}>
                  {formatGrouped(calories)}
                </AppText>
                <AppText variant="miniMicro" color="textSecondary">
                  {`of ${formatGrouped(goal)}`}
                </AppText>
                <AppText variant="miniMicro" color="textTertiary">
                  kcal
                </AppText>
              </VStack>
            </ProgressRing>

            <VStack flex={1} gap="xxs">
              <AppText variant="h3">Calories</AppText>
              <AppText variant="micro" color="textSecondary" numberOfLines={2}>
                {isWithin
                  ? `${formatGrouped(remaining)} kcal remaining`
                  : `${formatGrouped(-remaining)} kcal over the goal`}
              </AppText>
            </VStack>
          </HStack>

          <Divider />

          <HStack align="start" gap="sm">
            <MacroFigure
              value={proteinG}
              label="Protein"
              tint={colors.success}
            />
            <MacroFigure value={carbsG} label="Carbs" tint={colors.primary} />
            <MacroFigure value={fatsG} label="Fats" tint={colors.destructive} />
          </HStack>
        </VStack>
      </Card>
    );
  },
);

PlanCaloriesCard.displayName = 'PlanCaloriesCard';
