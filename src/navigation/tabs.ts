import type { ComponentType } from 'react';
import { HomeScreen } from '../screens/main/HomeScreen';
import { ShopScreen } from '../screens/main/ShopScreen';
import { WalletScreen } from '../screens/main/WalletScreen';
import type { MainTabParamList } from '../types/navigation';
import { AccountNavigator } from './AccountNavigator';
import { TAB_ITEMS, type TabItem } from './tabItems';

export interface TabDefinition extends TabItem {
  component: ComponentType<Record<string, never>>;
}

/** What each tab mounts. */
const TAB_SCREENS: Record<
  keyof MainTabParamList,
  ComponentType<Record<string, never>>
> = {
  Home: HomeScreen,
  Wallet: WalletScreen,
  Shop: ShopScreen,
  // A stack, not a screen: Account has pages of its own beneath it.
  Account: AccountNavigator,
};

/**
 * The app's four tabs, declared once — the names and icons from `TAB_ITEMS`,
 * with the screen each one mounts.
 *
 * Both tab bars map over this list rather than repeating the screens in their
 * own JSX. The two implementations already differ in what an icon *is* — a
 * React component on Android, an SF Symbol name on iOS — and that is exactly
 * the kind of split that lets a tab quietly exist on one platform and not the
 * other. Keeping the set here makes that impossible and gives the suite one
 * thing to assert.
 */
export const MAIN_TABS: readonly TabDefinition[] = TAB_ITEMS.map(item => ({
  ...item,
  component: TAB_SCREENS[item.name],
}));
