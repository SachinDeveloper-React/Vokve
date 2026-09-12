import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { radius, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';

interface Props {
  /** 0-1. Values above 1 are clamped so an exceeded goal still reads as full. */
  progress: number;
  /** Track thickness. Kept slim by default — this is a supporting figure. */
  height?: number;
  tint?: string;
}

/**
 * A slim linear meter.
 *
 * Used where a ring would be too loud: a screen holds one ring at most, and a
 * second one competes with it for the same "this is the headline" role.
 */
export const ProgressBar = memo(
  ({ progress, height = moderateScale(6), tint }: Props) => {
    const { colors } = useTheme();
    const value = useSharedValue(0);

    useEffect(() => {
      value.value = withTiming(Math.min(Math.max(progress, 0), 1), {
        duration: 600,
        easing: Easing.out(Easing.cubic),
      });
    }, [progress, value]);

    const fillStyle = useAnimatedStyle(() => ({
      width: `${value.value * 100}%`,
    }));

    return (
      <View
        style={[
          styles.track,
          { height, borderRadius: height / 2, backgroundColor: colors.muted },
        ]}
      >
        <Animated.View
          style={[
            styles.fill,
            fillStyle,
            { borderRadius: height / 2, backgroundColor: tint ?? colors.primary },
          ]}
        />
      </View>
    );
  },
);

ProgressBar.displayName = 'ProgressBar';

const styles = StyleSheet.create({
  track: { overflow: 'hidden', width: '100%', borderRadius: radius.pill },
  fill: { height: '100%' },
});
