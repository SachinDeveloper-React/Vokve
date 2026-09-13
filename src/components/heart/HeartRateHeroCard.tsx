import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Heart } from 'lucide-react-native';
import { radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { HEART_BANDS, bandFor, heartMessageFor } from '../health/vitals';

const DISC = moderateScale(72);

interface Props {
  bpm: number;
}

/**
 * The reading itself, and the scale it sits on.
 *
 * The band is named in words above the scale and marked in colour on it, so
 * the verdict survives for a reader who cannot separate the green segment from
 * the amber one — which on a screen about a heart is not a detail.
 *
 * The scale is a legend rather than a meter with a marker: the figure above it
 * is already the reading, and pointing at the same fact twice would make the
 * band the loudest thing on a card whose subject is the number.
 */
export const HeartRateHeroCard = memo(({ bpm }: Props) => {
  const { colors, isDark } = useTheme();
  const band = bandFor(bpm);
  const bandColor = colors[band.tint];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: withAlpha(colors.destructive, isDark ? 0.14 : 0.07),
          borderColor: withAlpha(colors.destructive, isDark ? 0.3 : 0.18),
        },
      ]}
    >
      <HStack align="center" gap="base">
        <View
          style={[
            styles.disc,
            { backgroundColor: withAlpha(colors.destructive, 0.24) },
          ]}
        >
          <Icon as={Heart} size="xl" tint={colors.destructive} />
        </View>

        <VStack flex={1} gap="xxs">
          <HStack align="baseline" gap="sm">
            <AppText variant="display" numberOfLines={1}>
              {Math.round(bpm)}
            </AppText>
            <AppText
              variant="h3"
              numberOfLines={1}
              style={{ color: colors.destructive }}
            >
              bpm
            </AppText>
          </HStack>

          <AppText variant="h3" numberOfLines={1} style={{ color: bandColor }}>
            {band.label}
          </AppText>

          <AppText variant="micro" color="textSecondary" numberOfLines={2}>
            {heartMessageFor(bpm)}
          </AppText>
        </VStack>
      </HStack>

      <VStack gap="xs">
        <HStack align="center" gap="xxs">
          {HEART_BANDS.map(entry => (
            <View
              key={entry.range}
              accessible
              accessibilityLabel={`${entry.range} beats per minute, ${entry.label}`}
              style={[styles.segment, { backgroundColor: colors[entry.tint] }]}
            />
          ))}
        </HStack>

        <HStack align="start" gap="xxs">
          {HEART_BANDS.map(entry => (
            <VStack key={entry.range} flex={1} gap="none">
              <AppText variant="miniMicro" numberOfLines={1}>
                {entry.range}
              </AppText>
              <AppText
                variant="miniMicro"
                color="textTertiary"
                numberOfLines={1}
              >
                {entry.label}
              </AppText>
            </VStack>
          ))}
        </HStack>
      </VStack>
    </View>
  );
});

HeartRateHeroCard.displayName = 'HeartRateHeroCard';

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.base,
    gap: spacing.base,
  },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: { flex: 1, height: 8, borderRadius: radius.pill },
});
