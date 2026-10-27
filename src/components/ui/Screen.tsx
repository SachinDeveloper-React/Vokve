import React, { memo, useMemo } from 'react';
import {
  StatusBar,
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import { useResponsive } from '../../hooks/useResponsive';
import { useShellTabBar } from '../../navigation/shellTabs';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { AppTabBar } from '../navigation/AppTabBar';
import { useTabBarSpace } from '../navigation/FloatingTabBar';

/** What a scrollable child is recognised by, and what gets added to it. */
interface Scrollable {
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * The same children, with room at the foot of any scrollable among them for
 * the tab bar lying over it.
 *
 * The bar is an overlay, so a list that ran to the bottom of the screen would
 * keep its last row under the glass for good. Rather than ask sixty screens
 * to know the bar's height, the one component that wraps all of them adds it
 * to whatever it was handed that takes a `contentContainerStyle` — every
 * scroll view, flat list and flash list does, and that is what the padding
 * belongs on: the content keeps scrolling the whole height of the screen, and
 * only where it *ends* moves up.
 *
 * A screen's own bottom bar is not a scrollable and is not touched here; it
 * asks for the room itself with `useTabBarSpace`.
 *
 * Whether anything was found is reported back, because a screen whose
 * scrollable is wrapped in something — or that does not scroll at all — must
 * not be left with its foot under the glass. `Screen` falls back to padding
 * the whole content box there: that screen loses the page-under-glass look
 * and keeps all of its content, which is the right way round.
 */
function withTabBarSpace(
  children: React.ReactNode,
  space: number,
): { children: React.ReactNode; padded: boolean } {
  let padded = false;
  // Mapped even when there is no room to add. `React.Children.map` rewrites
  // its children's keys, so a screen that went from mapped to untouched —
  // which is what opening the keyboard does — would hand React a new set of
  // keys and have the whole list torn down and rebuilt under the user.
  const mapped = React.Children.map(children, child => {
    if (!React.isValidElement<Scrollable>(child)) {
      return child;
    }
    const given = child.props.contentContainerStyle;
    if (given === undefined) {
      return child;
    }
    const flat = StyleSheet.flatten(given) ?? {};
    const held =
      typeof flat.paddingBottom === 'number' ? flat.paddingBottom : 0;
    padded = true;
    return React.cloneElement(child, {
      contentContainerStyle: [given, { paddingBottom: held + space }],
    });
  });
  return { children: mapped, padded };
}

interface Props extends ViewProps {
  children: React.ReactNode;
  edges?: readonly Edge[];
  padded?: boolean;
  constrained?: boolean;
  /**
   * Takes the shell's tab bar off this screen.
   *
   * For the few screens that are a task in progress rather than a place in
   * the app — a workout being logged, a payment being taken. A tab press
   * leaves by throwing the task away, and there is no way back into it, so
   * these screens ask to be finished or cancelled first. Everything else
   * keeps the bar.
   */
  tabBar?: boolean;
}

const MAX_CONTENT_WIDTH = 640;

const makeStyles = ({ colors, spacing }: ThemeShape) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, width: '100%' },
    padded: { paddingHorizontal: spacing.base },
    centered: { alignSelf: 'center', maxWidth: MAX_CONTENT_WIDTH },
  });
export const Screen = memo(
  ({
    children,
    edges = ['top'],
    padded = true,
    constrained = true,
    tabBar = true,
    style,
    ...rest
  }: Props) => {
    const styles = useThemedStyles(makeStyles);
    const { isDark } = useTheme();
    const { width } = useResponsive();
    // Every screen of the signed-in app carries the tab bar, because the
    // screens are root-stack routes sitting over the real one. The tabs' own
    // landing screens are the exception: they have a bar under them already
    // — but it is laid over them just the same, so they still leave room for
    // it (`navigation/shellTabs`).
    const inShell = useShellTabBar();
    const showTabBar = inShell && tabBar;
    const tabBarSpace = useTabBarSpace(tabBar);
    const spaced = withTabBarSpace(children, tabBarSpace);

    const shouldConstrain = constrained && width > MAX_CONTENT_WIDTH;

    // The bar lies over the content and pays for the home-indicator inset
    // itself, so a screen that asked for the bottom edge would be reserving
    // the same strip twice — and reserving it is what stops the page showing
    // through the glass.
    const safeEdges = useMemo(
      () => (showTabBar ? edges.filter(edge => edge !== 'bottom') : edges),
      [edges, showTabBar],
    );

    return (
      <SafeAreaView style={styles.safeArea} edges={safeEdges}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <View
          style={[
            styles.content,
            padded && styles.padded,
            shouldConstrain && styles.centered,
            style,
            // Nothing scrollable to hang the bar's room on: the whole box
            // stops above it instead.
            !spaced.padded && tabBarSpace > 0 && { paddingBottom: tabBarSpace },
          ]}
          {...rest}
        >
          {spaced.children}
        </View>

        {showTabBar ? <AppTabBar /> : null}
      </SafeAreaView>
    );
  },
);

Screen.displayName = 'Screen';
