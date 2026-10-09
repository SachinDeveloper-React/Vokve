import React, { memo } from 'react';
import { Trophy } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { StreakRun } from '../../types/models';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

interface Props {
  currentStreak: number;
  /** Null until the first day is recorded. */
  longestStreak: StreakRun | null;
  /** What makes a day count, in the server's words — shown at zero. */
  howToEarn: string;
}

const plural = (days: number) => (days === 1 ? 'Day' : 'Days');

/**
 * The two figures the screen is built around: the run going now, and the
 * longest there has ever been.
 *
 * Side by side with a rule between them rather than one above the other.
 * They are the same measurement at two scales, and the only question a
 * member asks of the pair is "how far off my best am I" — which is a
 * comparison, and comparisons want to be read across.
 *
 * The line under the current figure changes with it. At zero there is
 * nothing to encourage, so it says what would start one instead; that
 * sentence is the server's, because what counts as a day is the server's.
 */
export const StreakFiguresCard = memo(
  ({ currentStreak, longestStreak, howToEarn }: Props) => {
    const { colors } = useTheme();
    const best = longestStreak?.length ?? 0;

    return (
      <Card radius="xl" padding="base">
        <HStack align="center" gap="base">
          <Emoji size="xl">🔥</Emoji>

          <VStack
            flex={1}
            gap="xxs"
            accessible
            accessibilityLabel={`Current streak, ${currentStreak} ${plural(
              currentStreak,
            ).toLowerCase()}`}
          >
            <AppText variant="micro" color="textSecondary">
              Current Streak
            </AppText>
            <HStack align="baseline" gap="xs">
              <AppText variant="display" style={{ color: colors.brandAccent }}>
                {String(currentStreak)}
              </AppText>
              <AppText variant="h2">{plural(currentStreak)}</AppText>
            </HStack>
            <AppText variant="miniMicro" color="textSecondary" numberOfLines={2}>
              {currentStreak > 0 ? 'Keep it going! 🔥' : howToEarn}
            </AppText>
          </VStack>

          <Divider orientation="vertical" />

          <VStack
            gap="xxs"
            accessible
            accessibilityLabel={`Best streak, ${best} ${plural(
              best,
            ).toLowerCase()}`}
          >
            <HStack align="center" gap="xs">
              <Icon as={Trophy} size="xs" color="gold" />
              <AppText variant="micro" color="textSecondary">
                Best Streak
              </AppText>
            </HStack>
            <HStack align="baseline" gap="xs">
              <AppText variant="metric">{String(best)}</AppText>
              <AppText variant="bodyStrong">{plural(best)}</AppText>
            </HStack>
            <AppText variant="miniMicro" color="textSecondary">
              Your longest streak
            </AppText>
          </VStack>
        </HStack>
      </Card>
    );
  },
);

StreakFiguresCard.displayName = 'StreakFiguresCard';
