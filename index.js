/**
 * @format
 */

import { AppRegistry } from 'react-native';
import notifee from '@notifee/react-native';
import {
  getMessaging,
  setBackgroundMessageHandler,
} from '@react-native-firebase/messaging';
import App from './App';
import { handleReminderBackgroundEvent } from './src/services/notifications';
import {
  reportError,
  startErrorReporting,
} from './src/services/errorReporting';
import { handleBackgroundMessage } from './src/services/push';
import { runStepSyncTask } from './src/services/steps';
import { name as appName } from './app.json';

/**
 * A hydration reminder tapped while the app is in the background is handled
 * here, before any component exists: by the time one could mount, the event
 * has been and gone. The handler only notes where the tap wants to go; the
 * navigator takes it when the app comes forward.
 */
notifee.onBackgroundEvent(handleReminderBackgroundEvent);

/**
 * Faults, from the earliest moment there is any JavaScript at all (RULES
 * P17): `logger.error` is forwarded to the crash reporter and to our own
 * server from here on, and a crash the whole bundle could not survive is
 * reported before React Native's own handler takes the app down.
 *
 * Registered here rather than in a component for the usual reason — a crash
 * during startup happens before any component exists, and that is exactly
 * the crash worth having.
 */
startErrorReporting();

const nextHandler = ErrorUtils.getGlobalHandler?.();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  reportError({ kind: 'js', error, scope: 'global', fatal: Boolean(isFatal) });
  // Then whatever React Native was going to do: the red box in development,
  // and the app going down in release. Reporting must not change behaviour.
  nextHandler?.(error, isFatal);
});

/**
 * And the server's silent "sync now" push, which arrives with the app closed
 * and has to be registered here for the same reason — Firebase looks for the
 * handler as the headless task starts, long before `App` mounts.
 *
 * Wrapped because this also runs on builds with no Firebase configured at
 * all: an emulator without Play services, a fork with no
 * `google-services.json`. Registering the handler is not worth a white
 * screen on launch.
 */
try {
  setBackgroundMessageHandler(getMessaging(), handleBackgroundMessage);
} catch (error) {
  console.warn('Background message handler not registered', error);
}

/**
 * The daily step sync Android's own scheduler runs (RULES A28d), the net
 * under the server's silent push: `StepSyncWorker` starts this task by name.
 * Registered here because WorkManager may have started the process for it
 * alone, with no activity and no `App` ever mounted.
 */
AppRegistry.registerHeadlessTask('VokveStepSync', () => runStepSyncTask);

AppRegistry.registerComponent(appName, () => App);
