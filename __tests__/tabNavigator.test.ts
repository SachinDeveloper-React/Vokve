/**
 * The tab bar is chosen per platform, and the two implementations are not
 * interchangeable: a native tab item takes an SF Symbol or an image asset,
 * never a React component. Picking the wrong one leaves a tab bar with no
 * icons at all, which nothing else in the suite would catch.
 *
 * The bar this app draws itself is held here too. It is a floating glass
 * capsule — the shape iOS 26 gives a tab bar — and each part of that is one
 * line of style that a tidy-up could undo without anything looking broken.
 *
 * @format
 */

import { JsTabNavigator } from '../src/navigation/JsTabNavigator';
import { NativeTabNavigator } from '../src/navigation/NativeTabNavigator';
import { AccountNavigator } from '../src/navigation/AccountNavigator';
import { MAIN_TABS } from '../src/navigation/tabs';
import { pickTabNavigator, TabNavigator } from '../src/navigation/TabNavigator';
import {
  floatingTabBarStyles,
  glassOf,
} from '../src/components/navigation/FloatingTabBar';
import { radius, typography } from '../src/theme';

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

/** The alpha of an `rgba(...)` colour, or 1 for anything opaque. */
const alphaOf = (color: string): number => {
  const match = color.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/);
  return match ? Number(match[1]) : 1;
};

describe('the bar the app draws itself', () => {
  test('it floats: laid over the page, inset, fully rounded and lifted', () => {
    // A flush bar is a hairline and nothing else. This one is a capsule
    // lying on the page, and all four of these are what say so. The
    // position is the load-bearing one: in the layout flow instead, the
    // page would stop above the bar and never show through the glass.
    expect(floatingTabBarStyles.wrap.position).toBe('absolute');
    expect(floatingTabBarStyles.wrap.paddingHorizontal).toBeGreaterThan(0);
    expect(floatingTabBarStyles.pill.borderRadius).toBe(radius.pill);
    const { elevation, shadowOpacity } = floatingTabBarStyles.pill as {
      elevation?: number;
      shadowOpacity?: number;
    };
    expect(elevation ?? shadowOpacity ?? 0).toBeGreaterThan(0);
  });

  test('the glass is translucent in both themes, under a highlight', () => {
    // The whole trick: the page tints the bar. An opaque fill would leave
    // something that still looked deliberate and was no longer glass.
    const card = 'rgb(10, 20, 30)';
    for (const isDark of [false, true]) {
      const glass = glassOf(card, isDark);
      for (const stop of glass.gradient) {
        expect(alphaOf(stop)).toBeLessThan(1);
      }
      // A specular highlight across the top, the card's own colour below it.
      expect(glass.gradient[0]).toMatch(/^rgba\(255, 255, 255/);
      expect(glass.gradient[1]).toContain('10, 20, 30');
      expect(glass.gradient[2]).toContain('10, 20, 30');
      expect(alphaOf(glass.rim)).toBeGreaterThan(0);
    }
  });

  test('the label is a caption, not an upper-cased Material chip', () => {
    // `typography.label` is 11pt, upper-cased and letter-spaced, which is
    // Material's tab label to the letter. UIKit's is 10pt and sentence case.
    expect(floatingTabBarStyles.label.textTransform).toBe('none');
    expect(floatingTabBarStyles.label.fontSize).toBeLessThan(
      typography.label.fontSize,
    );
    expect(floatingTabBarStyles.label.letterSpacing ?? 0).toBeLessThan(
      typography.label.letterSpacing ?? 0,
    );
  });
});
