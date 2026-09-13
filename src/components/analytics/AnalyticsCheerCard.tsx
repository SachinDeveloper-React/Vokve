import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { formatGrouped } from '../../utils/format';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';

interface Props {
  /** Null while the profile is loading — the line drops the name. */
  name?: string | null;
  steps: number;
  goal: number;
}

/** First name only — a cheer with a full legal name reads like a form. */
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * The line at the foot of the analytics screen.
 *
 * It states the one figure the rest of the screen does not: how many steps are
 * left. Everything above is a record of what has happened, and a user who has
 * scrolled this far is asking what to do about it — "1,755 to go" is an answer
 * where "keep it up" on its own is wallpaper.
 */
export const AnalyticsCheerCard = memo(({ name, steps, goal }: Props) => {
  const { colors, isDark } = useTheme();
  const who = name ? `, ${firstNameOf(name)}` : '';
  const remaining = Math.max(0, goal - steps);

  return (
    <Box
      radius="xl"
      p="base"
      style={{ backgroundColor: withAlpha(colors.success, isDark ? 0.16 : 0.1) }}
    >
      <HStack align="center" gap="md">
        <Emoji size="md">🔥</Emoji>

        <VStack flex={1} gap="xxs">
          <AppText
            variant="bodyStrong"
            numberOfLines={1}
            style={{ color: colors.success }}
          >
            {remaining === 0
              ? `Goal smashed${who}!`
              : `Keep it up${who}!`}
          </AppText>
          <AppText variant="micro" color="textSecondary" numberOfLines={2}>
            {remaining === 0
              ? "Today's goal is behind you — every step from here is a bonus."
              : `${formatGrouped(remaining)} steps to go today. That's about a ${
                  remaining < 1500 ? 'ten' : 'twenty'
                }-minute walk.`}
          </AppText>
        </VStack>
      </HStack>
    </Box>
  );
});

AnalyticsCheerCard.displayName = 'AnalyticsCheerCard';
