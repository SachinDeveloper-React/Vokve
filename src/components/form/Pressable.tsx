import React, { memo, useCallback, useMemo } from 'react';
import {
  Pressable as RNPressable,
  PressableProps as RNPressableProps,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { duration, HIT_SLOP_MIN, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';

type Feedback = 'opacity' | 'scale' | 'highlight' | 'none';

export interface PressableProps extends Omit<RNPressableProps, 'style'> {
  children: React.ReactNode;
  /** How the press is acknowledged. Defaults to a subtle opacity change. */
  feedback?: Feedback;
  style?: StyleProp<ViewStyle>;
  /**
   * Visual size of the target, used to grow `hitSlop` up to the 44pt
   * accessibility floor when the element itself is smaller.
   */
  visualSize?: number;
}

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

/** Pressed-state depths, matched to the feedback each one drives. */
const PRESSED_OPACITY = 0.6;
const PRESSED_SCALE = 0.96;

/**
 * The app's pressable primitive.
 *
 * Two things it does that a bare `Pressable` does not: it guarantees a 44pt
 * touch target by padding out `hitSlop` for small controls, and it runs every
 * flavour of press feedback through Reanimated on the UI thread, so a press
 * still feels immediate while JS is busy.
 *
 * The style handed down is always an array, never React Native's
 * `({ pressed }) => …` callback form. Reanimated flattens whatever it is given
 * into an array before passing it on, so a callback arrives at `Pressable` as
 * `[fn]` — no longer a function, so it is never invoked, and it silently
 * flattens away to nothing. A control that lost its own layout that way (a
 * checkbox whose row collapsed into a column, say) gives no error to go on, so
 * the pressed state is driven by a shared value here instead.
 */
export const Pressable = memo(
  ({
    children,
    feedback = 'opacity',
    style,
    visualSize,
    disabled,
    onPressIn,
    onPressOut,
    hitSlop,
    ...rest
  }: PressableProps) => {
    const { colors } = useTheme();
    /** 0 at rest, 1 while held down. */
    const progress = useSharedValue(0);

    const resolvedHitSlop = useMemo(() => {
      if (hitSlop !== undefined) return hitSlop;
      if (visualSize === undefined || visualSize >= HIT_SLOP_MIN) {
        return undefined;
      }
      return Math.ceil((HIT_SLOP_MIN - visualSize) / 2);
    }, [hitSlop, visualSize]);

    const handlePressIn = useCallback<NonNullable<RNPressableProps['onPressIn']>>(
      event => {
        progress.value = withTiming(1, { duration: duration.instant });
        onPressIn?.(event);
      },
      [onPressIn, progress],
    );

    const handlePressOut = useCallback<
      NonNullable<RNPressableProps['onPressOut']>
    >(
      event => {
        progress.value = withTiming(0, { duration: duration.fast });
        onPressOut?.(event);
      },
      [onPressOut, progress],
    );

    // Interpolating from a fully transparent copy of the highlight rather than
    // the keyword `transparent`, which is transparent *black* and drags the
    // midpoint of the fade through grey.
    const highlight = colors.muted;
    const highlightRest = useMemo(() => withAlpha(highlight, 0), [highlight]);

    const animatedStyle = useAnimatedStyle(() => {
      switch (feedback) {
        case 'opacity':
          return { opacity: 1 - progress.value * (1 - PRESSED_OPACITY) };
        case 'scale':
          return {
            transform: [{ scale: 1 - progress.value * (1 - PRESSED_SCALE) }],
          };
        case 'highlight':
          return {
            backgroundColor: interpolateColor(
              progress.value,
              [0, 1],
              [highlightRest, highlight],
            ),
          };
        default:
          return {};
      }
    }, [feedback, highlight, highlightRest]);

    return (
      <AnimatedPressable
        disabled={disabled}
        hitSlop={resolvedHitSlop}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityState={{ disabled: Boolean(disabled) }}
        // Last wins, and the dimming of a disabled control has to survive the
        // `opacity: 1` that the resting animated style would otherwise apply.
        style={[style, animatedStyle, disabled === true && styles.disabled]}
        {...rest}
      >
        {children}
      </AnimatedPressable>
    );
  },
);

Pressable.displayName = 'Pressable';

const styles = StyleSheet.create({
  disabled: { opacity: 0.45 },
});
