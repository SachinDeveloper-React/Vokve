import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Tag } from '../ui/Tag';
import { Pressable } from '../form/Pressable';

interface Props {
  tip: string;
  onPressTips: () => void;
}

/**
 * The one suggestion on the screen, under the meals it is about.
 *
 * Inside the meals card rather than floating at the foot of the screen: it
 * says something about dinner, and advice sitting three sections away from the
 * thing it refers to is advice nobody connects.
 */
export const NutritionTipStrip = memo(({ tip, onPressTips }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <Box
      radius="lg"
      p="md"
      style={{ backgroundColor: withAlpha(colors.success, isDark ? 0.16 : 0.1) }}
    >
      <HStack align="center" gap="md">
        <VStack flex={1} gap="xxs">
          <HStack align="center" gap="sm">
            <AppText variant="micro" style={{ color: colors.success }}>
              AI Nutrition Tip
            </AppText>
            <Tag label="New" tint={colors.success} />
          </HStack>

          <AppText variant="miniMicro" color="textSecondary" numberOfLines={2}>
            {tip}
          </AppText>
        </VStack>

        <Pressable
          onPress={onPressTips}
          feedback="opacity"
          accessibilityRole="link"
          accessibilityLabel="View nutrition tips"
        >
          <AppText variant="micro" style={{ color: colors.success }}>
            View Tips
          </AppText>
        </Pressable>
      </HStack>
    </Box>
  );
});

NutritionTipStrip.displayName = 'NutritionTipStrip';
