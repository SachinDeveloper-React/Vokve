import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';

const DISC = moderateScale(34);

interface Props {
  title: string;
  message: string;
  /** The vital's colour. Pass a theme colour. */
  tint: string;
}

/**
 * The standing advice at the foot of a vital's screen.
 *
 * Deliberately general and deliberately last. A screen showing a clinical
 * figure should not follow it with advice that reads as a response to *this*
 * reading — the app has no business doing that — and putting it after the
 * history makes plain that it is the same line for everyone.
 *
 * It is a card and not a button. The whole thing used to be pressable, with a
 * chevron promising somewhere to go, and it went nowhere. The advice is the
 * content, not a door to it — so the chevron is gone, and the line itself is
 * set at a size somebody can actually read it at.
 */
export const VitalTipCard = memo(({ title, message, tint }: Props) => {
  const { isDark } = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: withAlpha(tint, isDark ? 0.12 : 0.07),
          borderColor: withAlpha(tint, isDark ? 0.28 : 0.18),
        },
      ]}
    >
      <HStack align="center" gap="md">
        <View style={[styles.disc, { backgroundColor: withAlpha(tint, 0.24) }]}>
          <View style={[styles.dot, { backgroundColor: tint }]} />
        </View>

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong">{title}</AppText>
          <AppText variant="caption" color="textSecondary">
            {message}
          </AppText>
        </VStack>
      </HStack>
    </View>
  );
});

VitalTipCard.displayName = 'VitalTipCard';

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
