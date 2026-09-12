import React, { memo } from 'react';
import { moderateScale } from '../../theme/responsive';
import { AppText } from '../ui/AppText';
import { Box } from '../layout/Box';
import { VStack } from '../layout/Stack';

interface Props {
  /** Short weekday label, already localised by the caller. */
  day: string;
  steps: number;
  goal: number;
  /** Top of the chart's scale — the value a full-height bar would represent. */
  axisMax: number;
}

/** Tallest a bar can be drawn. */
const BAR_MAX = moderateScale(112);
/** Room kept above the bar for its value, so a tall bar cannot clip it. */
const VALUE_ROW = moderateScale(20);
const BAR_WIDTH = moderateScale(13);

export const PLOT_HEIGHT = BAR_MAX + VALUE_ROW;

/**
 * One day of the week chart: the count, the bar, and the two labels under it.
 *
 * The whole column is one component because the four parts have to line up
 * across seven of them — a chart that maps the bars and the labels separately
 * has two lists that can silently fall out of order.
 *
 * The value sits directly above its own bar rather than in a fixed row, which
 * is what lets the eye read a number and a height as one thing. That only
 * works because the bar is scaled against `axisMax`, a rounded step above the
 * week's peak, so there is always headroom left for the label.
 */
export const StepBarColumn = memo(({ day, steps, goal, axisMax }: Props) => {
  const fraction = Math.min(1, steps / Math.max(1, axisMax));
  const percent = Math.round((steps / Math.max(1, goal)) * 100);

  return (
    <VStack
      flex={1}
      align="center"
      gap="sm"
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${day}, ${steps.toLocaleString()} steps, ${percent} percent of goal`}
    >
      <VStack
        justify="end"
        align="center"
        gap="xxs"
        style={{ height: PLOT_HEIGHT }}
      >
        <AppText variant="micro" numberOfLines={1}>
          {steps.toLocaleString()}
        </AppText>
        {/* Pill rather than a flat base: without an axis line under it, a
            square-bottomed bar reads as cut off rather than as ending. */}
        <Box
          bg="primary"
          radius="pill"
          style={{ width: BAR_WIDTH, height: Math.max(2, fraction * BAR_MAX) }}
        />
      </VStack>

      <VStack align="center" gap="xxs">
        <AppText variant="micro" color="primary" numberOfLines={1}>
          {`${percent}%`}
        </AppText>
        <AppText variant="micro" numberOfLines={1}>
          {day}
        </AppText>
      </VStack>
    </VStack>
  );
});

StepBarColumn.displayName = 'StepBarColumn';
