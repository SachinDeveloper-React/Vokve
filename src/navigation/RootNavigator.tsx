import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { config } from '../constants/config';
import { ActiveWorkoutScreen } from '../screens/main/ActiveWorkoutScreen';
import { AddMealScreen } from '../screens/main/AddMealScreen';
import { AnalyticsScreen } from '../screens/main/AnalyticsScreen';
import { BloodPressureScreen } from '../screens/main/BloodPressureScreen';
import { ChallengesScreen } from '../screens/main/ChallengesScreen';
import { DietPlanScreen } from '../screens/main/DietPlanScreen';
import { HealthCheckupScreen } from '../screens/main/HealthCheckupScreen';
import { HeartRateScreen } from '../screens/main/HeartRateScreen';
import { HydrationReminderScreen } from '../screens/main/HydrationReminderScreen';
import { HydrationScreen } from '../screens/main/HydrationScreen';
import { LeaderboardRewardsScreen } from '../screens/main/LeaderboardRewardsScreen';
import { NotificationSettingsScreen } from '../screens/main/NotificationSettingsScreen';
import { NotificationsScreen } from '../screens/main/NotificationsScreen';
import { NutritionHistoryScreen } from '../screens/main/NutritionHistoryScreen';
import { NutritionScreen } from '../screens/main/NutritionScreen';
import { ReferralScreen } from '../screens/main/ReferralScreen';
import { StreakScreen } from '../screens/main/StreakScreen';
import { WorkoutDetailScreen } from '../screens/main/WorkoutDetailScreen';
import {
  useAuthStatus,
  useAuthStore,
  useIsProfileComplete,
} from '../stores/authStore';
import { useTheme } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { AuthNavigator } from './AuthNavigator';
import { OnboardingNavigator } from './OnboardingNavigator';
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

export const RootNavigator = () => {
  const { colors, navigationTheme } = useTheme();
  const status = useAuthStatus();
  const isProfileComplete = useIsProfileComplete();
  const hydrate = useAuthStore(s => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (status === 'idle' || status === 'hydrating') {
    return (
      <View style={[styles.splash, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const isSignedIn = status === 'authenticated' || shouldBypassAuth();

  // Onboarding is gated on the session, not instead of it: a verified user
  // who has not finished their profile is signed in — they simply cannot
  // reach the app until the remaining details are in. The dev bypass skips
  // this too, or it would replace one gate with another.
  const needsOnboarding =
    status === 'authenticated' && !isProfileComplete && !shouldBypassAuth();

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {needsOnboarding ? (
          <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
        ) : isSignedIn ? (
          <Stack.Group>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Screen
              name="AddMeal"
              component={AddMealScreen}
              options={{ animation: 'slide_from_right' }}
            />
            <Stack.Screen
              name="DietPlan"
              component={DietPlanScreen}
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
              name="Challenges"
              component={ChallengesScreen}
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
    </NavigationContainer>
  );
};
