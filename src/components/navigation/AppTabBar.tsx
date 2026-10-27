import React, { memo, useCallback } from 'react';
import { useNavigation, useNavigationState } from '@react-navigation/native';
import type { NavigationState } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { TAB_ITEMS } from '../../navigation/tabItems';
import type {
  MainTabParamList,
  RootStackParamList,
} from '../../types/navigation';
import { FloatingTabBar } from './FloatingTabBar';

/**
 * The tab the app is on, read from the `Main` route's own state.
 *
 * A pushed screen lights the tab it was opened from, which is where its back
 * chevron goes too. Exported for the suite: the lookup walks two levels of
 * navigation state and is worth checking without a navigator.
 */
export function focusedTabOf(
  state: NavigationState | undefined,
): keyof MainTabParamList {
  const main = state?.routes.find(route => route.name === 'Main');
  const tabs = main?.state;
  const index = tabs?.index;
  const name = index === undefined ? undefined : tabs?.routes[index]?.name;
  return TAB_ITEMS.find(item => item.name === name)?.name ?? TAB_ITEMS[0].name;
}

/**
 * The app's tab bar, drawn by a screen that is sitting over the real one.
 *
 * The app's screens are root-stack routes rather than pages inside a tab's
 * stack, so that every tab leads to its own screen rather than to whatever
 * was last opened from it. A root screen covers the tab bar, though, and a
 * member halfway down the water log should not have to find a back chevron to
 * get to the shop — so each screen carries this bar, and `Screen` draws it
 * wherever the shell says to (`navigation/shellTabs`).
 *
 * It is a bar that navigates and nothing else — the glass it is drawn on is
 * `FloatingTabBar`, the same component the navigator's own bar uses, so the
 * two cannot drift apart. Pressing a tab goes to that tab's own screen on
 * `Main`, which pops this screen off the stack on the way — the same move the
 * back chevron makes, to a tab the member chose.
 */
export const AppTabBar = memo(() => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const active = useNavigationState(focusedTabOf);

  const openTab = useCallback(
    (name: keyof MainTabParamList) => {
      // The Account tab is a stack: named down to its landing screen, so a
      // page it may push one day cannot be what the tab reopens.
      if (name === 'Account') {
        navigation.navigate('Main', {
          screen: 'Account',
          params: { screen: 'AccountHome' },
        });
        return;
      }
      navigation.navigate('Main', { screen: name });
    },
    [navigation],
  );

  return (
    <FloatingTabBar items={TAB_ITEMS} activeName={active} onPress={openTab} />
  );
});

AppTabBar.displayName = 'AppTabBar';
