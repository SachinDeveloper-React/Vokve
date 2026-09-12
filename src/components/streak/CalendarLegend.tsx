import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';

const DOT = moderateScale(8);

const LegendItem = memo(({ tint, label }: { tint: string; label: string }) => (
  <HStack align="center" gap="xs">
    <View style={[styles.dot, { backgroundColor: tint }]} />
    <AppText variant="micro" color="textSecondary">
      {label}
    </AppText>
  </HStack>
));

LegendItem.displayName = 'LegendItem';

/**
 * What the calendar's colours mean.
 *
 * Three entries, matching the three things a cell can be drawn with: the
 * green mark, the orange disc, and neither. A fourth for "protected" is left
 * out on purpose — the snowflake is its own legend.
 */
export const CalendarLegend = memo(() => {
  const { colors } = useTheme();

  return (
    <HStack align="center" gap="base" wrap>
      <LegendItem tint={colors.success} label="Completed" />
      <LegendItem tint={colors.brandAccent} label="Current Streak" />
      <LegendItem tint={colors.textTertiary} label="Incomplete" />
    </HStack>
  );
});

CalendarLegend.displayName = 'CalendarLegend';

const styles = StyleSheet.create({
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
