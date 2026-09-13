import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';

const DISC = moderateScale(40);

/**
 * What the screen is for, in two lines.
 *
 * It leads with what notifications are *for* rather than with how to turn them
 * off, and then says turning them off is always available. A settings screen
 * that opened with "you can disable these" reads as an apology for the feature
 * it is configuring.
 */
export const NotificationIntroCard = memo(() => {
  const { colors, isDark } = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: withAlpha(colors.brandAccent, isDark ? 0.14 : 0.08),
          borderColor: withAlpha(colors.brandAccent, isDark ? 0.3 : 0.2),
        },
      ]}
    >
      <HStack align="center" gap="md">
        <View
          style={[
            styles.disc,
            { backgroundColor: withAlpha(colors.brandAccent, 0.24) },
          ]}
        >
          <View
            style={[styles.dot, { backgroundColor: colors.brandAccent }]}
          />
        </View>

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={2}>
            Stay updated with your fitness, coins, orders and offers
          </AppText>
          <AppText variant="micro" color="textSecondary" numberOfLines={2}>
            You can turn off any notification anytime.
          </AppText>
        </VStack>

        {/* Decorative: the two lines beside it already say this. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Emoji size="lg">🔔</Emoji>
        </View>
      </HStack>
    </View>
  );
});

NotificationIntroCard.displayName = 'NotificationIntroCard';

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
  },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: DISC / 3, height: DISC / 3, borderRadius: DISC / 6 },
});
