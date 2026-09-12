import React, { memo } from 'react';
import { StyleSheet, Text, TextProps } from 'react-native';
import { useTheme, typography, type TypographyVariant } from '../../theme';
import type { ThemeColors } from '../../constants/colors';

type ColorToken = Extract<
  keyof ThemeColors,
  | 'text'
  | 'textSecondary'
  | 'textTertiary'
  | 'primary'
  | 'success'
  | 'destructive'
  | 'warning'
>;

interface Props extends TextProps {
  variant?: TypographyVariant;
  color?: ColorToken;
  center?: boolean;
}

/**
 * The only Text component screens should use. Routing every string through the
 * type scale is what stops a codebase drifting into fourteen slightly
 * different font sizes.
 */
export const AppText = memo(
  ({
    variant = 'body',
    color = 'text',
    center = false,
    style,
    ...rest
  }: Props) => {
    const { colors } = useTheme();

    return (
      <Text
        style={[
          typography[variant],
          { color: colors[color] },
          center && styles.center,
          style,
        ]}
        // Respect the OS font-size setting, but stop runaway scaling from
        // destroying dense workout tables.
        maxFontSizeMultiplier={1.4}
        {...rest}
      />
    );
  },
);

AppText.displayName = 'AppText';

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
});
