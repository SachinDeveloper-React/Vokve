import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';

interface Props {
  tip: string;
}

/**
 * The standing piece of advice at the foot of the screen.
 *
 * Green, like the hydration screen's: both are the one thing on their screen
 * that is not a reading of the user's own body, and sharing the colour is what
 * says so before either is read.
 */
export const HealthTipCard = memo(({ tip }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <Box
      radius="xl"
      p="base"
      style={{ backgroundColor: withAlpha(colors.success, isDark ? 0.16 : 0.1) }}
    >
      <VStack gap="xxs">
        <AppText variant="bodyStrong" style={{ color: colors.success }}>
          Health Tip for You
        </AppText>
        <AppText variant="micro" color="textSecondary">
          {tip}
        </AppText>
      </VStack>
    </Box>
  );
});

HealthTipCard.displayName = 'HealthTipCard';
