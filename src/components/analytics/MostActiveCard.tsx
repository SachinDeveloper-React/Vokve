import React, { memo, useCallback } from 'react';
import { CalendarDays, ChevronRight, Clock } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { formatGrouped } from '../../utils/format';
import { formatWeekdayDate, type IsoDate } from '../../utils/date';
import { Card } from '../ui/Card';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { Pressable } from '../form/Pressable';

interface RowProps {
  icon: LucideIcon;
  tint: string;
  label: string;
  value: string;
  detail: string;
  onPress?: () => void;
}

/** One finding: what it is, when it was, and how big. */
const MostActiveRow = memo(
  ({ icon, tint, label, value, detail, onPress }: RowProps) => {
    const body = (
      <HStack align="center" gap="md">
        <IconBadge icon={icon} tint={tint} size="sm" />

        <VStack flex={1} gap="xxs">
          <AppText variant="micro" color="textTertiary">
            {label}
          </AppText>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {value}
          </AppText>
        </VStack>

        <HStack align="center" gap="xxs">
          <AppText variant="micro" color="textSecondary" numberOfLines={1}>
            {detail}
          </AppText>
          {onPress ? (
            <Icon as={ChevronRight} size="xs" color="textTertiary" />
          ) : null}
        </HStack>
      </HStack>
    );

    return onPress ? (
      <Pressable
        onPress={onPress}
        feedback="opacity"
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}, ${detail}`}
        accessibilityHint="Opens this day"
      >
        {body}
      </Pressable>
    ) : (
      <VStack accessible accessibilityLabel={`${label}, ${value}, ${detail}`}>
        {body}
      </VStack>
    );
  },
);

MostActiveRow.displayName = 'MostActiveRow';

/** "6 PM – 7 PM" — the hour a count belongs to, as a span. */
function hourSpan(hour: number): string {
  const name = (value: number) => {
    const wrapped = value % 24;
    const suffix = wrapped < 12 ? 'AM' : 'PM';
    return `${wrapped % 12 === 0 ? 12 : wrapped % 12} ${suffix}`;
  };
  return `${name(hour)} – ${name(hour + 1)}`;
}

interface Props {
  /** The window's busiest day. Null when nothing was counted in it. */
  day: { date: IsoDate; steps: number } | null;
  /** What that day is the busiest of — "the last 7 days". */
  dayWithin: string;
  /** The chosen day's busiest hour. Null when that day counted nothing. */
  hour: { hour: number; steps: number } | null;
  /** The day the hour belongs to, worded — "Mon 27 Oct". */
  hourOn: string;
  onPressDay?: (date: IsoDate) => void;
}

/**
 * When the walking actually happens: the busiest day of the window, and the
 * busiest hour of the day being read.
 *
 * A total says how much and a trend says which way; neither says *when*, and
 * when is the part a person can act on — the hour is what turns "I should
 * walk more" into "my good days have a long evening in them". The two
 * answer at different grains on purpose, and each says which period it
 * speaks for, because a card whose two halves quietly cover different spans
 * is a card that will be misread.
 *
 * The day is a button on to that day. The hour is not: it already belongs to
 * the day on screen, so there is nowhere for it to go.
 */
export const MostActiveCard = memo(
  ({ day, dayWithin, hour, hourOn, onPressDay }: Props) => {
    const { colors } = useTheme();
    const press = useCallback(
      () => (day && onPressDay ? onPressDay(day.date) : undefined),
      [day, onPressDay],
    );

    return (
      <Card elevation="low" radius="xl">
        <VStack gap="base">
          <AppText variant="label" color="textSecondary">
            Most Active
          </AppText>

          <MostActiveRow
            icon={CalendarDays}
            tint={colors.success}
            label={`Busiest day of ${dayWithin}`}
            value={day ? formatWeekdayDate(day.date) : 'Nothing counted yet'}
            detail={day ? `${formatGrouped(day.steps)} steps` : '—'}
            onPress={day && onPressDay ? press : undefined}
          />

          <Divider />

          <MostActiveRow
            icon={Clock}
            tint={colors.brandAccent}
            label={`Busiest hour on ${hourOn}`}
            value={hour ? hourSpan(hour.hour) : 'Nothing counted yet'}
            detail={hour ? `${formatGrouped(hour.steps)} steps` : '—'}
          />
        </VStack>
      </Card>
    );
  },
);

MostActiveCard.displayName = 'MostActiveCard';
