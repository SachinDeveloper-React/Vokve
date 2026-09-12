import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AccountScreen } from '../screens/main/AccountScreen';
import type { AccountStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<AccountStackParamList>();

/**
 * The Account tab's own stack.
 *
 * A stack around a single screen, for now. The pages the account leads to are
 * root routes — a screen reached from more than one tab cannot belong to any
 * of them — and this is where a page that genuinely is part of the account
 * would be pushed.
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
  </Stack.Navigator>
);
