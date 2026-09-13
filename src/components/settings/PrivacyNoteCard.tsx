import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronRight, ShieldCheck } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';
import { Pressable } from '../form/Pressable';

interface Props {
  onPress: () => void;
}

/**
 * The promise under the switches, and the way to the policy behind it.
 *
 * Last on the screen rather than first: a user arriving here has come to turn
 * something off, and an assurance offered before that is done reads as a plea.
 * Offered after, it answers the question the switches raise — what is the app
 * doing with any of this.
 */
export const PrivacyNoteCard = memo(({ onPress }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel="Privacy first. We only send important and relevant notifications."
    >
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
            <AppText variant="micro" color="textSecondary" numberOfLines={2}>
              We only send important and relevant notifications.
            </AppText>
          </VStack>

          <Icon as={ChevronRight} size="sm" tint={colors.brandAccent} />
        </HStack>
      </View>
    </Pressable>
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
