import { useEffect } from 'react';
import { AppState } from 'react-native';
import { reportPermissions } from '../services/permissions';
import { useAuthStatus } from '../stores/authStore';
import { useStepsStore } from '../stores/stepsStore';

/**
 * Keeps the server's picture of what this phone allows up to date (RULES
 * P11). Mounted once at the root, like the step session: permissions belong
 * to the install, not to any screen, and the member changes them in places
 * the app cannot watch.
 *
 * Three moments, and nothing on a timer:
 *   - **Signed in.** The first report of the launch, once there is an
 *     account and a device to attribute it to.
 *   - **Back from the background.** Settings is where a permission was most
 *     likely changed, and the app was not running to see it happen.
 *   - **The tracker answered.** Health Connect's grants and the battery
 *     exemption are read by `services/steps` into its store; when that
 *     lands, what we would have reported a moment ago is out of date.
 *
 * `reportPermissions` diffs against what the server last accepted, so the
 * three together cost one request a day on a phone nobody changes.
 */
export function usePermissionReporting(): void {
  const signedIn = useAuthStatus() === 'authenticated';

  useEffect(() => {
    if (!signedIn) return;
    reportPermissions();

    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') reportPermissions();
    });

    // Only the slices a snapshot is built from, so an arriving step count
    // does not cost a comparison.
    let previous = permissionSlice();
    const unsubscribe = useStepsStore.subscribe(() => {
      const next = permissionSlice();
      if (next === previous) return;
      previous = next;
      reportPermissions();
    });

    return () => {
      appState.remove();
      unsubscribe();
    };
  }, [signedIn]);
}

/** The tracker's permission-bearing state as one comparable string. */
function permissionSlice(): string {
  const { permissions, healthConnect, background } = useStepsStore.getState();
  return JSON.stringify([
    permissions?.activityRecognition ?? null,
    permissions?.postNotifications ?? null,
    healthConnect?.availability ?? null,
    healthConnect?.stepsGranted ?? healthConnect?.canRead ?? null,
    healthConnect?.canWrite ?? null,
    background?.batteryOptimizationEnabled ?? null,
  ]);
}
