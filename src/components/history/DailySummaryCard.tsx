import React, { memo } from 'react';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { formatGrouped } from '../../utils/format';
import type {
  NutritionGoals,
  NutritionTotals,
} from '../../stores/nutritionStore';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { ProgressRing } from '../fitness/ProgressRing';
import { Pressable } from '../form/Pressable';

interface MacroProps {
  label: string;
  value: number;
  goal: number;
  tint: string;
}

const MacroFigure = memo(({ label, value, goal, tint }: MacroProps) => (
  <VStack
    flex={1}
    gap="xxs"
    accessible
    accessibilityLabel={`${label}, ${Math.round(value)} grams of ${Math.round(
      goal,
    )}`}
  >
    <AppText variant="h3" numberOfLines={1} style={{ color: tint }}>
      {`${Math.round(value)}g`}
    </AppText>
    <AppText variant="micro" numberOfLines={1}>
      {label}
    </AppText>
    <AppText variant="miniMicro" color="textTertiary" numberOfLines={1}>
      {`Target ${Math.round(goal)}g`}
    </AppText>
  </VStack>
));

MacroFigure.displayName = 'MacroFigure';

interface Props {
  totals: NutritionTotals;
  goals: NutritionGoals;
  onPressInsights: () => void;
}

/**
 * One day's diary, added up against that day's targets.
 *
 * Each macro states its target beside it rather than only drawing a bar: a
 * history is read to answer "was that a good day", and "120g, target 150g" is
 * an answer where a three-quarters-full bar is a picture of one.
 *
 * The line under the bar says what is left rather than what was eaten, which
 * the ring has already said — and turns into how far over the day went once
 * the goal is passed, because that is the day worth noticing.
 */
export const DailySummaryCard = memo(
  ({ totals, goals, onPressInsights }: Props) => {
    const { colors } = useTheme();
    const share = totals.calories / Math.max(1, goals.calories);
    const remaining = goals.calories - totals.calories;

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack align="center" justify="between" gap="sm">
            <AppText variant="h3" numberOfLines={1}>
              Daily Nutrition Summary
            </AppText>

            <Pressable
              onPress={onPressInsights}
              feedback="opacity"
              accessibilityRole="link"
              accessibilityLabel="View insights"
            >
              <HStack align="center" gap="xxs">
                <AppText variant="micro" style={{ color: colors.success }}>
                  View Insights
                </AppText>
                <Icon as={ChevronRight} size="xs" tint={colors.success} />
              </HStack>
            </Pressable>
          </HStack>

          <HStack align="center" gap="base">
            <ProgressRing
              progress={share}
              size={moderateScale(104)}
              strokeWidth={moderateScale(9)}
              tint={remaining >= 0 ? colors.success : colors.destructive}
            >
              <VStack align="center" gap="none">
                <AppText variant="h2" numberOfLines={1}>
                  {formatGrouped(totals.calories)}
                </AppText>
                <AppText variant="miniMicro" color="textSecondary">
                  {`of ${formatGrouped(goals.calories)}`}
                </AppText>
                <AppText variant="miniMicro" color="textTertiary">
                  kcal
                </AppText>
              </VStack>
            </ProgressRing>

            <HStack flex={1} align="start" gap="sm">
              <MacroFigure
                label="Protein"
                value={totals.proteinG}
                goal={goals.proteinG}
                tint={colors.success}
              />
              <MacroFigure
                label="Carbs"
                value={totals.carbsG}
                goal={goals.carbsG}
                tint={colors.primary}
              />
              <MacroFigure
                label="Fats"
                value={totals.fatsG}
                goal={goals.fatsG}
                tint={colors.brandAccent}
              />
            </HStack>
          </HStack>

          <VStack gap="xs">
            <ProgressBar progress={share} tint={colors.success} height={8} />

            <HStack align="center" justify="between" gap="sm">
              <AppText variant="miniMicro" color="textSecondary">
                {`${Math.round(share * 100)}% of daily goal`}
              </AppText>
              <AppText variant="miniMicro" color="textSecondary">
                {remaining >= 0
                  ? `${formatGrouped(remaining)} kcal remaining`
                  : `${formatGrouped(-remaining)} kcal over`}
              </AppText>
            </HStack>
          </VStack>
        </VStack>
      </Card>
    );
  },
);

DailySummaryCard.displayName = 'DailySummaryCard';
