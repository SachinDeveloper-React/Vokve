import React, { memo } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { fromIsoDate, formatLongDate, type IsoDate } from '../../utils/date';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Thu, 30 May 2025" — the weekday matters when planning a week. */
function formatPlanDate(date: IsoDate): string {
  return `${WEEKDAYS[fromIsoDate(date).getDay()]}, ${formatLongDate(date)}`;
}

interface Props {
  date: IsoDate;
  onPrevious: () => void;
  onNext: () => void;
  onPressDate: () => void;
}

/**
 * The day the plan is being read for, with a step either side.
 *
 * Arrows rather than the date chip the other screens use: a plan is read a day
 * at a time and in order — "what am I eating tomorrow" — and a calendar for
 * every single step would put a sheet between the user and the next day. The
 * date itself still opens one, for the jump that is more than a step.
 */
export const DayPager = memo(
  ({ date, onPrevious, onNext, onPressDate }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="lg" padding="md">
        <HStack align="center" justify="between" gap="sm">
          <Pressable
            onPress={onPrevious}
            feedback="opacity"
            visualSize={24}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
          >
            <Icon as={ChevronLeft} size="sm" color="textSecondary" />
          </Pressable>

          <Pressable
            onPress={onPressDate}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel={`${formatPlanDate(date)}. Jump to a day`}
          >
            <HStack align="center" gap="sm">
              <Icon as={CalendarDays} size="xs" tint={colors.textSecondary} />
              <AppText variant="bodyStrong" numberOfLines={1}>
                {formatPlanDate(date)}
              </AppText>
            </HStack>
          </Pressable>

          <Pressable
            onPress={onNext}
            feedback="opacity"
            visualSize={24}
            accessibilityRole="button"
            accessibilityLabel="Next day"
          >
            <Icon as={ChevronRight} size="sm" color="textSecondary" />
          </Pressable>
        </HStack>
      </Card>
    );
  },
);

DayPager.displayName = 'DayPager';
