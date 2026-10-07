import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { ShopColor } from '../../types/models';
import { HStack } from '../layout/Stack';
import { Pressable } from '../form/Pressable';

interface Props {
  colors: readonly ShopColor[];
  /** The chosen colour's name. */
  value: string | null;
  onChange: (name: string) => void;
}

const SWATCH = moderateScale(40);
const RING = 2;
const GAP = 3;

/**
 * The colours an item comes in, one disc each, the chosen one ringed in
 * the brand orange with a gap so a dark swatch still shows its ring.
 *
 * Every swatch carries a hairline edge: a near-black disc on a dark card,
 * or a white one on a light card, would otherwise be invisible.
 */
export const ColorSwatchPicker = memo(({ colors, value, onChange }: Props) => {
  const theme = useTheme();
  return (
    <HStack gap="md" wrap accessibilityRole="radiogroup">
      {colors.map(color => {
        const selected = color.name === value;
        return (
          <Pressable
            key={color.name}
            onPress={() => onChange(color.name)}
            feedback="scale"
            accessibilityRole="radio"
            accessibilityLabel={color.name}
            accessibilityState={{ selected }}
            style={[
              styles.ring,
              selected && { borderColor: theme.colors.brandAccent },
            ]}
          >
            <View
              style={[
                styles.swatch,
                {
                  backgroundColor: color.hex,
                  borderColor: theme.colors.border,
                },
              ]}
            />
          </Pressable>
        );
      })}
    </HStack>
  );
});

ColorSwatchPicker.displayName = 'ColorSwatchPicker';

const styles = StyleSheet.create({
  ring: {
    width: SWATCH + (RING + GAP) * 2,
    height: SWATCH + (RING + GAP) * 2,
    borderRadius: SWATCH,
    borderWidth: RING,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: SWATCH,
    height: SWATCH,
    borderRadius: SWATCH / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
