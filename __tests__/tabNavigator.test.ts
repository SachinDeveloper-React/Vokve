/**
 * The tab bar is chosen per platform, and the two implementations are not
 * interchangeable: a native tab item takes an SF Symbol or an image asset,
 * never a React component. Picking the wrong one leaves a tab bar with no
 * icons at all, which nothing else in the suite would catch.
 *
 * The Android bar's *look* is held here too. It is drawn to feel like the one
 * UIKit gives iOS, and each of those four decisions is one line of style that
 * a tidy-up could undo without anything looking broken.
 *
 * @format
 */

import {
  JsTabNavigator,
  TabBarButton,
  tabBarStyles,
} from '../src/navigation/JsTabNavigator';
import { NativeTabNavigator } from '../src/navigation/NativeTabNavigator';
import { AccountNavigator } from '../src/navigation/AccountNavigator';
import { MAIN_TABS } from '../src/navigation/tabs';
import { pickTabNavigator, TabNavigator } from '../src/navigation/TabNavigator';
import { typography } from '../src/theme';
import type React from 'react';

test('iOS gets the native UITabBarController navigator', () => {
  // This is what brings Liquid Glass and tabBarMinimizeBehavior on iOS 26.
  expect(pickTabNavigator('ios')).toBe(NativeTabNavigator);
});

test('Android gets the React-drawn navigator', () => {
  // Android has no SF Symbols and the app ships no tab drawables, so the
  // lucide-based bar is the one that actually renders icons there.
  expect(pickTabNavigator('android')).toBe(JsTabNavigator);
});

test('an unrecognised platform falls back to the JS bar', () => {
  // The native bar exists only on iOS; anything else must not reach for it.
  expect(pickTabNavigator('web')).toBe(JsTabNavigator);
});

test('the exported navigator matches the running platform', () => {
  // Jest reports ios, so this is the native one — and the App smoke test
  // therefore exercises the native path rather than the fallback.
  expect(TabNavigator).toBe(NativeTabNavigator);
});

test('the app ships exactly the four tabs, in order', () => {
  // Both bars map over this list, so it is the single place a tab can be
  // added, removed or reordered — and the only place to assert it.
  expect(MAIN_TABS.map(tab => tab.name)).toEqual([
    'Home',
    'Wallet',
    'Shop',
    'Account',
  ]);
});

test('the Account tab mounts its own stack, not a bare screen', () => {
  // The streak screen lives under Account; a tab that pointed straight at
  // AccountScreen would leave it unreachable with the tab bar showing.
  expect(MAIN_TABS.find(tab => tab.name === 'Account')?.component).toBe(
    AccountNavigator,
  );
});

test('every tab carries an icon for both bars', () => {
  // A tab missing one of the two renders as a blank slot on that platform
  // and nothing else in the suite would notice.
  for (const tab of MAIN_TABS) {
    // An object rather than a function: lucide ships each icon as a
    // `forwardRef` component.
    expect(tab.icon).toBeTruthy();
    expect(tab.sfSymbol).toMatch(/^[a-z0-9.]+$/);
    expect(tab.title.length).toBeGreaterThan(0);
  }
});

describe('the Android bar feels like iOS', () => {
  test('a tab item dims instead of rippling', () => {
    // The library's own button is a `PlatformPressable`, which on Android
    // always draws a ripple and skips its own opacity animation — the single
    // loudest thing marking the bar as Android.
    const element = TabBarButton({
      children: null,
      style: { flex: 1 },
      android_ripple: { borderless: true },
    } as never) as React.ReactElement<{
      android_ripple?: unknown;
      style: (state: { pressed: boolean }) => unknown[];
    }>;

    expect(element.props.android_ripple).toBeUndefined();
    expect(element.props.style({ pressed: false })).toEqual([
      { flex: 1 },
      false,
    ]);
    const [, pressed] = element.props.style({ pressed: true });
    expect(pressed).toMatchObject({ opacity: expect.any(Number) });
  });

  test('the bar is a hairline, not a lifted Material surface', () => {
    // The library sets `elevation: 8` on Android; a UITabBar has one hairline
    // and no shadow.
    expect(tabBarStyles.bar).toMatchObject({ elevation: 0, shadowOpacity: 0 });
    expect(tabBarStyles.bar.borderTopWidth).toBeGreaterThan(0);
  });

  test('the label is a caption, not an upper-cased Material chip', () => {
    // `typography.label` is 11pt, upper-cased and letter-spaced, which is
    // Material's tab label to the letter. UIKit's is 10pt and sentence case.
    expect(tabBarStyles.label.textTransform).toBe('none');
    expect(tabBarStyles.label.fontSize).toBeLessThan(typography.label.fontSize);
    expect(tabBarStyles.label.letterSpacing ?? 0).toBeLessThan(
      typography.label.letterSpacing ?? 0,
    );
  });
});
