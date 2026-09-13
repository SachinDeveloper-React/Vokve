import React, { memo } from 'react';
import { useTheme } from '../../theme';
import type { DayTotals, NutritionGoals } from '../../stores/nutritionStore';
import { formatGrouped } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

interface FigureProps {
  value: string;
  label: string;
  tint?: string;
}

const Figure = memo(({ value, label, tint }: FigureProps) => (
  <VStack
    flex={1}
    gap="xxs"
    accessible
    accessibilityLabel={`${label}, ${value}`}
  >
    <AppText
      variant="h3"
      numberOfLines={1}
      style={tint ? { color: tint } : undefined}
    >
      {value}
    </AppText>
    <AppText variant="miniMicro" color="textSecondary" numberOfLines={2}>
      {label}
    </AppText>
  </VStack>
));

Figure.displayName = 'Figure';

interface Props {
  title: string;
  days: DayTotals[];
  goals: NutritionGoals;
}

/**
 * A period's diary, averaged rather than added up.
 *
 * The headline is the daily average, not the total: nobody has a weekly
 * calorie target, and 13,000 kcal is a number that means nothing without
 * dividing it by seven first. The total is still stated, one step down, for
 * the reader who wants to do their own arithmetic.
 *
 * Days with nothing logged are left out of the average but counted in the
 * "days logged" figure beside it, so a week with two entries cannot look like
 * a week of eating 400 calories a day.
 */
export const RangeSummaryCard = memo(({ title, days, goals }: Props) => {
  const { colors } = useTheme();

  const logged = days.filter(day => day.items > 0);
  const total = days.reduce((sum, day) => sum + day.calories, 0);
  const average = logged.length === 0 ? 0 : Math.round(total / logged.length);
  const onTarget = logged.filter(day => day.calories <= goals.calories).length;

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <VStack gap="xxs">
          <AppText variant="h3">{title}</AppText>
          <AppText variant="micro" color="textSecondary">
            {logged.length === 0
              ? 'Nothing logged in this period yet.'
              : `Averaged over the ${logged.length} ${
                  logged.length === 1 ? 'day' : 'days'
                } you logged.`}
          </AppText>
        </VStack>

        <HStack align="start" gap="sm">
          <Figure
            value={`${formatGrouped(average)}`}
            label="kcal a day"
            tint={colors.success}
          />
          <Figure value={formatGrouped(total)} label="kcal in total" />
          <Figure
            value={`${logged.length}/${days.length}`}
            label="days logged"
          />
          <Figure
            value={`${onTarget}`}
            label="days within goal"
            tint={colors.primary}
          />
        </HStack>

        <Divider />

        <AppText variant="miniMicro" color="textTertiary">
          {`Daily goal: ${formatGrouped(goals.calories)} kcal`}
        </AppText>
      </VStack>
    </Card>
  );
});

RangeSummaryCard.displayName = 'RangeSummaryCard';
