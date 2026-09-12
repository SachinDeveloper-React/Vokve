import React from 'react';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTheme, typography } from '../theme';
import { Icon } from '../components/media/Icon';
import type { MainTabParamList } from '../types/navigation';
import { MAIN_TABS } from './tabs';

const Tab = createBottomTabNavigator<MainTabParamList>();

const ICON_SIZE = 22;

/**
 * Icon components are built once at module scope, not inside the navigator. A
 * component created during render is a new type on every pass, so React
 * unmounts and remounts the whole tab bar each time instead of updating it —
 * which is exactly what mapping `MAIN_TABS` inline would do.
 */
const TAB_ICONS: Record<string, (props: { color: string }) => React.ReactElement> =
  Object.fromEntries(
    MAIN_TABS.map(tab => [
      tab.name,
      ({ color }: { color: string }) => (
        <Icon as={tab.icon} size={ICON_SIZE} tint={color} />
      ),
    ]),
  );

/**
 * The React-drawn tab bar, used on Android.
 *
 * Kept because a native tab item can only take an SF Symbol or an image asset.
 * Moving Android onto the native navigator would mean shipping a drawable for
 * every tab; until those exist, the lucide icons here are the better result.
 */
export const JsTabNavigator = () => {
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: [
          styles.bar,
          { backgroundColor: colors.card, borderTopColor: colors.border },
        ],
        tabBarLabelStyle: typography.label,
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

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
});
