import React, {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import {
  BackHandler,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Pressable,
  ScrollView,
  ScrollViewProps,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { duration as durations, radius, spacing, useTheme } from '../../theme';
import { AppText } from '../ui/AppText';

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Blocks backdrop taps and the drag-to-dismiss gesture. */
  dismissible?: boolean;
}

/** Drag further than this and releasing closes the sheet. */
const DISMISS_THRESHOLD = 90;

/**
 * How a scrollable child tells the sheet whether a downward drag is its own.
 *
 * The sheet's pan gesture and a list inside it both want the same swipe, and
 * the sheet sits above the list in the tree, so without this it takes every
 * downward drag and the list can never be scrolled back up. A list that still
 * has content above it says so, and the sheet stays out of the way.
 */
interface ScrollSync {
  reportAtTop: (atTop: boolean) => void;
}

const ScrollSyncContext = createContext<ScrollSync | null>(null);

/** The smallest downward movement read as a drag rather than a stray touch. */
const DRAG_SLOP = 4;

/**
 * Whether the sheet should take a swipe, or leave it to whatever is under it.
 *
 * Pulled out of the pan responder because it is the whole of the arbitration
 * between the sheet and a list inside it, and every clause earns its place:
 * downward only, mostly vertical, and — the one that is easy to leave out —
 * only when no scrollable child still has room to scroll up.
 */
export function shouldSheetTakeDrag({
  dismissible,
  atTop,
  dx,
  dy,
}: {
  dismissible: boolean;
  atTop: boolean;
  dx: number;
  dy: number;
}): boolean {
  return dismissible && atTop && dy > DRAG_SLOP && Math.abs(dy) > Math.abs(dx);
}

/**
 * A modal sheet anchored to the bottom of the screen.
 *
 * Built on React Native's own Modal and PanResponder rather than a gesture
 * library, so it adds no native dependency to the project. The drag therefore
 * runs through JS: fine for a single sheet gesture, but it is the reason the
 * open and close animations are driven by Reanimated on the UI thread instead.
 */
export const BottomSheet = memo(
  ({ visible, onClose, title, children, dismissible = true }: Props) => {
    const { colors } = useTheme();
    const insets = useSafeAreaInsets();
    const { height: screenHeight } = useWindowDimensions();

    const translateY = useSharedValue(screenHeight);
    const backdropOpacity = useSharedValue(0);
    const dragStart = useRef(0);

    /**
     * Whether a downward drag belongs to the sheet rather than to a list
     * inside it. A ref, not state: it is read during gesture negotiation and
     * written on every scroll frame, and re-rendering the sheet mid-swipe to
     * record it would cost more than the gesture is worth.
     */
    const dragOwnsGesture = useRef(true);

    const scrollSync = useMemo<ScrollSync>(
      () => ({
        reportAtTop: atTop => {
          dragOwnsGesture.current = atTop;
        },
      }),
      [],
    );

    /**
     * Fires before any child's own touch handler, so a list further down can
     * still correct it. Anywhere else on the sheet — the handle, the title —
     * the optimistic answer is the right one.
     */
    const claimGesture = useCallback(() => {
      dragOwnsGesture.current = true;
    }, []);

    useEffect(() => {
      if (visible) {
        // A sheet reopened after being closed mid-scroll starts draggable
        // again; the list inside it starts back at the top too.
        dragOwnsGesture.current = true;
      }
      translateY.value = withTiming(visible ? 0 : screenHeight, {
        duration: visible ? durations.normal : durations.fast,
      });
      backdropOpacity.value = withTiming(visible ? 1 : 0, {
        duration: durations.fast,
      });
    }, [visible, screenHeight, translateY, backdropOpacity]);

    // Android's hardware back should close the sheet, not the screen behind it.
    useEffect(() => {
      if (!visible || !dismissible) {
        return;
      }
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          onClose();
          return true;
        },
      );
      return () => subscription.remove();
    }, [visible, dismissible, onClose]);

    const panResponder = useMemo(
      () =>
        PanResponder.create({
          onMoveShouldSetPanResponder: (_evt, gesture) =>
            shouldSheetTakeDrag({
              dismissible,
              atTop: dragOwnsGesture.current,
              dx: gesture.dx,
              dy: gesture.dy,
            }),
          onPanResponderGrant: () => {
            dragStart.current = translateY.value;
          },
          onPanResponderMove: (_evt, gesture) => {
            // Downward only: dragging up must not lift the sheet off its edge.
            translateY.value = Math.max(0, dragStart.current + gesture.dy);
          },
          onPanResponderRelease: (_evt, gesture) => {
            if (gesture.dy > DISMISS_THRESHOLD || gesture.vy > 0.8) {
              onClose();
            } else {
              translateY.value = withTiming(0, { duration: durations.fast });
            }
          },
        }),
      [dismissible, onClose, translateY],
    );

    const sheetStyle = useAnimatedStyle(() => ({
      transform: [{ translateY: translateY.value }],
    }));

    const backdropStyle = useAnimatedStyle(() => ({
      opacity: backdropOpacity.value,
    }));

    const handleBackdropPress = useCallback(() => {
      if (dismissible) {
        onClose();
      }
    }, [dismissible, onClose]);

    return (
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <View style={styles.root}>
          <Animated.View style={[styles.backdropFill, backdropStyle]}>
            <Pressable
              style={styles.backdropFill}
              onPress={handleBackdropPress}
              accessibilityRole="button"
              accessibilityLabel="Close"
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.sheet,
              sheetStyle,
              {
                backgroundColor: colors.popover,
                borderColor: colors.border,
                paddingBottom: insets.bottom + spacing.base,
                maxHeight: screenHeight * 0.9,
              },
            ]}
            onTouchStartCapture={claimGesture}
            {...panResponder.panHandlers}
          >
            {dismissible ? (
              <View
                style={[styles.handle, { backgroundColor: colors.switchBackground }]}
              />
            ) : null}

            {title ? (
              <AppText variant="h3" style={styles.title}>
                {title}
              </AppText>
            ) : null}

            <ScrollSyncContext.Provider value={scrollSync}>
              {children}
            </ScrollSyncContext.Provider>
          </Animated.View>
        </View>
      </Modal>
    );
  },
);

