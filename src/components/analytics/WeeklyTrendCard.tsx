import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { formatGrouped } from '../../utils/format';
import type { DaySteps } from '../fitness/WeeklyStepsChart';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

const BAR_MAX = moderateScale(72);

interface BarProps {
  entry: DaySteps;
  fraction: number;
  /** The week's highest day, drawn in the success colour. */
  isBest: boolean;
}

const TrendBar = memo(({ entry, fraction, isBest }: BarProps) => {
  const { colors, isDark } = useTheme();

  return (
    <VStack
      flex={1}
      align="center"
      gap="xs"
      accessible
      accessibilityLabel={`${entry.day}, ${formatGrouped(entry.steps)} steps${
        isBest ? ', the week’s best' : ''
      }`}
    >
      <View style={styles.plot}>
        <View
          style={[
            styles.bar,
            {
              height: Math.max(4, fraction * BAR_MAX),
              backgroundColor: isBest
                ? colors.success
                : withAlpha(colors.brandAccent, isDark ? 0.6 : 0.45),
            },
          ]}
        />
      </View>

      <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
        {entry.day}
      </AppText>
    </VStack>
  );
});

TrendBar.displayName = 'TrendBar';

interface Props {
  data: DaySteps[];
}

/**
 * The week at a glance, with its best day picked out.
 *
 * The highlight is the whole point of the card — the chart above already draws
 * the same seven days when the range is set to a week. What this adds is the
 * comparison: which day the user actually walked the most, in a colour that
 * survives being glanced at from across a room.
 */
export const WeeklyTrendCard = memo(({ data }: Props) => {
  const peak = Math.max(1, ...data.map(entry => entry.steps));

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <AppText variant="label" color="textSecondary">
          Weekly Trend
        </AppText>

        <HStack align="end" gap="xs">
          {data.map(entry => (
            <TrendBar
              key={entry.day}
              entry={entry}
              fraction={entry.steps / peak}
              isBest={entry.steps === peak}
            />
          ))}
        </HStack>
      </VStack>
    </Card>
  );
});

WeeklyTrendCard.displayName = 'WeeklyTrendCard';

const styles = StyleSheet.create({
  plot: { height: BAR_MAX, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: radius.md },
});
