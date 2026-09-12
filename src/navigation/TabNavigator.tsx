import { Platform } from 'react-native';
import { JsTabNavigator } from './JsTabNavigator';
import { NativeTabNavigator } from './NativeTabNavigator';

/**
 * Picks the tab implementation for a platform.
 *
 * iOS runs on a real UITabBarController, which is where Liquid Glass, the
 * scroll-edge appearance and `tabBarMinimizeBehavior` come from on iOS 26 —
 * handed over by UIKit rather than reproduced in JS.
 *
 * Android stays on the React-drawn bar because a native tab item accepts only
 * an SF Symbol or an image asset, and this app's icons are lucide components.
 * Moving Android across is a matter of adding tab drawables, not of revisiting
 * this decision.
 *
 * Exported as a function so the choice can be asserted directly, rather than
 * having to reload the module under a mocked `Platform`.
 */
export function pickTabNavigator(os: typeof Platform.OS) {
  return os === 'ios' ? NativeTabNavigator : JsTabNavigator;
}

export const TabNavigator = pickTabNavigator(Platform.OS);
