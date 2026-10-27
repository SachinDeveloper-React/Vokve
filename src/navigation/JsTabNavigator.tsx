import React, { useCallback } from 'react';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import { FloatingTabBar } from '../components/navigation/FloatingTabBar';
import type { MainTabParamList } from '../types/navigation';
import { TabBarBelowContext } from './shellTabs';
import { TAB_ITEMS } from './tabItems';
import { MAIN_TABS } from './tabs';

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * The navigator's own bar — the app's glass capsule, switching tabs inside
 * the navigator rather than navigating to it.
 *
 * The library's bar is replaced outright rather than configured. What was
 * wanted from it was a flush UITabBar look, and that is no longer the design:
 * a floating pill cannot be reached with `tabBarStyle` without also taking
 * over the item layout, the press feedback and the background — which is the
 * whole of the bar. `FloatingTabBar` is the one the pushed screens draw too
 * (`components/navigation/AppTabBar`), so the four tab screens and the sixty
 * others show the same bar.
 *
 * `tabPress` is still emitted before the move, because that is the event a
 * screen listens for to scroll its list back to the top.
 */
export const NavigatorTabBar = ({ state, navigation }: BottomTabBarProps) => {
  const press = useCallback(
    (name: string) => {
      const route = state.routes.find(entry => entry.name === name);
      if (!route) {
        return;
      }
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!event.defaultPrevented) {
        navigation.navigate(route.name, route.params);
      }
    },
    [navigation, state.routes],
  );

  return (
    <FloatingTabBar
      items={TAB_ITEMS}
      activeName={state.routes[state.index]?.name ?? ''}
      onPress={press}
    />
  );
};

const renderTabBar = (props: BottomTabBarProps) => (
  <NavigatorTabBar {...props} />
);

/**
 * The React-drawn tab bar, used on Android.
 *
 * Kept as a React bar because a native tab item can only take an SF Symbol or
 * an image asset, and this app's icons are lucide components. What it draws is
 * the app's own bar: a floating glass capsule, inset from all three edges and
 * lifted off the page — which is the shape iOS 26 gives a tab bar, and which
 * UIKit hands the native navigator for free (`NativeTabNavigator`).
 *
 * What is **not** reproduced is a real backdrop blur, which needs a native
 * view this build does not ship, and iOS 26's minimize-on-scroll pill. Both
 * are things the native navigator gets from the platform; imitating them in JS
 * would mean a blur module and a scroll-linked animation per screen,
 * re-imitated every release, for a bar that is already the right shape.
 */
export const JsTabNavigator = () => (
  // Everything in here has the app's capsule under it, so no screen of it
  // draws one of its own — and because that capsule is laid *over* the
  // screens, each of them still leaves room for it (`shellTabs`).
  <TabBarBelowContext.Provider value="overlay">
    <Tab.Navigator
      tabBar={renderTabBar}
      screenOptions={{
        headerShown: false,
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
          options={{ title: tab.title }}
        />
      ))}
    </Tab.Navigator>
  </TabBarBelowContext.Provider>
);
