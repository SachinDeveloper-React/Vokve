import { useEffect } from 'react';
import { AppState } from 'react-native';
import { OTA_UPDATE_STRATEGY, otaUpdater } from '../services/otaUpdates';
import { logger } from '../utils/logger';

/** The least time between two checks on returning to the app. */
export const OTA_CHECK_INTERVAL_MS = 15 * 60_000;

/**
 * Looks for an over-the-air update (D-111) on launch and on returns to the
 * foreground, at most every quarter of an hour.
 *
 * An ordinary update downloads in the background and is used from the next
 * launch: swapping the JavaScript under a member mid-screen loses whatever
 * they were doing. One deployed as forced (`deploy -f`) — a fix that cannot
 * wait — reloads the app as soon as it has downloaded.
 *
 * Off in development (Metro serves the bundle) and until OTA is configured.
 * Never gated on the session, maintenance or the update wall: an update may
 * be the fix for whichever of those a member is looking at.
 */
export function useOtaUpdates(): void {
  useEffect(() => {
    const updater = otaUpdater;
    if (!updater || __DEV__) {
      return;
    }
    let lastCheck = 0;
    let checking = false;

    const check = async () => {
      if (checking || Date.now() - lastCheck < OTA_CHECK_INTERVAL_MS) {
        return;
      }
      checking = true;
      lastCheck = Date.now();
      try {
        // Null for "nothing newer" and for a failed check alike; the
        // failure has already gone to `onError`.
        const update = await updater.checkForUpdate({
          updateStrategy: OTA_UPDATE_STRATEGY,
        });
        if (!update) {
          return;
        }
        const downloaded = await update.updateBundle();
        if (downloaded && update.shouldForceUpdate) {
          await updater.reload();
        }
      } catch (error) {
        logger.warn('useOtaUpdates', 'Over-the-air update failed', error);
      } finally {
        checking = false;
      }
    };

    check();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        check();
      }
    });
    return () => subscription.remove();
  }, []);
}
