import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type {
  CoinSource,
  DeliveryPreferences,
  MealSlot,
  ProfileGap,
  PurchaseLine,
  ShopCategory,
  WorkoutTemplate,
} from './models';

/** What an order is made of: the basket, or exactly these lines. */
export type OrderSource = { fromCart: true } | { lines: PurchaseLine[] };
export type AuthStackParamList = {
  Welcome: undefined;
  /** `notice` is a one-line confirmation to show on arrival — "Password updated". */
  SignIn: { notice?: string } | undefined;
  SignUp: undefined;
  /** Asks for the email or phone; the challenge it produces lives in the auth store. */
  ForgotPassword: undefined;
  /** Code plus new password, in one step. Takes no params for the same reason as VerifyOtp. */
  ResetPassword: undefined;
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
 * The set-up after sign-in and the profile: the permission screens (D-54),
 * each asking for one thing — physical activity, notifications, Health
 * Connect — with one already granted left out, then the step goal (D-55). A
 * list of its own, like onboarding: the user is signed in, and the app
 * waits until these have been answered once on this phone.
 */
export type PermissionsStackParamList = {
  ActivityPermission: undefined;
  NotificationPermission: undefined;
  HealthConnectPermission: undefined;
  /**
   * Last, the daily step goal (D-55) — only while the account has never
   * chosen one, so a second phone is not asked again.
   */
  StepGoalSetup: undefined;
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
  Permissions: NavigatorScreenParams<PermissionsStackParamList>;
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
  /**
   * The code for the second contact detail — phone after an email sign-up,
   * email after a phone one. A root route rather than an auth one: the user
   * is signed in by then, and the step can be skipped (BACKEND.md §13.3,
   * D-20) — so it is pushed over Main, not in place of it.
   */
  VerifyContact: undefined;
  /** Opened from the hydration screen's own header. */
  HydrationReminder: undefined;
  /** Opened from the dashboard's "Analysis" metric tile. */
  Analytics: undefined;
  /**
   * Counting steps: turning it on, Health Connect, keeping it alive in the
   * background, and the sync. From the dashboard's step card and the
   * account's menu.
   */
  StepTracking: undefined;
  /** Where a day's steps came from and how they were matched — from the step tracking screen. */
  StepSources: undefined;
  /** The daily step goal, from the dashboard step card's "Edit Goal" (D-55). */
  StepGoal: undefined;
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
  /** Opened from the health checkup's blood pressure tile. */
  BloodPressure: undefined;
  /** Opened from the wallet's "Earn Coins" action. */
  Referral: undefined;
  /**
   * The full coin ledger, from the wallet's "Coin History" action and its
   * "View All". `source` opens it already filtered; optional, so the plain
   * `navigate('CoinHistory')` shows everything.
   */
  CoinHistory: { source?: CoinSource } | undefined;
  /** From the wallet's "My Orders", the shop's bag and the account's menu. */
  Orders: undefined;
  OrderDetail: { id: string };
  /**
   * The address book. `select` opens it from a checkout: tapping an address
   * makes it the default and returns, which is how the checkout learns of
   * the choice without state riding back through the route.
   */
  Addresses: { select?: boolean } | undefined;
  /** `id` edits; without it, a new address. */
  AddressForm: { id?: string } | undefined;
  /**
   * A page of the catalogue: one category, the deals, or everything —
   * paged from the server, sortable, searchable within. `title` overrides
   * the heading the params would otherwise produce.
   */
  ShopBrowse:
    | { category?: ShopCategory; deals?: boolean; title?: string }
    | undefined;
  /** Search across the whole catalogue, opened from the shop's search field. */
  ShopSearch: undefined;
  /** One item in full — sizes, reviews, the basket and "Buy now". */
  ProductDetail: { id: string };
  /** The basket. */
  Cart: undefined;
  /**
   * Where the order goes and how it is handed over (RULES R4, R17) — the
   * step between the basket, or a product's "Redeem Now", and the till.
   */
  ShippingAddress: OrderSource;
  /**
   * The till. `fromCart` buys the basket; `lines` buys exactly these —
   * "Redeem Now" from a product page — leaving the basket as it was. The
   * shipping page passes the address it chose and the delivery
   * preferences; opened without them, the default address and the saved
   * preferences stand.
   */
  Checkout: OrderSource & {
    addressId?: string;
    delivery?: Partial<DeliveryPreferences>;
  };
  /**
   * How the order is paid (RULES R12) — the page between the till and the
   * money. It carries everything the checkout settled: where it goes, how
   * it is handed over, the coins it chose and the coupon its quote showed
   * applying. Picking a method here decides the coins the order finally
   * takes, and "Pay Now" is what places it.
   */
  Payment: OrderSource & {
    addressId: string;
    delivery?: Partial<DeliveryPreferences>;
    /** The coins the checkout settled on; a method may take more or fewer. */
    coins: number;
    /** The coupon the checkout's quote showed applying (RULES R16). */
    couponCode?: string | null;
  };
  /**
   * What came of an order, the moment it was placed (RULES R5, R12): the
   * verdict, the reference, where it goes and when it should arrive. The
   * payment page lands here; the receipt is a tap further on.
   */
  OrderConfirmation: { id: string };
  Wishlist: undefined;
  /** Every review of an item, paged, with the summary and a way to write one. */
  Reviews: { itemId: string };
  /** Write or edit the reader's own review of an item. */
  WriteReview: { itemId: string };
  /**
   * The profile form. `focus` opens it scrolled to one field — what the
   * completeness card's rows lead to.
   */
  EditProfile: { focus?: ProfileGap['field'] } | undefined;
  /** Password, email, phone and the devices with a live session. */
  Security: undefined;
  /** The data choices, plus the export and the account deletion. */
  Privacy: undefined;
  /** The help centre and the member's own tickets. */
  HelpSupport: undefined;
  SupportTicket: { id: string };
  /** Version, update state, release notes and the legal links. */
  About: undefined;
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
