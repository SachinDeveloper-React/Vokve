import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Info } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import type { ThemeColors } from '../../constants/colors';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Band {
  label: string;
  tint: Extract<keyof ThemeColors, 'primary' | 'success' | 'warning' | 'destructive'>;
  /** What a screen reader should hear instead of a bare range. */
  name: string;
}

/**
 * The four BMI bands, in the order the scale runs.
 *
 * Stated on the screen rather than left to the tile's "Normal": a user whose
 * BMI reads 26 is told it is high, and the next thing they want to know is by
 * how much — which only the scale can answer.
 */
const BANDS: readonly Band[] = [
  { label: '<18.5', tint: 'primary', name: 'Under 18.5, underweight' },
  { label: '18.5–24.9', tint: 'success', name: '18.5 to 24.9, healthy' },
  { label: '25–29.9', tint: 'warning', name: '25 to 29.9, overweight' },
  { label: '30+', tint: 'destructive', name: '30 and over, obese' },
];

interface Props {
  onPressInfo: () => void;
}

/**
 * The BMI scale, as four segments under the tiles.
 *
 * A legend rather than a meter: it does not mark where the user sits, because
 * the tile beside it already states their figure and its verdict. Pointing at
 * a band as well would make the same statement twice, in the louder of the two
 * ways.
 */
export const BmiGuide = memo(({ onPressInfo }: Props) => {
  const { colors } = useTheme();

  return (
    <VStack
      flex={1}
      gap="sm"
      p="md"
      style={[styles.card, { borderColor: colors.border }]}
    >
      <Pressable
        onPress={onPressInfo}
        feedback="opacity"
        visualSize={20}
        accessibilityRole="button"
        accessibilityLabel="BMI guide, what is this?"
      >
        <HStack align="center" gap="xs">
          <AppText variant="bodyStrong">BMI Guide</AppText>
          <Icon as={Info} size="xs" color="textTertiary" />
        </HStack>
      </Pressable>

      <HStack align="center" gap="xs">
        {BANDS.map(band => (
          <View
            key={band.label}
            accessible
            accessibilityLabel={band.name}
            style={[styles.segment, { backgroundColor: colors[band.tint] }]}
          />
        ))}
      </HStack>

      <HStack align="center" gap="xs">
        {BANDS.map(band => (
          <AppText
            key={band.label}
            variant="miniMicro"
            color="textTertiary"
            numberOfLines={1}
            style={styles.label}
          >
            {band.label}
          </AppText>
        ))}
      </HStack>
    </VStack>
  );
});

BmiGuide.displayName = 'BmiGuide';

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  segment: { flex: 1, height: 6, borderRadius: radius.pill },
  label: { flex: 1 },
});
