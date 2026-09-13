import React, { Fragment, memo, useCallback } from 'react';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { dietPlanForDate, totalsOf } from '../../stores/dietPlanStore';
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
  date: IsoDate;
  selected: boolean;
  onPress: (date: IsoDate) => void;
}

const DayRow = memo(({ date, selected, onPress }: RowProps) => {
  const { colors } = useTheme();
  const meals = dietPlanForDate(date);
  const { calories } = totalsOf(meals);
  const press = useCallback(() => onPress(date), [date, onPress]);

  return (
    <Pressable
      onPress={press}
      feedback="highlight"
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${formatLongDate(date)}, ${
        meals.length
      } meals, ${formatGrouped(calories)} calories`}
    >
      <HStack align="center" gap="md" py="sm">
        <VStack gap="none">
          <AppText
            variant="bodyStrong"
            style={selected ? { color: colors.primary } : undefined}
          >
            {WEEKDAYS[fromIsoDate(date).getDay()]}
          </AppText>
          <AppText variant="miniMicro" color="textSecondary">
            {formatLongDate(date).split(' ').slice(0, 2).join(' ')}
          </AppText>
        </VStack>

        <AppText variant="micro" color="textSecondary" numberOfLines={1}>
          {`${meals.length} meals`}
        </AppText>

        <HStack flex={1} align="center" justify="end" gap="sm">
          <AppText variant="bodyStrong" numberOfLines={1}>
            {`${formatGrouped(calories)} kcal`}
          </AppText>
          <Icon as={ChevronRight} size="xs" color="textTertiary" />
        </HStack>
      </HStack>
    </Pressable>
  );
});

DayRow.displayName = 'DayRow';

interface Props {
  /** The days to list, in order. */
  dates: IsoDate[];
  selected: IsoDate;
  title: string;
  caption: string;
  onPressDay: (date: IsoDate) => void;
}

/**
 * A run of days and what each one's plan comes to.
 *
 * The same component behind both the "Plan" and "History" tabs: forwards and
 * backwards are the same list read in opposite directions, and building them
 * separately would let the two drift apart the moment either was touched.
 *
 * Every row is a press target that moves the day pager, so a user who spots a
 * heavy Thursday is one tap from the meals that made it heavy.
 */
export const PlanDayList = memo(
  ({ dates, selected, title, caption, onPressDay }: Props) => (
    <VStack gap="sm">
      <VStack gap="xxs">
        <AppText variant="h3">{title}</AppText>
        <AppText variant="micro" color="textSecondary">
          {caption}
        </AppText>
      </VStack>

      <Card radius="xl" padding="base">
        <VStack>
          {dates.map((date, index) => (
            <Fragment key={date}>
              {index > 0 ? <Divider /> : null}
              <DayRow
                date={date}
                selected={date === selected}
                onPress={onPressDay}
              />
            </Fragment>
          ))}
        </VStack>
      </Card>
    </VStack>
  ),
);

PlanDayList.displayName = 'PlanDayList';
