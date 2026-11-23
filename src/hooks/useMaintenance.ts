import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { appApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import { noteMaintenance, useAppStatusStore } from '../stores/appStatusStore';
import { useAuthStore } from '../stores/authStore';
import { logger } from '../utils/logger';

/** How often a phone in maintenance — on the screen, or a tester's with the strip — asks whether it is over. */
export const MAINTENANCE_POLL_MS = 30_000;
/** The least time between two foreground checks, so flicking between apps is not a poll loop. */
const MIN_FOREGROUND_INTERVAL_MS = 15_000;

/**
 * Asks the server whether the app is in maintenance (`GET /app/status`,
 * RULES DV14) and puts the answer in the app-status store.
 *
 * When maintenance has just ended, the session is confirmed again if it
 * could not be while the server was refusing: a launch during maintenance
 * opens on the stored snapshot (or the connection screen), and nothing else
 * would ask before the next foreground.
 *
 * A failure changes nothing. Offline, the app carries on as it is, and a
 * server in maintenance says so again on the next request.
 */
export async function checkMaintenance(): Promise<void> {
  const wasOn = useAppStatusStore.getState().maintenance !== null;
  try {
    const { maintenance } = await appApi.status();
    noteMaintenance(maintenance);
    if (wasOn && !maintenance.active) {
      const auth = useAuthStore.getState();
      if (
        !auth.isSubmitting &&
        (auth.status === 'unreachable' || auth.isSessionUnconfirmed)
      ) {
        auth.hydrate();
      }
    }
  } catch (error) {
    logger.debug(
      'useMaintenance',
      'Maintenance check skipped',
      toApiError(error),
    );
  }
}

/**
 * Keeps the maintenance state current: on launch, whenever the session
 * changes (signing in or out decides whether this phone is let through), on
 * every return to the foreground, and every half minute while maintenance is
 * on — which is how the screen lifts by itself, and the strip goes.
 */
export function useMaintenance(): void {
  const authStatus = useAuthStore(s => s.status);
  const active = useAppStatusStore(s => s.maintenance !== null);
  const lastForeground = useRef(0);

  useEffect(() => {
    checkMaintenance();
  }, [authStatus]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      const now = Date.now();
      if (now - lastForeground.current < MIN_FOREGROUND_INTERVAL_MS) return;
      lastForeground.current = now;
      checkMaintenance();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') checkMaintenance();
    }, MAINTENANCE_POLL_MS);
    return () => clearInterval(timer);
  }, [active]);
}
