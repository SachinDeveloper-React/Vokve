import React from 'react';
import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import {
  createBottomTabNavigator,
  type BottomTabBarButtonProps,
} from '@react-navigation/bottom-tabs';
import { useTheme } from '../theme';
import { moderateScale } from '../theme/responsive';
import { Icon } from '../components/media/Icon';
import type { MainTabParamList } from '../types/navigation';
import { MAIN_TABS } from './tabs';

const Tab = createBottomTabNavigator<MainTabParamList>();

/** 25pt is the size UIKit draws a tab item's glyph at. */
const ICON_SIZE = moderateScale(25);

/** How far the item dims while a finger is on it. UIKit's own feel. */
const PRESS_OPACITY = 0.4;

/**
 * Icon components are built once at module scope, not inside the navigator. A
 * component created during render is a new type on every pass, so React
 * unmounts and remounts the whole tab bar each time instead of updating it —
 * which is exactly what mapping `MAIN_TABS` inline would do.
 */
const TAB_ICONS: Record<
  string,
  (props: { color: string }) => React.ReactElement
> = Object.fromEntries(
  MAIN_TABS.map(tab => [
    tab.name,
    ({ color }: { color: string }) => (
      <Icon as={tab.icon} size={ICON_SIZE} tint={color} />
    ),
  ]),
);

/**
 * One tab item, pressed the way iOS presses one.
 *
 * The library's own button is a `PlatformPressable`, and on any Android above
 * Lollipop that means a **ripple**: a circle of ink spreading out of the
 * finger, which is the single loudest thing marking this bar as Android. Its
 * `pressOpacity` cannot be reached on that platform either — the animation is
 * skipped outright wherever a ripple is available.
 *
 * So the button is replaced rather than configured: a plain `Pressable` with
 * no ripple config at all — RN draws one only when it is given one — dimming
 * the whole item, glyph and label together, while the finger is down and
 * coming back over the lift. That is what a UITabBar does, and it is the
 * difference a user actually feels.
 */
export const TabBarButton = ({
  children,
  style,
  onPress,
  // The tab item asks for a borderless ripple; dropping it here is what
  // leaves the `Pressable` with none to draw.
  android_ripple: _ripple,
  // `PlatformPressable`'s own props. Harmless on a `Pressable` at runtime and
  // not part of its type, so they are dropped here rather than spread into it.
  pressColor: _pressColor,
  pressOpacity: _pressOpacity,
  hoverEffect: _hoverEffect,
  href: _href,
  ...rest
}: BottomTabBarButtonProps) => (
  <Pressable
    {...rest}
    // The navigator types this for the web's `MouseEvent` as well, which a
    // native `Pressable` never raises.
    onPress={onPress as PressableProps['onPress']}
    style={({ pressed }) => [style, pressed && { opacity: PRESS_OPACITY }]}
  >
    {children}
  </Pressable>
);

/**
 * The React-drawn tab bar, used on Android — and drawn to feel like the one
 * UIKit gives iOS.
 *
 * Kept as a React bar because a native tab item can only take an SF Symbol or
 * an image asset, and this app's icons are lucide components. What it can do
 * is look and behave like the native one, which is four specific things and
 * not a vague resemblance:
 *
 *  - **no ripple** — the item dims instead (`TabBarButton`);
 *  - **no shadow.** The library lifts the bar with `elevation: 8`, which is a
 *    Material surface floating over the page. iOS has one hairline and no
 *    shadow at all, so the elevation is taken off and the hairline left;
 *  - **the label is a caption, not a chip.** The app's `label` style is 11pt,
 *    upper-cased and letter-spaced — Material's tab label to the letter.
 *    UIKit's is 10pt, sentence case and tight, which is what is written here;
 *  - **25pt glyphs**, UIKit's own size, over the 22 a Material bar uses.
 *
 * The geometry underneath is already right: `tabBarVariant: 'uikit'` is the
 * library's default and lays each item out at 49pt in a column, icon over
 * label — iOS's own metrics. It is named here so a change of default cannot
 * quietly turn this into a Material bar.
 *
 * What is **not** reproduced is iOS 26's Liquid Glass and the minimize-on-
 * scroll pill. Both are UIKit behaviours the native navigator gets for free
 * (`NativeTabNavigator`); imitating them in JS would mean a translucency
 * library and a scroll-linked animation per screen, re-imitated every
 * release, for a bar that is already the right shape.
 */
export const JsTabNavigator = () => {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        // iOS's geometry, stated rather than inherited (see above).
        tabBarVariant: 'uikit',
        tabBarButton: TabBarButton,
        tabBarStyle: [
          tabBarStyles.bar,
          { backgroundColor: colors.card, borderTopColor: colors.border },
        ],
        tabBarLabelStyle: tabBarStyles.label,
        tabBarItemStyle: tabBarStyles.item,
        // Inactive tabs stop re-rendering while they are off screen, so a
        // background tab cannot cost frames on the one the user is looking at.
        freezeOnBlur: true,
      }}
    >
      {MAIN_TABS.map(tab => (
        <Tab.Screen
          key={tab.name}
          name={tab.name}
          component={tab.component}
          options={{ title: tab.title, tabBarIcon: TAB_ICONS[tab.name] }}
        />
      ))}
    </Tab.Navigator>
  );
};

/** The bar's look, exported so the suite can hold it to the four points above. */
export const tabBarStyles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    // A UITabBar is a hairline and nothing else; the library's own 8 is a
    // Material surface lifted off the page.
    elevation: 0,
    shadowOpacity: 0,
  },
  label: {
    fontSize: moderateScale(10),
    lineHeight: moderateScale(13),
    fontWeight: '600',
    letterSpacing: 0.1,
    // Not `typography.label`: that one upper-cases, which is Material's tab
    // label and the loudest thing left after the ripple.
    textTransform: 'none',
  },
  item: {
    paddingTop: moderateScale(6),
    paddingBottom: moderateScale(2),
  },
});
