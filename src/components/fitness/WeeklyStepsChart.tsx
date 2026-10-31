import React, { memo, useMemo } from 'react';
import { ChartColumnBig } from 'lucide-react-native';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Icon } from '../media/Icon';
import { HStack, VStack } from '../layout/Stack';
import { StepAxis } from './StepAxis';
import { StepBarColumn } from './StepBarColumn';

export interface DaySteps {
  /** Short weekday label, already localised by the caller. */
  day: string;
  steps: number;
}

interface Props {
  data: DaySteps[];
  goal: number;
}

/**
 * How many labels the scale carries, the baseline zero included — and so how
 * many steps its top is rounded up to.
 */
const SCALE_STEPS = 4;

/**
 * Seven days of step counts.
 *
 * Every bar carries its own value above it and its share of the goal below
 * it, so the scale down the left is there to read the *heights* against, not
 * to supply numbers the chart was missing: four ticks, no line, no gridlines.
 * That is also why the bars are one colour — the percentage under each says
 * who met the goal far more precisely than a shade could.
 *
 * A single series needs no legend: the card's title names it.
 */
export const WeeklyStepsChart = memo(({ data, goal }: Props) => {
  const axisMax = useMemo(() => {
    const peak = Math.max(goal, ...data.map(d => d.steps), 1);
    // Round the top of the scale up to a whole step, so the tallest bar always
    // leaves headroom for the value printed above it.
    const rawStep = peak / (SCALE_STEPS - 1);
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    return Math.ceil(rawStep / magnitude) * magnitude * (SCALE_STEPS - 1);
  }, [data, goal]);

  return (
    <Card elevation="low">
      <VStack gap="base">
        <HStack align="center" justify="between">
          <HStack align="center" gap="sm">
            <Icon as={ChartColumnBig} size="sm" color="text" />
            <AppText variant="label" color="text">
              7 day step record
            </AppText>
          </HStack>
          <AppText variant="micro" color="textTertiary">
            {'Daily goal: '}
            <AppText variant="micro" color="primary">
              {goal.toLocaleString()}
            </AppText>
          </AppText>
        </HStack>

        <HStack align="end">
          <StepAxis max={axisMax} ticks={SCALE_STEPS} />
          {data.map(entry => (
            <StepBarColumn
              key={entry.day}
              day={entry.day}
              steps={entry.steps}
              goal={goal}
              axisMax={axisMax}
            />
          ))}
        </HStack>
      </VStack>
    </Card>
  );
});

WeeklyStepsChart.displayName = 'WeeklyStepsChart';
