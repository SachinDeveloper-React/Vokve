import React, { memo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Flame, HeartPulse, Leaf, Trophy } from 'lucide-react-native';
import { spacing, useTheme } from '../../theme';
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
 * It scrolls horizontally rather than squeezing four cards across the width:
 * at a quarter of a 375pt screen each card is under 80pt, which is too narrow
 * for two-line titles like "Challenges & achievements". Scrolling keeps the
 * cards legible and leaves room to add a fifth shortcut later.
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
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        // The row is inset from the screen's padding so the first and last
        // cards can sit flush with the other sections' edges.
        style={styles.bleed}
      >
        <QuickActionCard
          icon={Trophy}
          tint={colors.gold}
          title="Challenges &"
          detail="achievements"
          onPress={onPressChallenges}
        />
        <QuickActionCard
          icon={Leaf}
          tint={colors.success}
          title="Nutrition &"
          detail="goal"
          onPress={onPressNutrition}
        />
        <QuickActionCard
          icon={HeartPulse}
          tint={colors.destructive}
          title="Health"
          detail="check up"
          onPress={onPressHealth}
        />
        <QuickActionCard
          icon={Flame}
          tint={colors.avatarPurple}
          title="Streaks"
          detail={`${streakDays} ${streakDays === 1 ? 'day' : 'days'}`}
          onPress={onPressStreaks}
        />
      </ScrollView>
    );
  },
);

QuickActionsRow.displayName = 'QuickActionsRow';

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -spacing.base },
  row: {
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
  },
});
