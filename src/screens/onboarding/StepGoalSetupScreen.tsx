import React from 'react';
import { usePermissionsFlow } from '../../navigation/permissionsFlow';
import { StepGoalView } from '../main/StepGoalScreen';

/**
 * The set-up's last screen (D-55): the daily step goal, chosen once per
 * account. Saving it — or failing to — is the way into the app.
 */
export const StepGoalSetupScreen = () => {
  const { finish } = usePermissionsFlow();
  return <StepGoalView setup onDone={finish} />;
};
