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
 * Green rather than the water blue everything above it uses: it is the one
 * thing here that is not a reading of the user's own day, and sharing the blue
 * would make it look like a fifth figure.
 */
export const HydrationTipCard = memo(({ tip }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <Box
      radius="xl"
      p="base"
      style={{ backgroundColor: withAlpha(colors.success, isDark ? 0.16 : 0.1) }}
    >
      <VStack gap="xxs">
        <AppText variant="bodyStrong" style={{ color: colors.success }}>
          Hydration Tip
        </AppText>
        <AppText variant="micro" color="textSecondary">
          {tip}
        </AppText>
      </VStack>
    </Box>
  );
});

HydrationTipCard.displayName = 'HydrationTipCard';
