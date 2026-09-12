import React, { memo, useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  duration,
  fontWeight,
  useTheme,
  useThemedStyles,
  type ThemeShape,
} from '../../theme';
import { AppText } from './AppText';

type Variant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'destructive'
  | 'brand'
  | 'brandOutline';
type Size = 'xs' | 'sm' | 'md' | 'lg';

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  /**
   * Which side of the label the icon sits on. Leading is the default because
   * an icon there labels the action; a trailing icon is directional — it says
   * where the button goes, which is why "Continue →" wants this.
   */
  iconPosition?: 'leading' | 'trailing';
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    base: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'transparent',
    },
    // `xs` is for a call to action that shares a row with the copy selling it
    // — the premium card's upgrade pill. At `sm` the button takes so much of a
    // 375pt row that the sentence beside it wraps to four lines.
    xs: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, minHeight: 30 },
    sm: { paddingVertical: spacing.sm, paddingHorizontal: spacing.base, minHeight: 36 },
    md: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl, minHeight: 48 },
    lg: { paddingVertical: spacing.base, paddingHorizontal: spacing.xxl, minHeight: 56 },
    fullWidth: { alignSelf: 'stretch' },
    primary: { backgroundColor: colors.primary },
    // The wordmark's orange, for the one call to action a screen is built
    // around. `primary` stays the app's blue so the two never compete.
    brand: { backgroundColor: colors.brandAccent },
    // The same orange as an outline, for a second action that sits beside or
    // beneath a `brand` one and must not compete with it for the eye.
    brandOutline: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.brandAccent,
    },
    secondary: { backgroundColor: colors.secondary, borderColor: colors.border },
    ghost: { backgroundColor: 'transparent' },
    destructive: { backgroundColor: colors.destructive },
    disabled: { opacity: 0.45 },
    // `micro` is a medium weight tuned for muted metadata; a label sitting on a
    // saturated fill needs the extra weight to hold its own against it.
    labelXs: { fontWeight: fontWeight.semibold },
  });

/**
 * The press feedback runs through Reanimated, so the scale animation stays on
 * the UI thread and keeps responding even while JS is busy saving a set or
 * parsing an API response.
 */
export const Button = memo(
  ({
    label,
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    icon,
    iconPosition = 'leading',
    disabled,
    onPressIn,
    onPressOut,
    ...rest
  }: Props) => {
    const styles = useThemedStyles(makeStyles);
    const { colors } = useTheme();
    const scale = useSharedValue(1);

    const animatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: scale.value }],
    }));

    const handlePressIn = useCallback<NonNullable<PressableProps['onPressIn']>>(
      event => {
        scale.value = withTiming(0.97, { duration: duration.instant });
        onPressIn?.(event);
      },
      [onPressIn, scale],
    );

    const handlePressOut = useCallback<
      NonNullable<PressableProps['onPressOut']>
    >(
      event => {
        scale.value = withTiming(1, { duration: duration.fast });
        onPressOut?.(event);
      },
      [onPressOut, scale],
    );

    const isInactive = Boolean(disabled) || loading;
    const labelColor =
      variant === 'ghost'
        ? colors.primary
        : variant === 'secondary'
        ? colors.text
        : variant === 'brandOutline'
        ? colors.brandAccent
        : colors.primaryForeground;

    return (
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: isInactive, busy: loading }}
        disabled={isInactive}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.base,
          styles[size],
          styles[variant],
          fullWidth && styles.fullWidth,
          isInactive && styles.disabled,
          animatedStyle,
        ]}
        {...rest}
      >
        {loading ? (
          <ActivityIndicator size="small" color={labelColor} />
        ) : (
          <>
            {icon && iconPosition === 'leading' ? <View>{icon}</View> : null}
            <AppText
              variant={size === 'xs' ? 'micro' : 'bodyStrong'}
              style={[{ color: labelColor }, size === 'xs' && styles.labelXs]}
            >
              {label}
            </AppText>
            {icon && iconPosition === 'trailing' ? <View>{icon}</View> : null}
          </>
        )}
      </AnimatedPressable>
    );
  },
);

Button.displayName = 'Button';
