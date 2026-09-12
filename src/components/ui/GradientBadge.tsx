import React, { memo } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { moderateScale } from '../../theme/responsive';
import {
  fontWeight,
  useTheme,
  useThemedStyles,
  type ThemeShape,
} from '../../theme';

type Size = 'sm' | 'md' | 'lg';
type Variant = 'primary' | 'secondary';

interface Props {
  label: string;
  size?: Size;
  variant?: Variant;
  /** Rendered to the left of the label. */
  icon?: React.ReactNode;
  uppercase?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A pill filled with one of the theme's gradients — the app wordmark, a PRO
 * marker, a personal-best flag on a set.
 *
 * The label is sized here rather than reusing the `label` type variant: that
 * variant is 11px, tuned for muted metadata next to a value, and text that
 * small disappears against a saturated gradient. Anything sitting on a
 * gradient needs both weight and size to hold its own.
 */
const makeStyles = ({ spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    pill: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      borderRadius: radius.pill,
    },
    sm: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    md: {
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm,
    },
    lg: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },

    textSm: { fontSize: moderateScale(12), lineHeight: moderateScale(16), letterSpacing: 0.4 },
    textMd: { fontSize: moderateScale(15), lineHeight: moderateScale(20), letterSpacing: 0.3 },
    textLg: { fontSize: moderateScale(20), lineHeight: moderateScale(26), letterSpacing: 0.2 },

    text: { fontWeight: fontWeight.bold },
    upper: { textTransform: 'uppercase', letterSpacing: 1 },
  });

const TEXT_STYLE: Record<Size, 'textSm' | 'textMd' | 'textLg'> = {
  sm: 'textSm',
  md: 'textMd',
  lg: 'textLg',
};

export const GradientBadge = memo(
  ({
    label,
    size = 'md',
    variant = 'primary',
    icon,
    uppercase = false,
    style,
  }: Props) => {
    const styles = useThemedStyles(makeStyles);
    const { colors } = useTheme();

    return (
      <LinearGradient
        colors={colors.gradient[variant]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.pill, style]}
      >
        {icon ? <View>{icon}</View> : null}
        <Text
          style={[
            styles.text,
            styles[TEXT_STYLE[size]],
            styles[size],
            uppercase && styles.upper,
            { color: colors.primaryForeground },
          ]}
          maxFontSizeMultiplier={1.3}
          accessibilityRole="text"
        >
          {label}
        </Text>
      </LinearGradient>
    );
  },
);

GradientBadge.displayName = 'GradientBadge';
