import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { formatGrouped } from '../../utils/format';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import {
  formatStopLabel,
  fractionOfGoal,
  goalAtFraction,
  goalStops,
  snapGoal,
  type GoalRange,
} from './goalScale';

const THUMB = moderateScale(22);
const TRACK = moderateScale(6);
/** How far a finger moves before a touch counts as a drag rather than a tap. */
const DRAG_SLOP = 4;
/** A screen reader's swipe up and down, a step each. */
const ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];

interface Props {
  value: number;
  range: GoalRange;
  onChange: (value: number) => void;
}

/**
 * The goal along a track, with the design's marks under it — 3K to 20K,
 * evenly spaced, so the low end where most goals sit gets the room
 * (`goalStops`). Every value lands on the increment.
 *
 * Drawn and dragged here rather than with the platform slider: the design's
 * thumb is a ring, its scale is not linear, and its marks belong to it.
 * A touch that becomes a scroll changes nothing — the value moves on a drag
 * or on a tap's release, never on the touch-down, so a page scrolled from
 * the slider does not set a goal on the way.
 */
export const StepGoalSlider = memo(({ value, range, onChange }: Props) => {
  const { colors } = useTheme();
  const stops = useMemo(() => goalStops(range), [range]);
  const [width, setWidth] = useState(0);
  const fraction = fractionOfGoal(value, stops);

  // The pan handlers are made once; what they read changes, so through a ref.
  const latest = useRef({ width, stops, range, onChange });
  latest.current = { width, stops, range, onChange };
  const touch = useRef({ x: 0, dragging: false });

  const pan = useMemo(() => {
    const emitAt = (x: number) => {
      const current = latest.current;
      if (current.width <= 0) return;
      current.onChange(
        snapGoal(
          goalAtFraction(x / current.width, current.stops),
          current.range,
        ),
      );
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Once dragging, the drag is the slider's: a finger that strays a
      // little up or down must not hand it to the page.
      onPanResponderTerminationRequest: () => !touch.current.dragging,
      onPanResponderGrant: event => {
        // The touch's place on the track: the view is its own target
        // (`box-only`), and the track starts half a thumb in.
        touch.current = {
          x: event.nativeEvent.locationX - THUMB / 2,
          dragging: false,
        };
      },
      onPanResponderMove: (_event, gesture) => {
        if (!touch.current.dragging && Math.abs(gesture.dx) < DRAG_SLOP) {
          return;
        }
        touch.current.dragging = true;
        emitAt(touch.current.x + gesture.dx);
      },
      onPanResponderRelease: (_event, gesture) => {
        emitAt(touch.current.x + gesture.dx);
      },
    });
  }, []);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) =>
      setWidth(Math.max(0, event.nativeEvent.layout.width - THUMB)),
    [],
  );

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const delta =
        event.nativeEvent.actionName === 'increment'
          ? range.increment
          : event.nativeEvent.actionName === 'decrement'
          ? -range.increment
          : 0;
      if (delta !== 0) onChange(snapGoal(value + delta, range));
    },
    [onChange, range, value],
  );

  return (
    <View
      {...pan.panHandlers}
      pointerEvents="box-only"
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Daily step goal"
      accessibilityValue={{
        min: range.min,
        max: range.max,
        now: value,
        text: `${formatGrouped(value)} steps`,
      }}
      accessibilityActions={ACTIONS}
      onAccessibilityAction={onAccessibilityAction}
      style={styles.area}
    >
      <View style={styles.rail}>
        <View
          style={[styles.track, { backgroundColor: colors.switchBackground }]}
        >
          <View
            style={[
              styles.fill,
              {
                width: `${fraction * 100}%`,
                backgroundColor: colors.brandAccent,
              },
            ]}
          />
        </View>
        <View
          style={[
            styles.thumb,
            {
              left: fraction * width,
              borderColor: colors.brandAccent,
              backgroundColor: colors.primaryForeground,
            },
          ]}
        />
      </View>

      <HStack justify="between">
        {stops.map(stop => (
          <AppText key={stop} variant="micro" color="textSecondary">
            {formatStopLabel(stop)}
          </AppText>
        ))}
      </HStack>
    </View>
  );
});

StepGoalSlider.displayName = 'StepGoalSlider';

const styles = StyleSheet.create({
  // Room above and below the track, so a finger need not land on its six points.
  area: { paddingVertical: spacing.sm, gap: spacing.sm },
  rail: {
    height: THUMB,
    paddingHorizontal: THUMB / 2,
    justifyContent: 'center',
  },
  track: { height: TRACK, borderRadius: TRACK / 2, overflow: 'hidden' },
  fill: { height: TRACK, borderRadius: TRACK / 2 },
  thumb: {
    position: 'absolute',
    top: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: moderateScale(6),
  },
});
