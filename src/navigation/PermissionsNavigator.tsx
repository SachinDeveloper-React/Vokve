import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityPermissionScreen } from '../screens/onboarding/ActivityPermissionScreen';
import { HealthConnectPermissionScreen } from '../screens/onboarding/HealthConnectPermissionScreen';
import { NotificationPermissionScreen } from '../screens/onboarding/NotificationPermissionScreen';
import { StepGoalSetupScreen } from '../screens/onboarding/StepGoalSetupScreen';
import {
  pendingPermissionSteps,
  stepGoalNeedsChoosing,
  type PermissionStep,
} from '../services/permissions';
import { useCurrentUser } from '../stores/authStore';
import { useOnboardingStore } from '../stores/onboardingStore';
import { useTheme } from '../theme';
import type { PermissionsStackParamList } from '../types/navigation';
import {
  PERMISSION_ROUTES,
  PermissionsFlowContext,
  STEP_GOAL_ROUTE,
} from './permissionsFlow';

const Stack = createNativeStackNavigator<PermissionsStackParamList>();

const SCREENS: Record<PermissionStep, React.ComponentType> = {
  activity: ActivityPermissionScreen,
  notifications: NotificationPermissionScreen,
  healthConnect: HealthConnectPermissionScreen,
};

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

interface Setup {
  steps: PermissionStep[];
  askGoal: boolean;
}

/**
 * The set-up between sign-in and the app: the permission screens (D-54) —
 * physical activity, notifications, Health Connect, only the ones this
 * phone still needs — then the daily step goal (D-55), while the account
 * has never chosen one. Both worked out once, as the flow opens. Through
 * the last screen, or with none to show, the account is marked as having
 * been through it on this phone and the root navigator moves on to Home.
 *
 * Its own stack, like onboarding: the user is signed in, and there is
 * nothing to go back to — the system back button steps back through these
 * screens, never out of them.
 */
export const PermissionsNavigator = () => {
  const { colors } = useTheme();
  const userId = useCurrentUser()?.id ?? null;
  const finishPermissions = useOnboardingStore(s => s.finishPermissions);
  const [setup, setSetup] = useState<Setup | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      pendingPermissionSteps().catch((): PermissionStep[] => []),
      stepGoalNeedsChoosing().catch(() => true),
    ]).then(([steps, askGoal]) => {
      if (live) setSetup({ steps, askGoal });
    });
    return () => {
      live = false;
    };
  }, []);

  const finish = useCallback(() => {
    if (userId) finishPermissions(userId);
  }, [finishPermissions, userId]);

  // Nothing left to ask on this phone: straight on to the app.
  const nothingToAsk = setup?.steps.length === 0 && !setup.askGoal;
  useEffect(() => {
    if (nothingToAsk) finish();
  }, [finish, nothingToAsk]);

  const flow = useMemo(
    () => ({
      steps: setup?.steps ?? [],
      askGoal: setup?.askGoal ?? false,
      finish,
    }),
    [finish, setup],
  );

  if (!setup || nothingToAsk) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <PermissionsFlowContext.Provider value={flow}>
      <Stack.Navigator
        initialRouteName={
          setup.steps.length > 0
            ? PERMISSION_ROUTES[setup.steps[0]]
            : STEP_GOAL_ROUTE
        }
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          gestureEnabled: false,
        }}
      >
        {setup.steps.map(step => (
          <Stack.Screen
            key={step}
            name={PERMISSION_ROUTES[step]}
            component={SCREENS[step]}
          />
        ))}
        {setup.askGoal ? (
          <Stack.Screen
            name={STEP_GOAL_ROUTE}
            component={StepGoalSetupScreen}
          />
        ) : null}
      </Stack.Navigator>
    </PermissionsFlowContext.Provider>
  );
};
