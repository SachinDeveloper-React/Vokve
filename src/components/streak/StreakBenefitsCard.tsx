import React, { memo } from 'react';
import { useTheme } from '../../theme';
import type { ThemeColors } from '../../constants/colors';
import { HStack, VStack } from '../layout/Stack';
import { Card } from '../ui/Card';
import { InfoLabel } from '../wallet/InfoLabel';
import { StreakMilestone } from './StreakMilestone';

type MilestoneTint = Extract<
  keyof ThemeColors,
  'success' | 'brandAccent' | 'primary' | 'avatarPurple' | 'destructive'
>;

/**
 * What a streak pays, and when.
 *
 * Declared here rather than fetched: the milestones are the product's rules,
 * not the user's data, and a screen that could not state them until a request
 * came back would be a screen that sometimes had no reason to exist.
 */
export const STREAK_MILESTONES: readonly {
  days: number;
  coins: number;
  tint: MilestoneTint;
}[] = [
  { days: 7, coins: 50, tint: 'success' },
  { days: 15, coins: 150, tint: 'brandAccent' },
  { days: 30, coins: 300, tint: 'primary' },
  { days: 90, coins: 1000, tint: 'avatarPurple' },
  { days: 180, coins: 2000, tint: 'destructive' },
];

interface Props {
  /** The longest run on record — a milestone once reached stays reached. */
  longestStreak: number;
  onPressInfo?: () => void;
}

/**
 * The five milestones, in a row.
 *
 * Achievement is measured against the record, not the current run: a user
 * who hit thirty days in March and broke the streak in April has still earned
 * the thirty-day coins, and a row that took the check away would read as
 * having taken the coins back.
 */
export const StreakBenefitsCard = memo(({ longestStreak, onPressInfo }: Props) => {
  const { colors } = useTheme();

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <InfoLabel label="Streak Benefits" emphasis onPressInfo={onPressInfo} />

        <HStack align="start">
          {STREAK_MILESTONES.map(milestone => (
            <StreakMilestone
              key={milestone.days}
              days={milestone.days}
              coins={milestone.coins}
              tint={colors[milestone.tint]}
              achieved={longestStreak >= milestone.days}
            />
          ))}
        </HStack>
      </VStack>
    </Card>
  );
});

StreakBenefitsCard.displayName = 'StreakBenefitsCard';
