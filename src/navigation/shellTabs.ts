import { createContext, useContext } from 'react';

/**
 * Whether the screen being drawn is one of the signed-in app's.
 *
 * Provided by `RootNavigator` around the stack it mounts once a member is
 * through sign-in, the profile and the permission screens — so auth,
 * onboarding and the system screens (no session, retired build) are outside
 * it and carry no tab bar.
 */
export const InAppShellContext = createContext(false);

/**
 * What kind of tab bar, if any, is already drawn under this screen.
 *
 * - `none` — nothing: a screen pushed on the root stack, which draws the bar
 *   itself (`components/navigation/AppTabBar`).
 * - `overlay` — the app's own floating capsule, from the React navigator
 *   (`JsTabNavigator`). It lies *over* the screen and reserves no room, so
 *   the screen still has to leave some.
 * - `platform` — UIKit's own bar, from the native navigator
 *   (`NativeTabNavigator`). It is laid out by the platform, which takes the
 *   room out of the screen before the screen ever sees it.
 *
 * The three are kept apart because "is there a bar" and "has the room
 * already been paid for" are different questions, and answering them with
 * one boolean is what left the tab screens' content under the capsule.
 */
export type TabBarBelow = 'none' | 'overlay' | 'platform';

export const TabBarBelowContext = createContext<TabBarBelow>('none');

/**
 * Whether this screen draws the app's tab bar itself.
 *
 * The app's screens live on the root stack rather than inside a tab's own
 * stack, so that tapping a tab always opens that tab's own screen instead of
 * whatever was last pushed from it. The cost of that is a stack screen
 * covering the real tab bar, which is why every screen in the shell draws one
 * of its own — except the ones that already have a bar beneath them.
 *
 * Both contexts are read before either is used: a `&&` would skip the second
 * `useContext` whenever the first was false, which is a hook the next render
 * does not call.
 */
export function useShellTabBar(): boolean {
  const inShell = useContext(InAppShellContext);
  const below = useContext(TabBarBelowContext);
  return inShell && below === 'none';
}

/**
 * Whether a floating bar lies over this screen — its own or the navigator's.
 *
 * This is the question a screen's *layout* has to ask. A capsule laid over
 * the page reserves nothing, so anything the screen puts at its own bottom
 * has to leave room for it (`useTabBarSpace`). Only the platform's bar is
 * exempt, because UIKit has already taken its room out of the screen.
 */
export function useTabBarOverlay(): boolean {
  const inShell = useContext(InAppShellContext);
  const below = useContext(TabBarBelowContext);
  return inShell && below !== 'platform';
}
