import { Coins, House, ShoppingBag, CircleUser } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { SFSymbol } from 'sf-symbols-typescript';
import type { MainTabParamList } from '../types/navigation';

export interface TabItem {
  name: keyof MainTabParamList;
  /** The word under the glyph, on every bar that draws this tab. */
  title: string;
  /** Drawn by the React bar on Android, and by the shell's own bar. */
  icon: LucideIcon;
  /**
   * Handed to UIKit by the native bar on iOS. Typed as `SFSymbol` rather than
   * `string`, so a symbol Apple does not ship fails to compile instead of
   * rendering as an empty tab slot on device.
   */
  sfSymbol: SFSymbol;
}

/**
 * The app's four tabs — what they are called and what they are drawn with.
 *
 * Separate from `tabs.ts` because three different bars draw this set and only
 * one of them mounts the screens behind it: the two tab navigators do, and
 * the shell bar every pushed screen carries (`components/navigation/
 * AppTabBar`) only navigates to them. Keeping the names and icons here is
 * what lets that bar share this list rather than repeat it — a screen imports
 * the bar, so a list that also reached for the screens would close a circle.
 *
 * The iOS symbols are all SF Symbols 1 (iOS 13), well under the app's iOS 15.1
 * floor. `dollarsign.circle.fill` stands in for the coin stack the lucide
 * icon draws: SF Symbols has no coin glyph, and a currency disc reads as money
 * where a bitcoin or cent sign would read as the wrong money.
 */
export const TAB_ITEMS: readonly TabItem[] = [
  {
    name: 'Home',
    title: 'Home',
    icon: House,
    sfSymbol: 'house.fill',
  },
  {
    name: 'Wallet',
    title: 'Coins',
    icon: Coins,
    sfSymbol: 'dollarsign.circle.fill',
  },
  {
    name: 'Shop',
    title: 'Shop',
    icon: ShoppingBag,
    sfSymbol: 'bag.fill',
  },
  {
    name: 'Account',
    title: 'Account',
    icon: CircleUser,
    sfSymbol: 'person.crop.circle.fill',
  },
];
