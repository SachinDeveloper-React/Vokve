import React, { memo } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { Bell, CalendarDays, Clock, Droplets } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { formatTimeOfDay } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

interface FigureProps {
  icon: LucideIcon;
  tint: string;
  value: string;
  label: string;
}

const PlanFigure = memo(({ icon, tint, value, label }: FigureProps) => (
  <HStack
    flex={1}
    align="center"
    gap="xs"
    accessible
    accessibilityLabel={`${label}, ${value}`}
  >
    <Icon as={icon} size="sm" tint={tint} />

    <VStack flex={1} gap="none">
      <AppText variant="bodyStrong" numberOfLines={1}>
        {value}
      </AppText>
      <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
        {label}
      </AppText>
    </VStack>
  </HStack>
));

PlanFigure.displayName = 'PlanFigure';

interface Props {
  activeCount: number;
  /** "Daily" when every day is selected, otherwise the days themselves. */
  repeatLabel: string;
  dailyGoalMl: number;
  /** `HH:mm`, or null when nothing is due. */
  nextTime: string | null;
}

/**
 * The plan in one line: how many, how often, how much, and what is next.
 *
 * A summary of controls that are all further down the screen rather than a set
 * of controls itself. Everything here can be changed below; stating it at the
 * top is what lets a user check their plan without scrolling through the four
 * sections that set it.
 */
export const ReminderPlanCard = memo(
  ({ activeCount, repeatLabel, dailyGoalMl, nextTime }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="xl" padding="base">
        <HStack align="center" gap="sm">
          <PlanFigure
            icon={Bell}
            tint={colors.primary}
            value={String(activeCount)}
            label="Reminders ON"
          />

          <Divider orientation="vertical" />

          <PlanFigure
            icon={CalendarDays}
            tint={colors.avatarPurple}
            value={repeatLabel}
            label="Repeat"
          />

          <Divider orientation="vertical" />

          <PlanFigure
            icon={Droplets}
            tint={colors.avatarCyan}
            value={`${(dailyGoalMl / 1000).toFixed(1)} L`}
            label="Daily Goal"
          />

          <Divider orientation="vertical" />

          <PlanFigure
            icon={Clock}
            tint={colors.brandAccent}
            value={nextTime === null ? '—' : formatTimeOfDay(nextTime)}
            label="Next Reminder"
          />
        </HStack>
      </Card>
    );
  },
);

ReminderPlanCard.displayName = 'ReminderPlanCard';
