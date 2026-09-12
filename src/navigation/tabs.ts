import type { ComponentType } from 'react';
import { Coins, House, ShoppingBag, CircleUser } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { SFSymbol } from 'sf-symbols-typescript';
import { HomeScreen } from '../screens/main/HomeScreen';
import { ShopScreen } from '../screens/main/ShopScreen';
import { WalletScreen } from '../screens/main/WalletScreen';
import type { MainTabParamList } from '../types/navigation';
import { AccountNavigator } from './AccountNavigator';

export interface TabDefinition {
  name: keyof MainTabParamList;
  title: string;
  component: ComponentType<Record<string, never>>;
  /** Drawn by the React bar on Android. */
  icon: LucideIcon;
  /**
   * Handed to UIKit by the native bar on iOS. Typed as `SFSymbol` rather than
   * `string`, so a symbol Apple does not ship fails to compile instead of
   * rendering as an empty tab slot on device.
   */
  sfSymbol: SFSymbol;
}

/**
 * The app's four tabs, declared once.
 *
 * Both tab bars map over this list rather than repeating the screens in their
 * own JSX. The two implementations already differ in what an icon *is* — a
 * React component on Android, an SF Symbol name on iOS — and that is exactly
 * the kind of split that lets a tab quietly exist on one platform and not the
 * other. Keeping the set here makes that impossible and gives the suite one
 * thing to assert.
 *
 * The iOS symbols are all SF Symbols 1 (iOS 13), well under the app's iOS 15.1
 * floor. `dollarsign.circle.fill` stands in for the coin stack the Android bar
 * draws: SF Symbols has no coin glyph, and a currency disc reads as money
 * where a bitcoin or cent sign would read as the wrong money.
 */
export const MAIN_TABS: readonly TabDefinition[] = [
  {
    name: 'Home',
    title: 'Home',
    component: HomeScreen,
    icon: House,
    sfSymbol: 'house.fill',
  },
  {
    name: 'Wallet',
    title: 'Coins',
    component: WalletScreen,
    icon: Coins,
    sfSymbol: 'dollarsign.circle.fill',
  },
  {
    name: 'Shop',
    title: 'Shop',
    component: ShopScreen,
    icon: ShoppingBag,
    sfSymbol: 'bag.fill',
  },
  {
    name: 'Account',
    title: 'Account',
    // A stack, not a screen: Account has pages of its own beneath it.
    component: AccountNavigator,
    icon: CircleUser,
    sfSymbol: 'person.crop.circle.fill',
  },
];
