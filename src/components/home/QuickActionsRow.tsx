import React, { memo } from 'react';
import { Grid } from '../layout/Grid';
import { useTheme } from '../../theme';
import { QuickActionCard } from './QuickActionCard';

interface Props {
  streakDays: number;
  onPressChallenges: () => void;
  onPressNutrition: () => void;
  onPressHealth: () => void;
  onPressStreaks: () => void;
}

/**
 * The shortcut row under the dashboard.
 *
 * Four across rather than a scrolling strip: a shortcut only works if it is
 * seen, and a card parked off the right edge is a card nobody taps. It costs
 * the labels their width — which is why they are set in the smallest upper-case
 * step — but the row stays scannable in one glance and lines up column for
 * column with the metrics row above it.
 */
export const QuickActionsRow = memo(
  ({
    streakDays,
    onPressChallenges,
    onPressNutrition,
    onPressHealth,
    onPressStreaks,
  }: Props) => {
    const { colors } = useTheme();

    return (
      <Grid columns={4} gap="sm">
        <QuickActionCard
          emoji="🏆"
          tint={colors.avatarOrange}
          title="Challenges &"
          detail="achievements"
          onPress={onPressChallenges}
        />
        <QuickActionCard
          emoji="🌱"
          tint={colors.success}
          title="Nutrition &"
          detail="goal"
          onPress={onPressNutrition}
        />
        <QuickActionCard
          emoji="❤️"
          tint={colors.destructive}
          title="Health"
          detail="check up"
          onPress={onPressHealth}
        />
        <QuickActionCard
          emoji="🔥"
          tint={colors.avatarPurple}
          title="Streaks"
          detail={`${streakDays} ${streakDays === 1 ? 'Day' : 'Days'}`}
          uppercaseDetail={false}
          onPress={onPressStreaks}
        />
      </Grid>
    );
  },
);

QuickActionsRow.displayName = 'QuickActionsRow';
