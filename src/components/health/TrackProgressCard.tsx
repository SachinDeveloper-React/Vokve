import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { darkColors, radius, spacing, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  onPressTrends: () => void;
}

/**
 * The way from today's readings to the shape they make over time.
 *
 * Its own banner rather than a link inside the vitals card: a trend is a
 * different question from a reading — "is this normal" against "is this
 * moving" — and burying the second inside the answer to the first is how it
 * goes unnoticed.
 */
export const TrackProgressCard = memo(({ onPressTrends }: Props) => {
  const { colors } = useTheme();
  const foreground = darkColors.tierForeground;

  return (
    <Pressable
      onPress={onPressTrends}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel="Track your progress. View your vitals trends over time."
    >
      <View style={[styles.panel, { backgroundColor: colors.tierBackground }]}>
        <HStack align="center" gap="base">
          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong" style={{ color: foreground }}>
              Track Your Progress
            </AppText>
            <AppText
              variant="micro"
              style={{ color: withAlpha(foreground, 0.68) }}
            >
              View your vitals trends over time.
            </AppText>
          </VStack>

          <HStack align="center" gap="xxs">
            <AppText variant="bodyStrong" style={{ color: colors.primary }}>
              View Trends
            </AppText>
            <Icon as={ChevronRight} size="sm" tint={colors.primary} />
          </HStack>
        </HStack>
      </View>
    </Pressable>
  );
});

TrackProgressCard.displayName = 'TrackProgressCard';

const styles = StyleSheet.create({
  panel: { borderRadius: radius.xl, padding: spacing.base },
});
