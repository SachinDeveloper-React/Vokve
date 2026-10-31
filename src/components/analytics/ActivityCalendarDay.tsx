import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { Pressable } from '../form/Pressable';
import { AppText } from '../ui/AppText';

/**
 * How a day's count stood against the goal.
 *
 * `outside` is a neighbouring month's day, drawn for alignment; `future` has
 * not happened; `none` has, with nothing counted.
 */
export type ActivityLevel = 'met' | 'mid' | 'low' | 'none' | 'future' | 'outside';

/** The disc's diameter at the 375pt baseline; seven share a row. */
const DISC = moderateScale(32);

interface Props {
  day: number;
  level: ActivityLevel;
  isToday?: boolean;
  selected?: boolean;
  /** For the screen reader — "27 October 2026, 8,420 steps, goal met". */
  accessibilityLabel: string;
  /** Left off for a cell there is nothing to open. */
  onPress?: () => void;
}

/**
 * One cell of the activity calendar: the day number on a disc whose weight is
 * how far that day got.
 *
 * Four steps rather than a continuous ramp, because the question a calendar
 * answers is "which days were good?" and a smooth gradient makes every day
 * look like every other. The top step is the goal being met and is the only
 * solid one, so a month's worth of met goals reads off the grid at arm's
 * length — the rest are washes of the same accent at a weight the eye can
 * rank but need not measure.
 *
 * A day that has been and gone with nothing on it still gets a disc, in the
 * surface's own muted tone: an empty slot reads as a day, a missing one reads
 * as a hole in the month.
 */
export const ActivityCalendarDay = memo(
  ({ day, level, isToday = false, selected = false, accessibilityLabel, onPress }: Props) => {
    const { colors, isDark } = useTheme();

    const wash = (light: number, dark: number) =>
      withAlpha(colors.brandAccent, isDark ? dark : light);

    const disc =
      level === 'met'
        ? colors.brandAccent
        : level === 'mid'
        ? wash(0.42, 0.5)
        : level === 'low'
        ? wash(0.16, 0.24)
        : level === 'none'
        ? colors.muted
        : 'transparent';

    const number =
      level === 'met'
        ? colors.primaryForeground
        : level === 'future' || level === 'outside'
        ? colors.textTertiary
        : colors.text;

    // The ring is the only mark that says *which* day is being read, so the
    // chosen day outranks today when they are not the same day.
    const ring = selected ? colors.text : isToday ? colors.textSecondary : null;

    const cell = (
      <View
        style={[
          styles.disc,
          { backgroundColor: disc },
          ring !== null && [styles.ring, { borderColor: ring }],
          selected && styles.ringStrong,
        ]}
      >
        <AppText variant="micro" style={[styles.number, { color: number }]}>
          {day}
        </AppText>
      </View>
    );

    return onPress ? (
      <Pressable
        onPress={onPress}
        feedback="opacity"
        visualSize={DISC}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Opens this day"
      >
        {cell}
      </Pressable>
    ) : (
      <View accessible accessibilityLabel={accessibilityLabel}>
        {cell}
      </View>
    );
  },
);

ActivityCalendarDay.displayName = 'ActivityCalendarDay';

const styles = StyleSheet.create({
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { borderWidth: 1 },
  ringStrong: { borderWidth: 2 },
  number: { fontWeight: '600' },
});
