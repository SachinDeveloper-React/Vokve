import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, Snowflake } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
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
  ({ day, status, inStreak = false, isToday = false, accessibilityLabel }: Props) => {
    const { colors, isDark } = useTheme();

    const numberColor =
      status === 'outside' || status === 'future'
        ? colors.textTertiary
        : colors.text;

    const disc = inStreak
      ? withAlpha(colors.brandAccent, isDark ? 0.32 : 0.18)
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

    return (
      <VStack
        align="center"
        gap="xxs"
        accessible
        accessibilityLabel={inStreak ? `${label}, current streak` : label}
      >
        <View style={[styles.disc, { backgroundColor: disc }]}>
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
  number: { fontWeight: '600' },
  mark: { height: moderateScale(12), justifyContent: 'center' },
});
