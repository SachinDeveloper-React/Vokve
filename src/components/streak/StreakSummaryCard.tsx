import React, { memo } from 'react';
import { Flame } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { formatDateRange } from '../../utils/date';
import type { StreakRun } from '../../stores/streakStore';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';
import { InfoLabel } from '../wallet/InfoLabel';

interface Props {
  currentStreak: number;
  /** Null until the first day is recorded. */
  longestStreak: StreakRun | null;
  onPressInfo?: () => void;
}

/** What the card says under the current figure, by how it is going. */
function encouragementFor(streak: number): [string, string] {
  if (streak === 0) {
    return ['Start today 💪', 'One workout is all it takes to begin.'];
  }
  if (streak < 7) {
    return ['Good start! 🌱', 'A week is the first milestone — keep going.'];
  }
  return ["You're on fire! 🔥", 'Keep it up and unlock bigger rewards.'];
}

/**
 * The two streak figures, side by side.
 *
 * Each half's label sits on its own line above the figure, not beside the
 * flame. Beside it, the label has whatever is left of the half after the disc
 * and a gutter — under 100pt on a 375pt screen — and "CURRENT STREAK" in the
 * upper-cased label style needs more than that, so it ran across the divider
 * into the other half. On its own line it has the whole half, and the two
 * labels sit on one baseline, which is how the eye pairs them.
 *
 * The record is orange and the current figure is not. The current streak is
 * the number the user is working on and the plain text keeps it a fact; the
 * record is the target, and the accent is what makes it read as one.
 */
export const StreakSummaryCard = memo(
  ({ currentStreak, longestStreak, onPressInfo }: Props) => {
    const { colors } = useTheme();
    const [headline, detail] = encouragementFor(currentStreak);

    return (
      <Card radius="xl" padding="lg">
        {/*
          `align="stretch"` lets the rule between the halves take the row's
          height; the gap keeps each half's text off the rule.
        */}
        <HStack align="stretch" gap="md">
          <VStack flex={1} gap="sm">
            <InfoLabel
              label="Current Streak"
              emphasis
              onPressInfo={onPressInfo}
            />

            <HStack align="center" gap="md">
              <IconBadge
                icon={Flame}
                tint={colors.brandAccent}
                size={44}
                variant="outline"
              />

              {/* `flex={1}` keeps the figure inside the half whatever its width. */}
              <HStack align="baseline" gap="xs" flex={1}>
                <AppText variant="metric">{currentStreak}</AppText>
                <AppText variant="bodyStrong">
                  {currentStreak === 1 ? 'Day' : 'Days'}
                </AppText>
              </HStack>
            </HStack>

            <VStack gap="none">
              <AppText variant="caption">{headline}</AppText>
              <AppText variant="caption" color="textSecondary">
                {detail}
              </AppText>
            </VStack>
          </VStack>

          <Divider orientation="vertical" />

          <VStack flex={1} gap="sm">
            <InfoLabel
              label="Longest Streak"
              emphasis
              onPressInfo={onPressInfo}
            />

            <HStack align="baseline" gap="xs">
              <AppText variant="metric" style={{ color: colors.brandAccent }}>
                {longestStreak?.length ?? 0}
              </AppText>
              <AppText
                variant="bodyStrong"
                style={{ color: colors.brandAccent }}
              >
                {longestStreak?.length === 1 ? 'Day' : 'Days'}
              </AppText>
            </HStack>

            {longestStreak ? (
              <VStack gap="none">
                <AppText variant="caption" color="textSecondary">
                  Achieved on
                </AppText>
                <AppText variant="caption">
                  {formatDateRange(longestStreak.start, longestStreak.end)}
                </AppText>
              </VStack>
            ) : (
              <AppText variant="caption" color="textSecondary">
                No streak yet
              </AppText>
            )}
          </VStack>
        </HStack>
      </Card>
    );
  },
);

StreakSummaryCard.displayName = 'StreakSummaryCard';
