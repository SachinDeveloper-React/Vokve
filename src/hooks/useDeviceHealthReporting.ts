import { useEffect } from 'react';
import { AppState } from 'react-native';
import { reportDeviceHealth } from '../services/deviceHealth';
import { useAuthStatus } from '../stores/authStore';
import { useStepsStore } from '../stores/stepsStore';

/**
 * Keeps the server's picture of whether this phone is *working* up to date
 * (RULES P17) — the sibling of `usePermissionReporting`, and mounted beside
 * it for the same reason: a dead step service belongs to the install, not to
 * any screen, and it dies while nobody is looking.
 *
 * Four moments, and nothing on a timer:
 *   - **Signed in.** The first report of the launch.
 *   - **Back from the background.** Where a service was most likely killed,
 *     and where the tracker's own health read also revives it.
 *   - **The tracker's state moved.** Counting started or stopped, Health
 *     Connect was granted or revoked, the service was recovered again.
 *   - **A sync failed.** The one symptom the member actually notices, and
 *     the one worth knowing about without waiting for a foreground.
 *
 * `reportDeviceHealth` diffs against what the server last took, so the four
 * together cost two requests a day on a phone where nothing goes wrong.
 */
export function useDeviceHealthReporting(): void {
  const signedIn = useAuthStatus() === 'authenticated';

  useEffect(() => {
    if (!signedIn) return;
    reportDeviceHealth();

    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') reportDeviceHealth();
    });

    // Only the slices a report is built from, so an arriving step count does
    // not cost a comparison — today's steps ride along with whatever else
    // is sent rather than being a reason to send.
    let previous = healthSlice();
    const unsubscribe = useStepsStore.subscribe(() => {
      const next = healthSlice();
      if (next === previous) return;
      previous = next;
      reportDeviceHealth();
    });

    return () => {
      appState.remove();
      unsubscribe();
    };
  }, [signedIn]);
}

/** The tracker's health-bearing state as one comparable string. */
function healthSlice(): string {
  const { trackingState, trackingWanted, trackingHealth, healthConnect, syncStatus, syncError } =
    useStepsStore.getState();
  return JSON.stringify([
    trackingState,
    trackingWanted,
    trackingHealth?.looksDead ?? null,
    trackingHealth?.recoveryCount ?? null,
    healthConnect?.availability ?? null,
    healthConnect?.canRead ?? null,
    syncStatus,
    syncError,
  ]);
}
