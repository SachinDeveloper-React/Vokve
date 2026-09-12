import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { WorkoutTemplate } from './models';

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
 * The screens under the Account tab. A stack of its own rather than root
 * routes: the streak is reached *from* Account and belongs to it, and a
 * screen pushed onto the root would cover the tab bar the user navigates by.
 */
export type AccountStackParamList = {
  AccountHome: undefined;
  Streak: undefined;
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
