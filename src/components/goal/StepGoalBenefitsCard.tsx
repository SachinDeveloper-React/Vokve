import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Heart, Weight, Zap } from 'lucide-react-native';
import type { ThemeColors } from '../../constants/colors';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';

const DISC = 40;

/**
 * What walking more does, as the design lists it. Each label breaks where
 * the design breaks it, so four fit across a phone without one wrapping
 * differently from the rest.
 */
const BENEFITS = [
  {
    label: 'Better\nHeart Health',
    icon: Heart,
    tint: (colors: ThemeColors) => colors.avatarRed,
  },
  {
    label: 'Helps in\nWeight Control',
    icon: Weight,
    tint: (colors: ThemeColors) => colors.avatarPrimary,
  },
  {
    label: 'More\nEnergy',
    icon: Zap,
    tint: (colors: ThemeColors) => colors.success,
  },
  { label: 'Improved\nMood', emoji: '😌' },
] as const;

/** Why the goal is worth keeping — four things, a glyph and two lines each. */
export const StepGoalBenefitsCard = memo(() => {
  const { colors } = useTheme();

  return (
    <Card elevation="low" radius="lg" padding="base">
      <VStack gap="md">
        <AppText variant="bodyStrong" accessibilityRole="header">
          Potential Benefits
        </AppText>
        <HStack align="start" gap="sm">
          {BENEFITS.map(benefit => (
            <VStack
              key={benefit.label}
              flex={1}
              gap="sm"
              accessible
              accessibilityLabel={benefit.label.replace('\n', ' ')}
            >
              {'emoji' in benefit ? (
                <View style={[styles.disc, { backgroundColor: colors.muted }]}>
                  <Emoji size="sm">{benefit.emoji}</Emoji>
                </View>
              ) : (
                <IconBadge
                  icon={benefit.icon}
                  tint={benefit.tint(colors)}
                  size={DISC}
                  variant="muted"
                />
              )}
              <AppText variant="micro" numberOfLines={2}>
                {benefit.label}
              </AppText>
            </VStack>
          ))}
        </HStack>
      </VStack>
    </Card>
  );
});

StepGoalBenefitsCard.displayName = 'StepGoalBenefitsCard';

const styles = StyleSheet.create({
  disc: {
    width: moderateScale(DISC),
    height: moderateScale(DISC),
    borderRadius: moderateScale(DISC) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
