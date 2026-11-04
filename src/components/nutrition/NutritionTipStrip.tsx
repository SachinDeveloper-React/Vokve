import React, { memo } from 'react';
import { Lightbulb } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

interface Props {
  tip: string;
}

/**
 * The day's nutrition tip, under the meals it is about.
 *
 * Inside the meals card rather than floating at the foot of the screen: it
 * says something about dinner, and advice sitting three sections away from the
 * thing it refers to is advice nobody connects.
 *
 * It used to call itself an "AI Nutrition Tip" beside a permanent "New" tag,
 * and offer a "View Tips" link wired to nothing. All three are gone. The line
 * is written by whoever runs the app and served by `GET /content/tip`, so
 * crediting a model for it was a claim the app could not stand behind; a "New"
 * badge that is never absent says nothing; and a link to a tips library that
 * does not exist is worse than no link, because the user who taps it is left
 * thinking the app is broken. What is left is the one thing that was real —
 * the advice — now set large enough to read, which it was not when the label
 * above it was bigger than the sentence itself.
 */
export const NutritionTipStrip = memo(({ tip }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <Box
      radius="lg"
      p="md"
      style={{
        backgroundColor: withAlpha(colors.success, isDark ? 0.16 : 0.1),
      }}
    >
      <HStack
        align="start"
        gap="md"
        accessible
        accessibilityLabel={`Tip of the day. ${tip}`}
      >
        <Icon as={Lightbulb} size="md" tint={colors.success} />

        <VStack flex={1} gap="xxs">
          <AppText variant="label" style={{ color: colors.success }}>
            Tip of the day
          </AppText>

          <AppText variant="caption" color="textSecondary">
            {tip}
          </AppText>
        </VStack>
      </HStack>
    </Box>
  );
});

NutritionTipStrip.displayName = 'NutritionTipStrip';
