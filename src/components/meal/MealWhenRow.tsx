import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { CalendarDays, ChevronDown, Clock } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { formatLongDate, fromIsoDate, type IsoDate } from '../../utils/date';
import { formatTimeOfDay } from '../../utils/format';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  date: IsoDate;
  /** 24-hour `HH:mm`. */
  time: string;
  onPressDate: () => void;
  onPressTime: () => void;
}

/**
 * When the meal was eaten.
 *
 * Asked for rather than assumed, because the commonest time to log breakfast
 * is halfway through the morning: a screen that stamped "now" on everything
 * would file that under the wrong meal as often as not, and the totals it
 * feeds are read by day.
 */
export const MealWhenRow = memo(
  ({ date, time, onPressDate, onPressTime }: Props) => {
    const { colors } = useTheme();
    const dateLabel = `${formatLongDate(date)}, ${
      WEEKDAYS[fromIsoDate(date).getDay()]
    }`;

    return (
      <HStack align="center" gap="sm">
        <Pressable
          onPress={onPressDate}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel={`${dateLabel}. Change the day`}
          style={styles.dateTarget}
        >
          <HStack
            align="center"
            gap="sm"
            px="base"
            py="md"
            bg="card"
            bordered
            style={styles.chip}
          >
            <Icon as={CalendarDays} size="xs" color="textSecondary" />
            <AppText variant="micro" numberOfLines={1} style={styles.label}>
              {dateLabel}
            </AppText>
            <Icon as={ChevronDown} size="xs" color="textTertiary" />
          </HStack>
        </Pressable>

        <Pressable
          onPress={onPressTime}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel={`${formatTimeOfDay(time)}. Change the time`}
        >
          <HStack
            align="center"
            gap="sm"
            px="base"
            py="md"
            bg="card"
            bordered
            style={styles.chip}
          >
            <Icon as={Clock} size="xs" tint={colors.textSecondary} />
            <AppText variant="micro" numberOfLines={1} style={styles.label}>
              {formatTimeOfDay(time)}
            </AppText>
            <Icon as={ChevronDown} size="xs" color="textTertiary" />
          </HStack>
        </Pressable>
      </HStack>
    );
  },
);

MealWhenRow.displayName = 'MealWhenRow';

const styles = StyleSheet.create({
  /** The date takes the row's spare width; the time hugs its own label. */
  dateTarget: { flex: 1 },
  chip: { borderRadius: radius.lg },
  label: { fontWeight: '600', flexShrink: 1 },
});
