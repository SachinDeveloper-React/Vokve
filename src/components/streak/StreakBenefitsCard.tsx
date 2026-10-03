import React, { memo } from 'react';
import { useTheme } from '../../theme';
import type { ThemeColors } from '../../constants/colors';
import type { StreakMilestone as Milestone } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Card } from '../ui/Card';
import { InfoLabel } from '../wallet/InfoLabel';
import { StreakMilestone } from './StreakMilestone';

type MilestoneTint = Extract<
  keyof ThemeColors,
  'success' | 'brandAccent' | 'primary' | 'avatarPurple' | 'destructive'
>;

/**
 * The ring colours, rung by rung. Presentation only: how many rungs there
 * are, their days and their coins are the server's (⚙
 * `coins.streakMilestones`), and a ladder longer than this palette starts
 * the colours over.
 */
const TINTS: readonly MilestoneTint[] = [
  'success',
  'brandAccent',
  'primary',
  'avatarPurple',
  'destructive',
];

interface Props {
  /** The ladder as the server serves it, achieved against the longest streak. */
  milestones: readonly Milestone[];
  onPressInfo?: () => void;
}

/**
 * The milestones, in a row.
 *
 * Achievement is the server's, measured against the record rather than the
 * current run (RULES S8): a user who hit thirty days in March and broke the
 * streak in April has still earned the thirty-day coins, and a row that took
 * the check away would read as having taken the coins back.
 */
export const StreakBenefitsCard = memo(({ milestones, onPressInfo }: Props) => {
  const { colors } = useTheme();

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <InfoLabel label="Streak Benefits" emphasis onPressInfo={onPressInfo} />

        <HStack align="start">
          {milestones.map((milestone, index) => (
            <StreakMilestone
              key={milestone.days}
              days={milestone.days}
              coins={milestone.coins}
              tint={colors[TINTS[index % TINTS.length]]}
              achieved={milestone.achieved}
            />
          ))}
        </HStack>
      </VStack>
    </Card>
  );
});

StreakBenefitsCard.displayName = 'StreakBenefitsCard';
