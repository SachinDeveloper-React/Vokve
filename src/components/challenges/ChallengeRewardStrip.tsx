import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  onPressHowItWorks: () => void;
}

/**
 * The one line that says why the board exists: challenges pay coins, coins buy
 * rewards.
 *
 * Between the running challenges and the achievements rather than at the foot
 * of the screen. It is the sentence that connects the two — the bars above
 * earn the coins, the badges below are what they add up to — and a user who
 * never scrolls that far is the one who most needs telling.
 */
export const ChallengeRewardStrip = memo(({ onPressHowItWorks }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <Box
      radius="xl"
      p="base"
      style={{ backgroundColor: withAlpha(colors.success, isDark ? 0.16 : 0.1) }}
    >
      <HStack align="center" gap="md">
        <Emoji size="md">🏆</Emoji>

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={2}>
            Complete challenges, earn coins
          </AppText>
          <AppText variant="micro" color="textSecondary" numberOfLines={2}>
            and unlock exclusive rewards!
          </AppText>
        </VStack>

        <Pressable
          onPress={onPressHowItWorks}
          feedback="opacity"
          accessibilityRole="link"
          accessibilityLabel="How challenges work"
        >
          <AppText variant="micro" style={{ color: colors.success }}>
            How it Works?
          </AppText>
        </Pressable>
      </HStack>
    </Box>
  );
});

ChallengeRewardStrip.displayName = 'ChallengeRewardStrip';
