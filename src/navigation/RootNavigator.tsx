import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { config } from '../constants/config';
import { ActiveWorkoutScreen } from '../screens/main/ActiveWorkoutScreen';
import { AddMealScreen } from '../screens/main/AddMealScreen';
import { AddressFormScreen } from '../screens/main/AddressFormScreen';
import { AddressesScreen } from '../screens/main/AddressesScreen';
import { AnalyticsScreen } from '../screens/main/AnalyticsScreen';
import { BloodPressureScreen } from '../screens/main/BloodPressureScreen';
import { AchievementDetailScreen } from '../screens/main/AchievementDetailScreen';
import { AchievementsScreen } from '../screens/main/AchievementsScreen';
import { ChallengeDetailScreen } from '../screens/main/ChallengeDetailScreen';
import { ChallengeListScreen } from '../screens/main/ChallengeListScreen';
import { ChallengesScreen } from '../screens/main/ChallengesScreen';
import { CoinHistoryScreen } from '../screens/main/CoinHistoryScreen';
import { DietPlanScreen } from '../screens/main/DietPlanScreen';
import { DietPlansScreen } from '../screens/main/DietPlansScreen';
import { FoodLibraryScreen } from '../screens/main/FoodLibraryScreen';
import { HealthCheckupScreen } from '../screens/main/HealthCheckupScreen';
import { HeartRateScreen } from '../screens/main/HeartRateScreen';
import { HydrationHistoryScreen } from '../screens/main/HydrationHistoryScreen';
import { HydrationReminderScreen } from '../screens/main/HydrationReminderScreen';
import { HydrationScreen } from '../screens/main/HydrationScreen';
import { LeaderboardBoardScreen } from '../screens/main/LeaderboardBoardScreen';
import { LeaderboardRewardsScreen } from '../screens/main/LeaderboardRewardsScreen';
import { NotificationSettingsScreen } from '../screens/main/NotificationSettingsScreen';
import { NotificationsScreen } from '../screens/main/NotificationsScreen';
import { NutritionHistoryScreen } from '../screens/main/NutritionHistoryScreen';
import { NutritionScreen } from '../screens/main/NutritionScreen';
import { OrderDetailScreen } from '../screens/main/OrderDetailScreen';
import { OrdersScreen } from '../screens/main/OrdersScreen';
import { ReferralScreen } from '../screens/main/ReferralScreen';
import { ReminderSoundScreen } from '../screens/main/ReminderSoundScreen';
import { AboutScreen } from '../screens/main/AboutScreen';
import { CartScreen } from '../screens/main/CartScreen';
import { CheckoutScreen } from '../screens/main/CheckoutScreen';
import { PaymentScreen } from '../screens/main/PaymentScreen';
import { OrderConfirmationScreen } from '../screens/main/OrderConfirmationScreen';
import { ShippingAddressScreen } from '../screens/main/ShippingAddressScreen';
import { EditProfileScreen } from '../screens/main/EditProfileScreen';
import { HelpSupportScreen } from '../screens/main/HelpSupportScreen';
import { HelpTopicScreen } from '../screens/main/HelpTopicScreen';
import { ContactUsScreen } from '../screens/main/ContactUsScreen';
import { ReportIssueScreen } from '../screens/main/ReportIssueScreen';
import { AppGuideScreen } from '../screens/main/AppGuideScreen';
import { PrivacyScreen } from '../screens/main/PrivacyScreen';
import { ProductDetailScreen } from '../screens/main/ProductDetailScreen';
import { ReviewsScreen } from '../screens/main/ReviewsScreen';
import { SecurityScreen } from '../screens/main/SecurityScreen';
import { SupportTicketScreen } from '../screens/main/SupportTicketScreen';
import { ShopBrowseScreen } from '../screens/main/ShopBrowseScreen';
import { ShopSearchScreen } from '../screens/main/ShopSearchScreen';
import { WishlistScreen } from '../screens/main/WishlistScreen';
import { WriteReviewScreen } from '../screens/main/WriteReviewScreen';
import { StreakDayScreen } from '../screens/main/StreakDayScreen';
import { StreakHistoryScreen } from '../screens/main/StreakHistoryScreen';
import { StreakScreen } from '../screens/main/StreakScreen';
import { StepGoalScreen } from '../screens/main/StepGoalScreen';
import { StepSourcesScreen } from '../screens/main/StepSourcesScreen';
import { VitalsHistoryScreen } from '../screens/main/VitalsHistoryScreen';
import { VitalsTrendsScreen } from '../screens/main/VitalsTrendsScreen';
import { StepTrackingScreen } from '../screens/main/StepTrackingScreen';
import { VerifyOtpScreen } from '../screens/auth/VerifyOtpScreen';
import { ConnectionErrorScreen } from '../screens/system/ConnectionErrorScreen';
import { UpgradeRequiredScreen } from '../screens/system/UpgradeRequiredScreen';
import { UpdateSheet } from '../components/system/UpdateSheet';
import { useUpgradeRequired } from '../stores/appStatusStore';
import { useStepTrackingSession } from '../hooks/useStepTrackingSession';
import { useSessionRecovery } from '../hooks/useSessionRecovery';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { usePermissionReporting } from '../hooks/usePermissionReporting';
import { useDeviceHealthReporting } from '../hooks/useDeviceHealthReporting';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useReminderNotifications } from '../hooks/useReminderNotifications';
import { trackScreen } from '../services/analytics';
import { setErrorScreen } from '../services/errorReporting';
import { WorkoutDetailScreen } from '../screens/main/WorkoutDetailScreen';
import {
  useAuthStatus,
  useAuthStore,
  useCurrentUser,
  useIsProfileComplete,
  usePendingContactVerification,
} from '../stores/authStore';
import { usePermissionsDone } from '../stores/onboardingStore';
import { useTheme } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { AuthNavigator } from './AuthNavigator';
import { OnboardingNavigator } from './OnboardingNavigator';
import { PermissionsNavigator } from './PermissionsNavigator';
import { InAppShellContext } from './shellTabs';
import { TabNavigator } from './TabNavigator';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Lets the main app be opened without a working sign-in while the backend is
 * being built. `__DEV__` is the actual guard: it is compiled to `false` in a
 * release build, so the config flag cannot ship the gate open by accident.
 *
 * Evaluated per render rather than once at module scope — it is a single
 * boolean AND, and keeping it out of module scope is what makes the release
 * behaviour assertable in a test.
 */
