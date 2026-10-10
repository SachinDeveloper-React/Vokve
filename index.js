/**
 * @format
 */

import { AppRegistry } from 'react-native';
import notifee from '@notifee/react-native';
import App from './App';
import { handleReminderBackgroundEvent } from './src/services/notifications';
import { name as appName } from './app.json';

/**
 * A hydration reminder tapped while the app is in the background is handled
 * here, before any component exists: by the time one could mount, the event
 * has been and gone. The handler only notes where the tap wants to go; the
 * navigator takes it when the app comes forward.
 */
notifee.onBackgroundEvent(handleReminderBackgroundEvent);

AppRegistry.registerComponent(appName, () => App);
