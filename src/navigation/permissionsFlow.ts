import { createContext, useCallback, useContext } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { PermissionStep } from '../services/permissions';
import type { PermissionsStackParamList } from '../types/navigation';

export const PERMISSION_ROUTES: Record<
  PermissionStep,
  keyof PermissionsStackParamList
> = {
  activity: 'ActivityPermission',
  notifications: 'NotificationPermission',
  healthConnect: 'HealthConnectPermission',
};

/** The set-up's last screen, after the permissions: the daily step goal (D-55). */
export const STEP_GOAL_ROUTE: keyof PermissionsStackParamList = 'StepGoalSetup';

interface PermissionsFlow {
  /** The permission screens this phone needs, in order. */
  steps: PermissionStep[];
  /** Whether the step goal follows them — only while the account has none chosen. */
  askGoal: boolean;
  /** Through them all: on to the app. */
  finish: () => void;
}

export const PermissionsFlowContext = createContext<PermissionsFlow>({
  steps: [],
  askGoal: false,
  finish: () => {},
});

/** The set-up as a whole — what the step goal's screen closes it with. */
export const usePermissionsFlow = () => useContext(PermissionsFlowContext);

/**
 * Where one permission screen stands in the flow — "Step 2 of 3" — and the
 * way on from it: the next screen this phone needs, then the step goal when
 * there is one to choose, or the app.
 */
export function usePermissionStep(step: PermissionStep) {
  const { steps, askGoal, finish } = useContext(PermissionsFlowContext);
  const navigation =
    useNavigation<NativeStackNavigationProp<PermissionsStackParamList>>();
  const index = steps.indexOf(step);

  const next = useCallback(() => {
    const following = steps[index + 1];
    if (following) {
      navigation.navigate(PERMISSION_ROUTES[following]);
    } else if (askGoal) {
      navigation.navigate(STEP_GOAL_ROUTE);
    } else {
      finish();
    }
  }, [askGoal, finish, index, navigation, steps]);

  return { position: index + 1, total: steps.length, next };
}
