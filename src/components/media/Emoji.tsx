import React, { memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { moderateScale } from '../../theme/responsive';

export type EmojiSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<EmojiSize, number> = {
  sm: moderateScale(16),
  md: moderateScale(22),
  lg: moderateScale(28),
  xl: moderateScale(36),
};

interface Props {
  /** The emoji character itself, e.g. `🏃`. */
  children: string;
  size?: EmojiSize | number;
  /**
   * What a screen reader should announce. Left out, the glyph counts as
   * decoration and is skipped — which is right whenever the text beside it
   * already says the same thing.
   */
  label?: string;
}

/**
 * One emoji glyph, sized off the layout scale rather than the type scale.
 *
 * Emoji take no theme colour, so they are not text in the sense `AppText`
 * means: their size is a layout measurement, and letting the OS font setting
 * grow them would push whatever sits beside them off its row. That is why
 * this is its own component rather than an `AppText` with a `fontSize`.
 */
export const Emoji = memo(({ children, size = 'md', label }: Props) => {
  const fontSize = typeof size === 'number' ? size : SIZES[size];
  const decorative = label === undefined;

  return (
    <Text
      allowFontScaling={false}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={label}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      // The line height has to be set with the size: the default leaves a tall
      // box around the glyph on Android and knocks the row off its centre line.
      style={[styles.glyph, { fontSize, lineHeight: Math.round(fontSize * 1.2) }]}
    >
      {children}
    </Text>
  );
});

Emoji.displayName = 'Emoji';

const styles = StyleSheet.create({
  glyph: { includeFontPadding: false, textAlign: 'center' },
});
