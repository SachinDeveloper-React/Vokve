import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { radius, useTheme } from '../../theme';
import type { VitalReading } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Pressable } from '../form/Pressable';
import { Emoji } from '../media/Emoji';
import { AppText } from '../ui/AppText';
import {
  STATUS_STYLE,
  VITAL_STYLE,
  formatVitalValue,
  statusOf,
} from './vitals';

interface Props {
  reading: VitalReading;
  /**
   * Opens the vital's own screen. Left off, the tile is a readout — which is
   * what BMI and weight are today: a tile that looked pressable and did
   * nothing would be worse than one that plainly does not.
   */
  onPress?: () => void;
}

/**
 * One vital: what it is, what it read, and whether that is healthy.
 *
 * The status word is what carries the verdict, in its own colour. Colour alone
 * would leave a red-green colourblind reader unable to tell a normal pulse
 * from a high one, which on this screen of all screens is not acceptable.
 */
export const VitalTile = memo(({ reading, onPress }: Props) => {
  const { colors } = useTheme();
  const { label, unit } = VITAL_STYLE[reading.kind];
  const status = STATUS_STYLE[statusOf(reading)];

  const body = (
    <VStack
      flex={1}
      gap="xs"
      p="md"
      style={[styles.tile, { borderColor: colors.border }]}
      accessible
      accessibilityLabel={`${label}, ${formatVitalValue(reading)} ${unit}, ${
        status.label
      }`}
    >
      <HStack align="center" gap="xs">
        <Emoji size="sm">{VITAL_STYLE[reading.kind].emoji}</Emoji>
        <AppText variant="miniMicro" color="textSecondary" numberOfLines={2}>
          {label}
        </AppText>
      </HStack>

      <HStack align="baseline" gap="xxs">
        <AppText variant="h2" numberOfLines={1}>
          {formatVitalValue(reading)}
        </AppText>
        {unit ? (
          <AppText variant="miniMicro" color="textTertiary" numberOfLines={1}>
            {unit}
          </AppText>
        ) : null}
      </HStack>

      <AppText
        variant="miniMicro"
        numberOfLines={1}
        style={{ color: colors[status.tint] }}
      >
        {status.label}
      </AppText>
    </VStack>
  );

  if (!onPress) {
    return body;
  }

  return (
    <Pressable
      onPress={onPress}
      feedback="scale"
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${formatVitalValue(reading)} ${unit}, ${
        status.label
      }. Opens details.`}
      style={styles.press}
    >
      {body}
    </Pressable>
  );
});

VitalTile.displayName = 'VitalTile';

const styles = StyleSheet.create({
  tile: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  press: { flex: 1 },
});