BottomSheet.displayName = 'BottomSheet';

/**
 * The scroll view to use for a list inside a `BottomSheet`.
 *
 * A plain `ScrollView` here loses the fight for a downward swipe: the sheet's
 * pan responder sits above it in the tree and claims the gesture first, so the
 * list scrolls down but never back up — the sheet just starts to close. This
 * reports where the list actually is, and the sheet only takes the drag once
 * there is nothing left to scroll.
 *
 * Outside a sheet it is an ordinary `ScrollView`, so it is safe in a component
 * that renders in both places.
 */
export const BottomSheetScrollView = forwardRef<
  React.ComponentRef<typeof ScrollView>,
  ScrollViewProps
>(({ onScroll, onTouchStart, ...rest }, ref) => {
  const sync = useContext(ScrollSyncContext);
  // iOS bounces past the top edge, which reads as a negative offset.
  const offset = useRef(0);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = event.nativeEvent.contentOffset.y;
      sync?.reportAtTop(offset.current <= 0);
      onScroll?.(event);
    },
    [onScroll, sync],
  );

  const handleTouchStart = useCallback(
    (event: Parameters<NonNullable<ScrollViewProps['onTouchStart']>>[0]) => {
      // Runs after the sheet's capture handler has optimistically claimed the
      // gesture, which is what lets this list take it back. Reporting on touch
      // rather than only on scroll is what keeps sibling lists independent —
      // the date picker's three columns each answer for themselves.
      sync?.reportAtTop(offset.current <= 0);
      onTouchStart?.(event);
    },
    [onTouchStart, sync],
  );

  return (
    <ScrollView
      ref={ref}
      scrollEventThrottle={16}
      onScroll={handleScroll}
      onTouchStart={handleTouchStart}
      {...rest}
    />
  );
});

BottomSheetScrollView.displayName = 'BottomSheetScrollView';

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: { marginBottom: spacing.md },
});
