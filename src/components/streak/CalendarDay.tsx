import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, Snowflake } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { Pressable } from '../form/Pressable';
import { VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

/**
 * How a day went.
 *
 * `outside` is a day shown for alignment from the month before or after;
 * `future` has not happened; `incomplete` has, with nothing recorded.
 */
export type DayStatus =
  | 'completed'
  | 'protected'
  | 'incomplete'
  | 'future'
  | 'outside';

interface Props {
  day: number;
  status: DayStatus;
  /** Part of the run that is still going. Drawn on a tinted disc. */
  inStreak?: boolean;
  isToday?: boolean;
  /** For the screen reader — "26 May 2025". */
  accessibilityLabel: string;
  /**
   * Opens the day. Left off for a cell there is nothing to open — a day from
   * a neighbouring month, or one that has not happened yet.
   */
  onPress?: () => void;
}

/** The disc's diameter at the 375pt baseline; seven of them share a row. */
const DISC = moderateScale(34);

/**
 * One cell of the streak calendar.
 *
 * The mark under the number is what says how the day went; the disc behind
 * it says whether the day belongs to the current run. They are separate on
 * purpose: a completed day from a run that has since broken is still a
 * completed day, and drawing it the same as a day in the live run would hide
 * exactly the break the user came here to see.
 */
export const CalendarDay = memo(
  ({
    day,
    status,
    inStreak = false,
    isToday = false,
    accessibilityLabel,
    onPress,
  }: Props) => {
    const { colors, isDark } = useTheme();

    const numberColor =
      status === 'outside' || status === 'future'
        ? colors.textTertiary
        : colors.text;

    // A day that has been and gone with nothing on it is washed in the
    // destructive tint rather than left blank: an empty disc reads as "not
    // yet", and the break is the thing the calendar is opened to find.
    const disc = inStreak
      ? withAlpha(colors.brandAccent, isDark ? 0.32 : 0.18)
      : status === 'incomplete'
      ? withAlpha(colors.destructive, isDark ? 0.24 : 0.12)
      : isToday
      ? colors.muted
      : 'transparent';

    const label =
      status === 'completed'
        ? `${accessibilityLabel}, completed`
        : status === 'protected'
        ? `${accessibilityLabel}, protected by a freeze`
        : status === 'incomplete'
        ? `${accessibilityLabel}, missed`
        : accessibilityLabel;

    const cell = (
      <VStack align="center" gap="xxs">
        <View
          style={[
            styles.disc,
            { backgroundColor: disc },
            isToday && [styles.todayRing, { borderColor: colors.text }],
          ]}
        >
          <AppText
            variant="micro"
            style={[styles.number, { color: numberColor }]}
          >
            {day}
          </AppText>
        </View>

        <View style={styles.mark}>
          {status === 'completed' ? (
            <Icon as={Check} size={moderateScale(10)} color="success" strokeWidth={3} />
          ) : status === 'protected' ? (
            <Icon as={Snowflake} size={moderateScale(10)} color="primary" />
          ) : null}
        </View>
      </VStack>
    );

    const spoken = inStreak ? `${label}, current streak` : label;

    // A tappable cell is announced as the button it is; one with nowhere to
    // go stays a label, because a cell that does nothing when tapped reads as
    // broken to anyone who tries it.
    return onPress ? (
      <Pressable
        onPress={onPress}
        feedback="opacity"
        visualSize={DISC}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint="Opens this day"
      >
        {cell}
      </Pressable>
    ) : (
      <VStack accessible accessibilityLabel={spoken}>
        {cell}
      </VStack>
    );
  },
);

CalendarDay.displayName = 'CalendarDay';

/**
 * The disc is a fixed diameter and the mark slot a fixed height, so every
 * row of the calendar is the same height whether or not its days carry marks.
 */
const styles = StyleSheet.create({
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayRing: { borderWidth: 1 },
  number: { fontWeight: '600' },
  mark: { height: moderateScale(12), justifyContent: 'center' },
});
