import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';

/**
 * The line at the foot of the reminder plan.
 *
 * It argues for the setting above it rather than describing it: a user who has
 * just switched seven reminders on wants to know that is a reasonable number,
 * not to be told again what a reminder does.
 */
export const ReminderTipCard = memo(() => {
  const { colors, isDark } = useTheme();

  return (
    <Box
      radius="xl"
      p="base"
      style={{ backgroundColor: withAlpha(colors.primary, isDark ? 0.16 : 0.08) }}
    >
      <HStack align="center" gap="md">
        <Emoji size="md">💡</Emoji>

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={1}>
            Small sips, big difference
          </AppText>
          <AppText variant="micro" color="textSecondary" numberOfLines={2}>
            A glass every couple of hours beats a litre in one go — your body
            can only take in so much at a time.
          </AppText>
        </VStack>
      </HStack>
    </Box>
  );
});

ReminderTipCard.displayName = 'ReminderTipCard';