function shouldBypassAuth(): boolean {
  return __DEV__ && config.bypassAuthInDev;
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

/**
 * The route parameters a screen view may carry (PRD ADV2). An allowlist, not
 * a filter: route parameters are whatever a screen needed, and a trail that
 * copied all of them would eventually carry something a member typed.
 */
const TRACKED_PARAMS = new Set([
  'id',
  'itemId',
  'orderId',
  'category',
  'challengeId',
  'topic',
  'date',
  'kind',
  'focus',
  'select',
]);

/** What a route says about itself that is safe to keep. */
function screenProps(
  params: object | undefined,
): Record<string, string | number | boolean> {
  const props: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (!TRACKED_PARAMS.has(key)) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      props[key] = value;
    }
  }
  return props;
}

export const RootNavigator = () => {
  const { colors, navigationTheme } = useTheme();
  const status = useAuthStatus();
  const isProfileComplete = useIsProfileComplete();
  const userId = useCurrentUser()?.id;
  const permissionsDone = usePermissionsDone(userId);
  const hydrate = useAuthStore(s => s.hydrate);
  const pendingContact = usePendingContactVerification();
  const upgradeRequired = useUpgradeRequired();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [isNavReady, setNavReady] = useState(false);

  // Where the member is, every time it changes: the screen trail the
  // operator reads (`screen_view`, PRD ADV2). Taken from the container
  // rather than from each screen, so a new screen is instrumented by
  // existing — and none is ever forgotten.
  const trackCurrentScreen = useCallback(() => {
    const route = navigationRef.getCurrentRoute();
    if (!route) return;
    trackScreen(route.name, screenProps(route.params));
    // The same move tells the crash reporter where the member is, so a
    // fault arrives naming the screen it happened on (RULES P17).
    setErrorScreen(route.name);
  }, [navigationRef]);

  const onNavReady = useCallback(() => {
    setNavReady(true);
    trackCurrentScreen();
  }, [trackCurrentScreen]);
  const promptedFor = useRef<string | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // A session the app opened on its stored snapshot is asked about again the
  // moment the phone can reach the server, whatever is on screen.
  useSessionRecovery();

  // Step counting follows the session, not any one screen.
  useStepTrackingSession();

  // Nor does what the phone allows (RULES P14).
  usePermissionReporting();

  // Nor whether it is actually working (RULES P17): a step service an OEM
  // killed, a Health Connect grant withdrawn, a sync that keeps failing.
  useDeviceHealthReporting();

  // What this build should do about its own version (RULES DV12): asked on
  // launch and on every foreground, before anything has been refused.
  const { update: softUpdate, dismiss: dismissUpdate } = useAppUpdate();

  // The same for hydration reminders: the plan stays scheduled with the OS
  // whatever is on screen, and a tapped reminder opens the water log.
  useReminderNotifications();

  // And for pushes: shown when the OS will not show them, the bell kept
  // current, and a tapped notification taken wherever it asked to go —
  // reminders included, since both share one slot (RULES A28, P13).
  usePushNotifications(navigationRef, isNavReady);

  const isSignedIn = status === 'authenticated' || shouldBypassAuth();

  // Onboarding is gated on the session, not instead of it: a verified user
  // who has not finished their profile is signed in — they simply cannot
  // reach the app until the remaining details are in. The dev bypass skips
  // this too, or it would replace one gate with another.
  const needsOnboarding =
    status === 'authenticated' && !isProfileComplete && !shouldBypassAuth();

  // Then, once per account on this phone, the set-up — the permission
  // screens (physical activity, notifications, Health Connect, D-54) and
  // the step goal (D-55) — before Home.
  const needsPermissions =
    status === 'authenticated' &&
    isProfileComplete &&
    !permissionsDone &&
    !shouldBypassAuth();

  const inApp = isSignedIn && !needsOnboarding && !needsPermissions;

  // Once, per challenge: the moment the sign-up code passes, the server
  // hands back the challenge for the other contact, and the verify screen
  // is pushed over Main as soon as Main is there — after the profile and
  // the permission screens. Skipping it goes back to Main; the banner can
  // ask again later (D-20 — soft gate).
  useEffect(() => {
    if (!isNavReady || !pendingContact || !inApp) {
      return;
    }
    if (promptedFor.current === pendingContact.verificationId) {
      return;
    }
    promptedFor.current = pendingContact.verificationId;
    navigationRef.navigate('VerifyContact');
  }, [inApp, isNavReady, navigationRef, pendingContact]);

  // A retired build outranks everything: no session state matters when
  // every request is refused.
  if (upgradeRequired) {
    return <UpgradeRequiredScreen />;
  }

  // A session that could not be confirmed keeps its own screen — with a
  // retry — rather than being mistaken for no session at all. A retry keeps
  // the status and shows its progress on the button, so this never flashes
  // back to the splash.
  if (status === 'unreachable') {
    return <ConnectionErrorScreen />;
  }

  if (status === 'idle' || status === 'hydrating') {
    return (
      <View style={[styles.splash, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      onReady={onNavReady}
      onStateChange={trackCurrentScreen}
    >
      {/* The knock sits over whatever is on screen; the wall replaces it. */}
      <UpdateSheet update={softUpdate} onDismiss={dismissUpdate} />
      {/*
        Inside the app, every screen draws the tab bar for itself: these are
        root-stack routes rather than pages inside a tab, so that a tab always
        opens its own screen — and a stack screen covers the real bar
        (`shellTabs`, `components/navigation/AppTabBar`). Auth, onboarding and
        the permission screens are outside it and carry no bar.
      */}
      <InAppShellContext.Provider value={inApp}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {needsOnboarding ? (
            <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
          ) : needsPermissions ? (
            <Stack.Screen name="Permissions" component={PermissionsNavigator} />
          ) : isSignedIn ? (
            <Stack.Group>
              <Stack.Screen name="Main" component={TabNavigator} />
              <Stack.Screen
                name="AddMeal"
                component={AddMealScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="FoodLibrary"
                component={FoodLibraryScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="DietPlan"
                component={DietPlanScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="DietPlans"
                component={DietPlansScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="NutritionHistory"
                component={NutritionHistoryScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Nutrition"
                component={NutritionScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Referral"
                component={ReferralScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="CoinHistory"
                component={CoinHistoryScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Orders"
                component={OrdersScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="OrderDetail"
                component={OrderDetailScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Addresses"
                component={AddressesScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="AddressForm"
                component={AddressFormScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="ShopBrowse"
                component={ShopBrowseScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="ShopSearch"
                component={ShopSearchScreen}
                options={{ animation: 'fade' }}
              />
              <Stack.Screen
                name="ProductDetail"
                component={ProductDetailScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Cart"
                component={CartScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="ShippingAddress"
                component={ShippingAddressScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Checkout"
                component={CheckoutScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Payment"
                component={PaymentScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="OrderConfirmation"
                component={OrderConfirmationScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Wishlist"
                component={WishlistScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Reviews"
                component={ReviewsScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="WriteReview"
                component={WriteReviewScreen}
                options={{ animation: 'slide_from_bottom' }}
              />
              <Stack.Screen
                name="EditProfile"
                component={EditProfileScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Security"
                component={SecurityScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Privacy"
                component={PrivacyScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="HelpSupport"
                component={HelpSupportScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="HelpTopic"
                component={HelpTopicScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="ContactUs"
                component={ContactUsScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="ReportIssue"
                component={ReportIssueScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="AppGuide"
                component={AppGuideScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="SupportTicket"
                component={SupportTicketScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="About"
                component={AboutScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="BloodPressure"
                component={BloodPressureScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="HeartRate"
                component={HeartRateScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="HealthCheckup"
                component={HealthCheckupScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Analytics"
                component={AnalyticsScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="HydrationReminder"
                component={HydrationReminderScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Hydration"
                component={HydrationScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="HydrationHistory"
                component={HydrationHistoryScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="ReminderSound"
                component={ReminderSoundScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="VerifyContact"
                component={VerifyOtpScreen}
                options={{ animation: 'slide_from_bottom' }}
              />
              <Stack.Screen
                name="LeaderboardRewards"
                component={LeaderboardRewardsScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Streak"
                component={StreakScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="StreakHistory"
                component={StreakHistoryScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="StreakDay"
                component={StreakDayScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="StepTracking"
                component={StepTrackingScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="StepSources"
                component={StepSourcesScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="StepGoal"
                component={StepGoalScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="VitalsHistory"
                component={VitalsHistoryScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="VitalsTrends"
                component={VitalsTrendsScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Challenges"
                component={ChallengesScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="ChallengeDetail"
                component={ChallengeDetailScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="ChallengeList"
                component={ChallengeListScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Achievements"
                component={AchievementsScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="AchievementDetail"
                component={AchievementDetailScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="LeaderboardBoard"
                component={LeaderboardBoardScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="NotificationSettings"
                component={NotificationSettingsScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="Notifications"
                component={NotificationsScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="WorkoutDetail"
                component={WorkoutDetailScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="ActiveWorkout"
                component={ActiveWorkoutScreen}
                options={{
                  animation: 'slide_from_bottom',
                  // A workout in progress should not be swiped away by accident.
                  gestureEnabled: false,
                }}
              />
            </Stack.Group>
          ) : (
            <Stack.Screen name="Auth" component={AuthNavigator} />
          )}
        </Stack.Navigator>
      </InAppShellContext.Provider>
    </NavigationContainer>
  );
};
