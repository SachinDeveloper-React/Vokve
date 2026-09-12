import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';

interface Props {
  /** Null while the profile is loading — the line drops the name. */
  name?: string | null;
}

/** First name only — a cheer with a full legal name reads like a form. */
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * The line at the foot of the challenge board.
 *
 * Its own component rather than `StreakCheerCard` with different words: that
 * one speaks about a streak and takes the run's length to decide what to say,
 * where this one is about the board above it and has nothing to measure. They
 * look alike on purpose — a user who reaches the bottom of either screen is
 * met by the same shape of sentence.
 */
export const ChallengeCheerCard = memo(({ name }: Props) => {
  const { colors, isDark } = useTheme();
  const who = name ? `, ${firstNameOf(name)}` : '';

  return (
    <Box
      radius="xl"
      p="base"
      style={{ backgroundColor: withAlpha(colors.success, isDark ? 0.16 : 0.1) }}
    >
      <HStack align="center" gap="md">
        <Emoji size="md">🏆</Emoji>

        <VStack flex={1} gap="xxs">
          <AppText
            variant="bodyStrong"
            numberOfLines={1}
            style={{ color: colors.success }}
          >
            {`Keep going${who}! 🔥`}
          </AppText>
          <AppText variant="micro" color="textSecondary" numberOfLines={2}>
            Every challenge brings you closer to your best self.
          </AppText>
        </VStack>

        {/*
          Decorative: it restates "keep moving" as a picture, which the
          sentence beside it already says. Hidden from the screen reader so it
          is not announced as unnamed glyphs.
        */}
        <HStack
          align="center"
          gap="xs"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Emoji size="sm">👟</Emoji>
          <AppText variant="bodyStrong" color="textTertiary">
            + +
          </AppText>
        </HStack>
      </HStack>
    </Box>
  );
});

ChallengeCheerCard.displayName = 'ChallengeCheerCard';
