import React, { Fragment, memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { CalendarDays, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { DayTotals } from '../../stores/nutritionStore';
import { formatGrouped } from '../../utils/format';
import { formatLongDate, fromIsoDate, type IsoDate } from '../../utils/date';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface RowProps {
  day: DayTotals;
  onPress: (date: IsoDate) => void;
}

const DayRow = memo(({ day, onPress }: RowProps) => {
  const { colors } = useTheme();
  const press = useCallback(() => onPress(day.date), [day.date, onPress]);
  const label = `${WEEKDAYS[fromIsoDate(day.date).getDay()]}, ${formatLongDate(
    day.date,
  )}`;

  return (
    <Pressable
      onPress={press}
      feedback="highlight"
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${formatGrouped(day.calories)} calories`}
    >
      <HStack align="center" gap="md" py="sm">
        <Icon as={CalendarDays} size="xs" color="textTertiary" />

        <AppText variant="micro" numberOfLines={1} style={styles.date}>
          {label}
        </AppText>

        <HStack flex={1} align="center" justify="end" gap="sm">
          <AppText
            variant="bodyStrong"
            numberOfLines={1}
            style={
              day.calories === 0 ? { color: colors.textTertiary } : undefined
            }
          >
            {day.calories === 0
              ? 'Nothing logged'
              : `${formatGrouped(day.calories)} kcal`}
          </AppText>
          <Icon as={ChevronRight} size="xs" color="textTertiary" />
        </HStack>
      </HStack>
    </Pressable>
  );
});

DayRow.displayName = 'DayRow';

interface Props {
  title: string;
  days: DayTotals[];
  /** The link beside the title. Left off, the header is just a title. */
  actionLabel?: string;
  onPressAction?: () => void;
  onPressDay: (date: IsoDate) => void;
}

/**
 * A run of days and what each came to.
 *
 * Days with nothing logged say so rather than reading "0 kcal": zero is a
 * figure, and a day nobody recorded is not the same as a day nobody ate.
 *
 * Every row jumps the screen to that day, so a history is something you can
 * walk into rather than only read.
 */
export const DayTotalsCard = memo(
  ({ title, days, actionLabel, onPressAction, onPressDay }: Props) => {
    const { colors } = useTheme();

    return (
      <VStack gap="sm">
        <HStack align="center" justify="between" gap="sm">
          <AppText variant="h3" numberOfLines={1}>
            {title}
          </AppText>

          {actionLabel && onPressAction ? (
            <Pressable
              onPress={onPressAction}
              feedback="opacity"
              accessibilityRole="link"
              accessibilityLabel={actionLabel}
            >
              <AppText variant="micro" style={{ color: colors.success }}>
                {actionLabel}
              </AppText>
            </Pressable>
          ) : null}
        </HStack>

        <Card radius="xl" padding="base">
          <VStack>
            {days.map((day, index) => (
              <Fragment key={day.date}>
                {index > 0 ? <Divider /> : null}
                <DayRow day={day} onPress={onPressDay} />
              </Fragment>
            ))}
          </VStack>
        </Card>
      </VStack>
    );
  },
);

DayTotalsCard.displayName = 'DayTotalsCard';

/** Text in a row does not shrink on its own, so a long date would overrun. */
const styles = StyleSheet.create({
  date: { flexShrink: 1 },
});
