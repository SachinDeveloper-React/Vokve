import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import type { LeaderboardRules } from '../../types/models';

/**
 * The words this build ships with.
 *
 * The three lines are the server's (⚙ `leaderboard.banner`, D-89) — the most
 * rewritten copy in the app, and the one promise about winning things, so it
 * had no business needing a release. These stand in before the read lands,
 * for a server older than the field, and offline: the same rule the rest of
 * the app follows, and the reason the field is optional on the wire.
 */
const SHIPPED = {
  kicker: 'Climb the leaderboard',
  title: 'Win Amazing Rewards!',
  subtitle: 'Perform. Compete. Earn.',
} as const;

interface Props {
  /** The server's three lines; this build's where it sent none. */
  banner?: LeaderboardRules['banner'];
}

/**
 * The banner over the reward tiers: what the board is for, in three lines.
 *
 * Gold rather than the brand accent, and the only gold panel on the screen: it
 * is the same colour as the first-place tier below it, which is the point the
 * whole page is arranged around.
 */
export const LeaderboardHeroBanner = memo(({ banner }: Props) => {
  const { colors, isDark } = useTheme();
  const words = banner ?? SHIPPED;

  return (
    <Box
      radius="xl"
      p="base"
      style={{ backgroundColor: withAlpha(colors.gold, isDark ? 0.18 : 0.12) }}
    >
      <HStack align="center" gap="md">
        <VStack flex={1} gap="xxs">
          <AppText variant="micro" color="textSecondary">
            {words.kicker}
          </AppText>
          <AppText variant="h2">{words.title}</AppText>
          <AppText variant="caption" color="textSecondary">
            {words.subtitle}
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
