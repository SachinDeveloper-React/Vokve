import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardShown } from '../../hooks/useKeyboardShown';
import { useTabBarOverlay } from '../../navigation/shellTabs';
import type { TabItem } from '../../navigation/tabItems';
import { elevation, radius, spacing, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { MainTabParamList } from '../../types/navigation';
import { withAlpha } from '../../utils/color';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

/**
 * 24pt inside the capsule. UIKit's own 25 is tuned to a flush bar that runs
 * to the screen's edges; a floating pill has its own padding to pay for.
 */
export const TAB_ICON_SIZE = moderateScale(24);

/** How far an item dims while a finger is on it. */
export const TAB_PRESS_OPACITY = 0.5;

/** The capsule's height, before the home-indicator inset below it. */
const PILL_HEIGHT = moderateScale(58);

const white = (alpha: number) => `rgba(255, 255, 255, ${alpha})`;
const black = (alpha: number) => `rgba(0, 0, 0, ${alpha})`;

export interface Glass {
  /**
   * The capsule, top to bottom: a specular highlight, then the body twice.
   *
   * Every stop is translucent, which is the whole trick — the screen behind
   * tints the bar, so it reads as a pane of glass lying on the page rather
   * than a panel bolted to the bottom of it.
   */
  gradient: [string, string, string];
  locations: [number, number, number];
  /** The lit edge. Light on a dark page, a faint shadow line on a light one. */
  rim: string;
}

/**
 * What the capsule is made of, for a theme.
 *
 * Exported with the styles because "is it still translucent" is the only
 * question worth asking of a glass surface, and a tidy-up that made the fill
 * opaque would leave something that still looked deliberate.
 *
 * There is no real backdrop blur here: that needs a native view, and this
 * build ships no blur module. A translucent body under a highlight, inside a
 * lit rim, with a soft shadow under it, is what gives the look without one.
 */
export function glassOf(card: string, isDark: boolean): Glass {
  return isDark
    ? {
        gradient: [white(0.22), withAlpha(card, 0.86), withAlpha(card, 0.78)],
        locations: [0, 0.42, 1],
        rim: white(0.16),
      }
    : {
        gradient: [white(0.95), withAlpha(card, 0.84), withAlpha(card, 0.74)],
        locations: [0, 0.42, 1],
        rim: black(0.06),
      };
}

/**
 * How much room the capsule takes at the bottom of a screen, in points.
 *
 * The bar is laid *over* the content, so anything a screen puts at its own
 * bottom — the last row of a list, a sticky call to action — has to leave
 * this much clear or it sits under the glass for good. `Screen` adds it to
 * the scrollable it is handed; a screen with a bottom bar of its own asks
 * for it here.
 *
 * Zero wherever no capsule lies over the screen: outside the app's shell, on
 * a screen that took the bar off, under UIKit's own bar — which pays for its
 * own room — and while the keyboard is up, since the capsule goes with it.
 */
export function useTabBarSpace(shown = true): number {
  const insets = useSafeAreaInsets();
  const overlaid = useTabBarOverlay();
  const keyboardShown = useKeyboardShown();

  if (!shown || !overlaid || keyboardShown) {
    return 0;
  }
  return PILL_HEIGHT + spacing.sm + Math.max(insets.bottom, spacing.md);
}

interface ItemProps {
  item: TabItem;
  active: boolean;
  onPress: (name: keyof MainTabParamList) => void;
}

/**
 * One item of the capsule.
 *
 * The selected tab sits in a tinted lozenge of its own rather than only
 * changing colour: on a translucent bar the page showing through is whatever
 * the user scrolled to, and a tint alone cannot be relied on to stand out
 * against it.
 */
const FloatingTab = memo(({ item, active, onPress }: ItemProps) => {
  const { colors, isDark } = useTheme();
  const press = useCallback(() => onPress(item.name), [item.name, onPress]);
  const tint = active ? colors.primary : colors.textSecondary;

  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.title}
      style={({ pressed }) => [
        floatingTabBarStyles.item,
        active && {
          backgroundColor: withAlpha(colors.primary, isDark ? 0.26 : 0.12),
        },
        pressed && { opacity: TAB_PRESS_OPACITY },
      ]}
    >
      <Icon as={item.icon} size={TAB_ICON_SIZE} tint={tint} />
      <AppText
        numberOfLines={1}
        style={[floatingTabBarStyles.label, { color: tint }]}
      >
        {item.title}
      </AppText>
    </Pressable>
  );
});

FloatingTab.displayName = 'FloatingTab';

interface Props {
  items: readonly TabItem[];
  /**
   * The tab that is lit. A plain name rather than a key of the tab list,
   * because it is read out of navigation state at both call sites.
   */
  activeName: string;
  onPress: (name: keyof MainTabParamList) => void;
}

/**
 * The app's tab bar: a floating glass capsule.
 *
 * One component for both of the bars this app draws itself — the navigator's
 * own on Android (`JsTabNavigator`) and the one every pushed screen carries
 * (`AppTabBar`) — because they are the same bar to a user, and two of them
 * styled separately is how a screen ends up with a bar that is almost right.
 *
 * It floats rather than sitting flush, which is what iOS 26 does with a tab
 * bar and what UIKit gives the native navigator for free: inset from all
 * three edges, fully rounded, lifted off the page by a shadow, and
 * translucent enough that the page tints it (`glassOf`).
 *
 * It is laid over the content rather than taking a place in the layout, which
 * is what makes the glass worth having: the page scrolls *under* it and tints
 * it on the way past. The room it needs is `useTabBarSpace`, which `Screen`
 * adds to the scrollable it wraps and a screen with a bottom bar of its own
 * asks for. Everything outside the capsule itself lets touches through.
 */
export const FloatingTabBar = memo(({ items, activeName, onPress }: Props) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();

  const glass = glassOf(colors.card, isDark);

  // Out of the keyboard's way: Android resizes the window around the
  // keyboard (`adjustResize`), which would leave the bar sitting on it.
  if (keyboardShown) {
    return null;
  }

  return (
    <View
      // Only the capsule takes touches; the rest of the strip is the page.
      pointerEvents="box-none"
      style={[
        floatingTabBarStyles.wrap,
        // The bar owns the bottom edge, so it pays for the home indicator
        // itself — and keeps a margin of its own where there is none.
        { paddingBottom: Math.max(insets.bottom, spacing.md) },
      ]}
    >
      <LinearGradient
        colors={glass.gradient}
        locations={glass.locations}
        style={[floatingTabBarStyles.pill, { borderColor: glass.rim }]}
      >
        {items.map(item => (
          <FloatingTab
            key={item.name}
            item={item}
            active={item.name === activeName}
            onPress={onPress}
          />
        ))}
      </LinearGradient>
    </View>
  );
});

FloatingTabBar.displayName = 'FloatingTabBar';

/** The bar's look, exported so the suite can hold it to the lines above. */
export const floatingTabBarStyles = StyleSheet.create({
  wrap: {
    // Over the content, across the foot of the screen.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: PILL_HEIGHT,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xs,
    // It floats, so it casts a shadow — the one thing a flush bar must not.
    ...elevation.medium,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: moderateScale(2),
    marginVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  label: {
    fontSize: moderateScale(10),
    lineHeight: moderateScale(13),
    fontWeight: '600',
    letterSpacing: 0.1,
    // Not `typography.label`: that one upper-cases, which is Material's tab
    // label rather than the caption UIKit puts under a glyph.
    textTransform: 'none',
  },
});
