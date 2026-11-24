import { HotUpdater, insights } from '@hot-updater/react-native';
import { config } from '../constants/config';
import { logger } from '../utils/logger';

/**
 * Over-the-air updates (D-111): Hot Updater, on the app's own Firebase
 * project.
 *
 * A release build runs the newest JavaScript bundle downloaded for its own
 * native build (`MainApplication.kt`, `AppDelegate.swift`), or the one it
 * shipped with when there is none. Only JavaScript and assets travel this
 * way — anything native still needs a store release — and `fingerprint`
 * keeps an update off every install whose native code differs from the one
 * it was built against (`hot-updater.config.ts`, `fingerprint.json`).
 *
 * Off until `config.otaBaseUrl` and `config.otaApiKey` are set: then
 * nothing here talks to anybody, and the app runs the bundle inside the
 * build exactly as before.
 */

/** Must match `updateStrategy` in `hot-updater.config.ts`. */
export const OTA_UPDATE_STRATEGY = 'fingerprint' as const;

function createUpdater() {
  if (!config.otaBaseUrl || !config.otaApiKey) {
    return null;
  }
  try {
    return HotUpdater.init({
      baseURL: config.otaBaseUrl,
      requestHeaders: { 'x-api-key': config.otaApiKey },
      // Launches, downloads, applies and rollbacks, reported to the same
      // Function so `npx hot-updater console` shows how far an update has
      // reached. Release builds only, and no member id is attached.
      plugins: [insights()],
      // A check that fails changes nothing: the app keeps the bundle it has
      // and asks again on the next launch or foreground.
      onError: error =>
        logger.warn('otaUpdates', 'Over-the-air update check failed', error),
      onNotifyAppReady: result => {
        // A new bundle that could not get the app to its first screen has
        // been thrown away and the previous one restored. Worth a report:
        // it means an update went out broken.
        if (result.status === 'RECOVERED') {
          logger.error(
            'otaUpdates',
            `Over-the-air update ${result.fromBundleId} failed to launch; back on ${result.toBundleId}`,
          );
        }
      },
    });
  } catch (error) {
    logger.warn('otaUpdates', 'Over-the-air updates are not available', error);
    return null;
  }
}

/**
 * The one instance, made as this module loads — `index.js` imports it bare,
 * first — so it reads this launch before anything renders: that is what lets
 * a bundle that crashes on launch be rolled back on the next one.
 */
export const otaUpdater = createUpdater();

function runningUpdateId(): string | null {
  if (!otaUpdater) {
    return null;
  }
  try {
    const id = otaUpdater.getBundleId();
    // The bundle inside the build answers with the build's own id.
    return id && id !== otaUpdater.getMinBundleId() ? id : null;
  } catch {
    return null;
  }
}

/**
 * The over-the-air update this launch is running, or null for the bundle
 * inside the build. Read once: a bundle downloaded later is not running
 * until the next launch.
 */
export const runningOtaUpdateId = runningUpdateId();
