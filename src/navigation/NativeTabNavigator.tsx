import React from 'react';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';
import { useTheme } from '../theme';
import type { MainTabParamList } from '../types/navigation';
import { MAIN_TABS } from './tabs';

const Tab = createNativeBottomTabNavigator<MainTabParamList>();

/**
 * A real UITabBarController rather than a React-drawn bar.
 *
 * That is the point of it: on iOS 26 UIKit gives the bar Liquid Glass, the
 * scroll-edge appearance and the minimize animation for free, and they stay
 * correct as Apple changes them. A JS tab bar can only imitate all of that,
 * and has to be re-imitated every release.
 *
 * The trade-off is icons: a native tab item takes an SF Symbol or an image
 * asset, never a React component, so the lucide icons used elsewhere in the
 * app cannot be reused here. `MAIN_TABS` carries both, which is what keeps
 * this bar and the Android one showing the same four tabs.
 */
export const NativeTabNavigator = () => {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        // iOS 26: the bar shrinks to a pill as the user scrolls down a screen
        // and expands again on the way back up.
        tabBarMinimizeBehavior: 'onScrollDown',
      }}
    >
      {MAIN_TABS.map(tab => (
        <Tab.Screen
          key={tab.name}
          name={tab.name}
          component={tab.component}
          options={{
            title: tab.title,
            // `as const` is load-bearing: without it the literal widens to
            // `string` and no longer matches the SF Symbol variant of the
            // icon union.
            tabBarIcon: { type: 'sfSymbol' as const, name: tab.sfSymbol },
          }}
        />
      ))}
    </Tab.Navigator>
  );
};
