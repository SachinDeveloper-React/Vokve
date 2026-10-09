import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';

const DOT = moderateScale(8);

const LegendItem = memo(
  ({
    tint,
    label,
    outline = false,
  }: {
    tint: string;
    label: string;
    /** Draws the dot as a ring, which is how today is marked on the grid. */
    outline?: boolean;
  }) => (
    <HStack align="center" gap="xs">
      <View
        style={[
          styles.dot,
          outline
            ? [styles.ring, { borderColor: tint }]
            : { backgroundColor: tint },
        ]}
      />
      <AppText variant="micro" color="textSecondary">
        {label}
      </AppText>
    </HStack>
  ),
);

LegendItem.displayName = 'LegendItem';

/**
 * What the calendar's discs mean.
 *
 * Four entries, one per thing a cell can be drawn as: the run's orange, a
 * missed day's red, an untouched day's grey, and today's ring. "Protected"
 * is left out on purpose — the snowflake on the cell is its own legend, and
 * a fifth entry would wrap the row on a narrow phone.
 */
export const CalendarLegend = memo(() => {
  const { colors } = useTheme();

  return (
    <HStack align="center" gap="base" wrap>
      <LegendItem tint={colors.brandAccent} label="Completed" />
      <LegendItem tint={colors.destructive} label="Missed" />
      <LegendItem tint={colors.textTertiary} label="Upcoming" />
      <LegendItem tint={colors.text} label="Today" outline />
    </HStack>
  );
});

CalendarLegend.displayName = 'CalendarLegend';

const styles = StyleSheet.create({
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  ring: { borderWidth: 1 },
});
