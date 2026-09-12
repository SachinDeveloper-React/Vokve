import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AccountScreen } from '../screens/main/AccountScreen';
import { StreakScreen } from '../screens/main/StreakScreen';
import type { AccountStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<AccountStackParamList>();

/**
 * The Account tab's own stack.
 *
 * Nested inside the tab rather than pushed on the root so the tab bar stays
 * on screen with Account lit: the streak is a page *of* the account, and a
 * user who taps the Account tab while looking at it expects to be taken back
 * to Account, which is exactly what a nested stack does with a tab press.
 */
export const AccountNavigator = () => (
  <Stack.Navigator
    screenOptions={{
      headerShown: false,
      // Native stack animations run on the platform's own compositor rather
      // than through JS, which is why this is preferred over the JS stack.
      animation: 'slide_from_right',
    }}
  >
    <Stack.Screen name="AccountHome" component={AccountScreen} />
    <Stack.Screen name="Streak" component={StreakScreen} />
  </Stack.Navigator>
);
