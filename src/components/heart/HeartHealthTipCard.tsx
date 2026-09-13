import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

const DISC = moderateScale(34);

interface Props {
  onPress: () => void;
}

/**
 * The standing advice at the foot of the screen.
 *
 * Deliberately general and deliberately last. A screen showing a clinical
 * figure should not follow it with advice that reads as a response to *this*
 * reading — the app has no business doing that — and putting it after the
 * history makes plain that it is the same line for everyone.
 */
export const HeartHealthTipCard = memo(({ onPress }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel="Keep your heart healthy. Regular exercise, good sleep and balanced diet."
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: withAlpha(
              colors.destructive,
              isDark ? 0.12 : 0.07,
            ),
            borderColor: withAlpha(colors.destructive, isDark ? 0.28 : 0.18),
          },
        ]}
      >
        <HStack align="center" gap="md">
          <View
            style={[
              styles.disc,
              { backgroundColor: withAlpha(colors.destructive, 0.24) },
            ]}
          >
            <View
              style={[styles.dot, { backgroundColor: colors.destructive }]}
            />
          </View>

          <VStack flex={1} gap="xxs">
            <AppText variant="bodyStrong" numberOfLines={1}>
              Keep Your Heart Healthy
            </AppText>
            <AppText
              variant="miniMicro"
              color="textSecondary"
              numberOfLines={2}
            >
              Regular exercise, good sleep and balanced diet
            </AppText>
          </VStack>

          <Icon as={ChevronRight} size="sm" tint={colors.destructive} />
        </HStack>
      </View>
    </Pressable>
  );
});

HeartHealthTipCard.displayName = 'HeartHealthTipCard';

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
