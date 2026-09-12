import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Snowflake } from 'lucide-react-native';
import { fontWeight } from '../../theme';
import type { IsoDate } from '../../utils/date';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { InfoLabel } from '../wallet/InfoLabel';
import { CalendarGrid } from './CalendarGrid';
import { CalendarLegend } from './CalendarLegend';
import { MonthNav } from './MonthNav';

interface Props {
  year: number;
  /** 0-based, as `Date` counts them. */
  month: number;
  today: IsoDate;
  completedDays: Set<IsoDate>;
  protectedDays: Set<IsoDate>;
  streakDays: Set<IsoDate>;
  freezesAvailable: number;
  /** Whether today is already covered by a freeze. */
  isTodayFrozen: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  canGoNext: boolean;
  onPressInfo?: () => void;
  onPressHowItWorks: () => void;
}

/** The freeze line at the foot, by state. */
function freezeStatus(isTodayFrozen: boolean, available: number): string {
  if (isTodayFrozen) return 'Streak Freeze active today';
  if (available === 0) return 'No Streak Freeze left';
  return `${available} Streak ${available === 1 ? 'Freeze' : 'Freezes'} ready`;
}

/**
 * The month view of the streak, with its legend and freeze status.
 *
 * Paging is the card's, not the screen's: the summary above it is always
 * about now, and a user looking back at March should not see the current
 * streak figure change while they do it.
 */
export const StreakCalendarCard = memo(
  ({
    year,
    month,
    today,
    completedDays,
    protectedDays,
    streakDays,
    freezesAvailable,
    isTodayFrozen,
    onPreviousMonth,
    onNextMonth,
    canGoNext,
    onPressInfo,
    onPressHowItWorks,
  }: Props) => (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <HStack align="center" justify="between" gap="xs" wrap>
          <InfoLabel
            label="Your Streak Calendar"
            emphasis
            onPressInfo={onPressInfo}
          />
          <MonthNav
            year={year}
            month={month}
            onPrevious={onPreviousMonth}
            onNext={onNextMonth}
            canGoNext={canGoNext}
          />
        </HStack>

        <CalendarGrid
          year={year}
          month={month}
          today={today}
          completedDays={completedDays}
          protectedDays={protectedDays}
          streakDays={streakDays}
        />

        <CalendarLegend />

        <Divider />

        <HStack align="center" justify="between" gap="sm">
          <HStack align="center" gap="xs">
            <Icon as={Snowflake} size="xs" color="primary" />
            <AppText variant="micro">
              {freezeStatus(isTodayFrozen, freezesAvailable)}
            </AppText>
          </HStack>

          <Pressable
            onPress={onPressHowItWorks}
            feedback="opacity"
            accessibilityRole="link"
            accessibilityLabel="How streaks work"
          >
            <AppText variant="micro" style={styles.link}>
              How it Works?
            </AppText>
          </Pressable>
        </HStack>
      </VStack>
    </Card>
  ),
);

StreakCalendarCard.displayName = 'StreakCalendarCard';

/** A link in `micro` needs the weight to be told from the status beside it. */
const styles = StyleSheet.create({
  link: { fontWeight: fontWeight.semibold },
});
