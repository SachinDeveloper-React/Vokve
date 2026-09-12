import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { AppText } from '../ui/AppText';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  /** 0-1. Values above 1 are clamped so an over-achieved goal still reads. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  value?: string;
  /** Replaces the label/value pair when the centre needs richer content. */
  children?: React.ReactNode;
  /** Arc colour. Defaults to the primary accent. */
  tint?: string;
  /** Colour of the unfilled remainder. */
  trackColor?: string;
}

/**
 * The sweep is driven by `useAnimatedProps`, so the stroke updates on the UI
 * thread. A `setState`-driven version re-renders an SVG on every frame from JS
 * and drops frames the moment the app is doing anything else.
 */
export const ProgressRing = memo(
  ({
    progress,
    size = 140,
    strokeWidth = 12,
    label,
    value,
    children,
    tint,
    trackColor,
  }: Props) => {
    const { colors } = useTheme();
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const sweep = useSharedValue(0);

    useEffect(() => {
      sweep.value = withTiming(Math.min(Math.max(progress, 0), 1), {
        duration: 700,
        easing: Easing.out(Easing.cubic),
      });
    }, [progress, sweep]);

    const animatedProps = useAnimatedProps(() => ({
      strokeDashoffset: circumference * (1 - sweep.value),
    }));

    return (
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={trackColor ?? colors.muted}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={tint ?? colors.primary}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            animatedProps={animatedProps}
            // Start the sweep at 12 o'clock instead of 3 o'clock.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View style={styles.center} pointerEvents="none">
          {children ?? (
            <>
              {value ? <AppText variant="metric">{value}</AppText> : null}
              {label ? (
                <AppText variant="label" color="textTertiary">
                  {label}
                </AppText>
              ) : null}
            </>
          )}
        </View>
      </View>
    );
  },
);

ProgressRing.displayName = 'ProgressRing';

const styles = StyleSheet.create({
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
