import React, { memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { fontWeight, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';

export type WordmarkSize = 'sm' | 'md' | 'lg';

const SIZES: Record<WordmarkSize, number> = {
  sm: moderateScale(20),
  md: moderateScale(28),
  lg: moderateScale(36),
};

/** Where the accent colour takes over. "VOK" dark, "VE" orange. */
const SPLIT_AT = 3;
const NAME = 'VOKVE';

interface Props {
  size?: WordmarkSize;
}

/**
 * The two-tone VOKVE wordmark.
 *
 * Rendered as a single Text with a nested span rather than two side-by-side
 * Texts: two Texts would let the halves wrap apart, and their baselines drift
 * once the OS font scale changes. One string keeps the letterforms kerned as
 * one word.
 *
 * It reads the `brand` token rather than a fixed navy, so the dark half
 * inverts in dark mode instead of disappearing into the background.
 */
export const Wordmark = memo(({ size = 'md' }: Props) => {
  const { colors } = useTheme();
  const fontSize = SIZES[size];

  return (
    <Text
      style={[styles.base, { fontSize, color: colors.brand }]}
      accessibilityRole="header"
      accessibilityLabel="vokve"
      // The logo is a fixed graphic; letting it scale with the OS text setting
      // would push the header actions off the row.
      allowFontScaling={false}
    >
      {NAME.slice(0, SPLIT_AT)}
      <Text style={{ color: colors.brandAccent }}>{NAME.slice(SPLIT_AT)}</Text>
    </Text>
  );
});

Wordmark.displayName = 'Wordmark';

const styles = StyleSheet.create({
  base: {
    fontWeight: fontWeight.heavy,
    letterSpacing: -0.5,
  },
});
