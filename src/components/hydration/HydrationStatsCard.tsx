import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

interface FigureProps {
  value: string;
  label: string;
  /** Only the best streak is tinted — see the card's note. */
  tint?: string;
}

const HydrationFigure = memo(({ value, label, tint }: FigureProps) => (
  <VStack
    flex={1}
    align="center"
    gap="xxs"
    accessible
    accessibilityLabel={`${label}, ${value}`}
  >
    <AppText variant="h2" numberOfLines={1} style={tint ? { color: tint } : undefined}>
      {value}
    </AppText>
    <AppText variant="miniMicro" color="textSecondary" center numberOfLines={2}>
      {label}
    </AppText>
  </VStack>
));

HydrationFigure.displayName = 'HydrationFigure';

interface Props {
  bestStreakDays: number;
  dailyAverageMl: number;
  goalHitRatePercent: number;
  dailyReminders: number;
}

/**
 * Four figures about the habit rather than about today.
 *
 * Only the streak is coloured. It is the one figure here the user can break —
 * the average and the hit rate are records of what has already happened — and
 * tinting all four would leave the row with nothing to look at first.
 */
export const HydrationStatsCard = memo(
  ({
    bestStreakDays,
    dailyAverageMl,
    goalHitRatePercent,
    dailyReminders,
  }: Props) => {
    const { colors } = useTheme();

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <AppText variant="h3" numberOfLines={1} style={styles.title}>
            Hydration Stats
          </AppText>

          <HStack align="start" gap="sm">
            <HydrationFigure
              value={`${bestStreakDays} Days`}
              label="Best Streak"
              tint={colors.success}
            />
            <HydrationFigure
              value={`${(dailyAverageMl / 1000).toFixed(1)} L`}
              label="Daily Average"
            />
            <HydrationFigure
              value={`${goalHitRatePercent}%`}
              label="Goal Hit Rate"
            />
            <HydrationFigure
              value={String(dailyReminders)}
              label="Daily Reminders"
            />
          </HStack>
        </VStack>
      </Card>
    );
  },
);

HydrationStatsCard.displayName = 'HydrationStatsCard';

const styles = StyleSheet.create({
  title: { flexShrink: 1 },
});
