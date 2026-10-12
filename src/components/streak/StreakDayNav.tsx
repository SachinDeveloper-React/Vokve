import React, { memo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { formatLongDate, type IsoDate } from '../../utils/date';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  date: IsoDate;
  /** The day before on the record, or null at the first day there is. */
  previousDate: IsoDate | null;
  /** The day after, or null on today. */
  nextDate: IsoDate | null;
  onPressDate: (date: IsoDate) => void;
}

/**
 * ‹ 11 Oct 2026 › — a day at a time, within the days the server has.
 *
 * Which days those are is the server's answer, not a sum done here: the
 * record starts where it starts, and an arrow that paged into an empty day
 * before the account existed would be an arrow to nothing.
 */
export const StreakDayNav = memo(
  ({ date, previousDate, nextDate, onPressDate }: Props) => (
    <HStack align="center" justify="between" gap="sm">
      <Pressable
        onPress={() => previousDate && onPressDate(previousDate)}
        feedback="opacity"
        visualSize={24}
        disabled={previousDate === null}
        accessibilityRole="button"
        accessibilityLabel="Previous day"
        accessibilityState={{ disabled: previousDate === null }}
      >
        <Icon
          as={ChevronLeft}
          size="sm"
          color={previousDate === null ? 'textTertiary' : 'textSecondary'}
        />
      </Pressable>

      <AppText variant="bodyStrong" accessibilityRole="header">
        {formatLongDate(date)}
      </AppText>

      <Pressable
        onPress={() => nextDate && onPressDate(nextDate)}
        feedback="opacity"
        visualSize={24}
        disabled={nextDate === null}
        accessibilityRole="button"
        accessibilityLabel="Next day"
        accessibilityState={{ disabled: nextDate === null }}
      >
        <Icon
          as={ChevronRight}
          size="sm"
          color={nextDate === null ? 'textTertiary' : 'textSecondary'}
        />
      </Pressable>
    </HStack>
  ),
);

StreakDayNav.displayName = 'StreakDayNav';
