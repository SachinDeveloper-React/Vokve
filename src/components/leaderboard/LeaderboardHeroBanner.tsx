import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';

/**
 * The banner over the reward tiers: what the board is for, in three lines.
 *
 * Gold rather than the brand accent, and the only gold panel on the screen: it
 * is the same colour as the first-place tier below it, which is the point the
 * whole page is arranged around.
 */
export const LeaderboardHeroBanner = memo(() => {
  const { colors, isDark } = useTheme();

  return (
    <Box
      radius="xl"
      p="base"
      style={{ backgroundColor: withAlpha(colors.gold, isDark ? 0.18 : 0.12) }}
    >
      <HStack align="center" gap="md">
        <VStack flex={1} gap="xxs">
          <AppText variant="micro" color="textSecondary">
            Climb the leaderboard
          </AppText>
          <AppText variant="h2">Win Amazing Rewards!</AppText>
          <AppText variant="caption" color="textSecondary">
            Perform. Compete. Earn.
          </AppText>
        </VStack>

        {/* Decorative: the three lines beside it already say this. */}
        <Box
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Emoji size="xl">🏆</Emoji>
        </Box>
      </HStack>
    </Box>
  );
});

LeaderboardHeroBanner.displayName = 'LeaderboardHeroBanner';
