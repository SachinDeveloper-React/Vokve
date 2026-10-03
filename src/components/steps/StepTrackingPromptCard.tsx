import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronRight, Footprints, TriangleAlert } from 'lucide-react-native';
import type { StepPromptVariant } from '../../stores/stepsStore';
import { radius, spacing, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';

interface Props {
  variant: StepPromptVariant;
  onPress: () => void;
}

const COPY: Record<StepPromptVariant, { title: string; message: string }> = {
  setup: {
    title: 'Start counting your steps',
    message: 'Turn on step counting to earn coins for every walk.',
  },
  attention: {
    title: 'Step counting needs a look',
    message: 'Some of your steps may not be counted. Tap to fix it.',
  },
};

/**
 * The dashboard's way into step tracking, shown above the step card only
 * while counting is not doing its job — the card's zero means nothing until
 * it is, and saying why is better than a number that never moves.
 */
export const StepTrackingPromptCard = memo(({ variant, onPress }: Props) => {
  const { colors, isDark } = useTheme();
  const tint = variant === 'attention' ? colors.warning : colors.brandAccent;
  const copy = COPY[variant];

  return (
    <Pressable
      onPress={onPress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={`${copy.title}. ${copy.message}`}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: withAlpha(tint, isDark ? 0.14 : 0.08),
            borderColor: withAlpha(tint, isDark ? 0.3 : 0.2),
          },
        ]}
      >
        <HStack align="center" gap="md">
          <IconBadge
            icon={variant === 'attention' ? TriangleAlert : Footprints}
            tint={tint}
            size={34}
            shape="rounded"
          />
          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong" numberOfLines={1}>
              {copy.title}
            </AppText>
            <AppText variant="micro" color="textSecondary" numberOfLines={2}>
              {copy.message}
            </AppText>
          </VStack>
          <Icon as={ChevronRight} size="sm" tint={tint} />
        </HStack>
      </View>
    </Pressable>
  );
});

StepTrackingPromptCard.displayName = 'StepTrackingPromptCard';

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
  },
});
