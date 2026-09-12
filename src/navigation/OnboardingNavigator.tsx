import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CompleteProfileScreen } from '../screens/onboarding/CompleteProfileScreen';
import type { OnboardingStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

/**
 * The step between a verified account and the app itself.
 *
 * Its own stack rather than a screen inside the auth flow, because by this
 * point the user *is* signed in — tokens are issued and the session is live.
 * What is missing is the handful of details sign-up does not ask for, and
 * modelling that as "still signing in" would mean a verified user who closes
 * the app comes back to a login form.
 */
export const OnboardingNavigator = () => (
  <Stack.Navigator
    screenOptions={{
      headerShown: false,
      animation: 'slide_from_right',
      // There is nowhere to go back to: the account exists and the app is not
      // reachable until this is filled in.
      gestureEnabled: false,
    }}
  >
    <Stack.Screen name="CompleteProfile" component={CompleteProfileScreen} />
  </Stack.Navigator>
);
