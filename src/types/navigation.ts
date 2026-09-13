import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { MealSlot, WorkoutTemplate } from './models';

export type AuthStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  SignUp: undefined;
  /**
   * Takes no params: the challenge it verifies lives in the auth store, and
   * copying the verification id into a route would leave two places able to
   * disagree about which sign-up is in progress.
   */
  VerifyOtp: undefined;
};

/**
 * Onboarding sits between a live session and the app. Its own list rather than
 * an auth route: the user is signed in by the time they reach it.
 */
export type OnboardingStackParamList = {
  CompleteProfile: undefined;
};

/**
 * The screens under the Account tab.
 *
 * Only the tab's own landing screen is here. Everything the account leads to —
 * the streak, the notification centre, the challenge board — is a root route,
 * so tapping the Account tab always lands on the account itself rather than on
 * whatever the user last opened from it. Kept as a stack rather than a bare
 * screen so the tab has somewhere to push a page that genuinely belongs to it.
 */
export type AccountStackParamList = {
  AccountHome: undefined;
};

/**
 * The four tabs the app ships with. `Wallet` is the route; the bar labels it
 * "Coins", which is what the user spends — the route keeps the broader name so
 * a future statement or payout screen can live under it without a rename.
 *
 * `Account` carries its stack's params, `| undefined` so the existing
 * `navigate('Main', { screen: 'Account' })` calls keep landing on the tab's
 * first screen without naming it.
 */
export type MainTabParamList = {
  Home: undefined;
  Wallet: undefined;
  Shop: undefined;
  Account: NavigatorScreenParams<AccountStackParamList> | undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
  WorkoutDetail: { template: WorkoutTemplate };
  ActiveWorkout: undefined;
  /**
   * Reached from the bell in every screen's header, so it belongs to no tab.
   * On the root stack it covers the bar and returns the user to exactly the
   * tab they opened it from, and every tab keeps leading to its own screen.
   */
  Notifications: undefined;
  /** Opened from Home's shortcut row, and later from the account's rewards. */
  Challenges: undefined;
  /** Opened from Home's shortcut row and from the account's menu. */
  Streak: undefined;
  /**
   * `tab` picks which half opens — the prizes, or the rules that award them.
   * Optional, so the plain `navigate('LeaderboardRewards')` still lands on the
   * prizes, which is what the account's rewards row wants.
   */
  LeaderboardRewards: { tab?: 'rewards' | 'how' } | undefined;
  /** Opened from the dashboard's hydration card. */
  Hydration: undefined;
  /** Opened from the hydration screen's own header. */
  HydrationReminder: undefined;
  /** Opened from the dashboard's "Analysis" metric tile. */
  Analytics: undefined;
  /** Opened from the dashboard's "Health check up" shortcut. */
  HealthCheckup: undefined;
  /** Opened from the dashboard's "Nutrition & goal" shortcut. */
  Nutrition: undefined;
  /** Opened from the nutrition screen's meal plan preferences. */
  DietPlan: undefined;
  /**
   * `slot` is the meal whose "+" was pressed and `date` the day being looked
   * at. Both optional, so a plain `navigate('AddMeal')` opens on breakfast,
   * today.
   */
  AddMeal: { slot?: MealSlot; date?: string } | undefined;
  /** Reached from the notification centre and from the account's shortcuts. */
  NotificationSettings: undefined;
  /** Opened from the nutrition screen's "View All" meals link. */
  NutritionHistory: undefined;
  /** Opened from the health checkup's heart rate tile. */
  HeartRate: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type AuthStackScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type MainTabScreenProps<T extends keyof MainTabParamList> =
  BottomTabScreenProps<MainTabParamList, T>;

export type AccountStackScreenProps<T extends keyof AccountStackParamList> =
  NativeStackScreenProps<AccountStackParamList, T>;

/**
 * Registering the root list globally means `useNavigation()` is typed
 * everywhere without each caller passing a generic.
 */
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
