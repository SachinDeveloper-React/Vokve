import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';

/**
 * The promise under the switches.
 *
 * Last on the screen rather than first: a user arriving here has come to turn
 * something off, and an assurance offered before that is done reads as a plea.
 * Offered after, it answers the question the switches raise — what is the app
 * doing with any of this.
 *
 * It said the same thing it says now, but as a button with a chevron, pointing
 * at a policy screen the app does not have. The assurance is the whole of the
 * card; there was never anywhere for it to lead.
 */
export const PrivacyNoteCard = memo(() => {
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
        <IconBadge
          icon={ShieldCheck}
          tint={colors.brandAccent}
          size={34}
          shape="rounded"
        />

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong" numberOfLines={1}>
            Privacy First
          </AppText>
          <AppText variant="caption" color="textSecondary">
            We only send important and relevant notifications.
          </AppText>
        </VStack>
      </HStack>
    </View>
  );
});

PrivacyNoteCard.displayName = 'PrivacyNoteCard';

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
  },
});
