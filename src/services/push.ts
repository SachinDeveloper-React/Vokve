import { PermissionsAndroid, Platform } from 'react-native';
import {
  AuthorizationStatus,
  getMessaging,
  getToken,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import { logger } from '../utils/logger';
import { deviceApi } from './api/endpoints';
import { toApiError } from './api/errors';
import { getDeviceId } from './device';

/** The token the server was last told, so a refresh to the same value is not re-sent. */
let registeredToken: string | null = null;
let stopRefreshListener: (() => void) | null = null;

/**
 * Whether the OS will show this app's notifications. Android 13 gates it
 * behind a runtime permission of its own; iOS and older Android answer
 * through Firebase's request, which is a no-op where nothing is needed.
 */
async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    if (result !== PermissionsAndroid.RESULTS.GRANTED) {
      return false;
    }
  }
  const status = await requestPermission(getMessaging());
  return (
    status === AuthorizationStatus.AUTHORIZED ||
    status === AuthorizationStatus.PROVISIONAL
  );
}

async function sendToken(token: string | null): Promise<void> {
  const deviceId = getDeviceId();
  if (!deviceId) {
    // No registration yet: the next sign-in registers and calls back here.
    return;
  }
  try {
    await deviceApi.setPushToken(deviceId, token);
    registeredToken = token;
  } catch (error) {
    logger.warn('push', 'Could not send the push token', toApiError(error));
  }
}

/**
 * Asks to be allowed to notify, then hands the device's FCM token to the
 * server (`PATCH /devices/:id { pushToken }`) — which is where a push for
 * this user is actually addressed. Called once a session and a device
 * registration exist; a refusal is respected and simply leaves the server
 * with no token for this device, so it writes feed rows only.
 *
 * Firebase rotates tokens; the listener keeps the server current for as
 * long as the app runs.
 */
export async function registerForPush(): Promise<boolean> {
  try {
    const allowed = await ensurePermission();
    if (!allowed) {
      logger.info('push', 'Notifications not permitted; feed only');
      return false;
    }
    const messaging = getMessaging();
    const token = await getToken(messaging);
    if (token !== registeredToken) {
      await sendToken(token);
    }
    stopRefreshListener?.();
    stopRefreshListener = onTokenRefresh(messaging, fresh => {
      if (fresh !== registeredToken) {
        sendToken(fresh);
      }
    });
    return true;
  } catch (error) {
    // Firebase not configured on this build, an emulator without Play
    // services, a flaky network: none of these should reach the user.
    logger.warn('push', 'Push registration skipped', error);
    return false;
  }
}

/**
 * Withdraws the token on sign-out, so the next person on this phone does
 * not receive the last one's pushes. The listener stops with it.
 */
export async function unregisterFromPush(): Promise<void> {
  stopRefreshListener?.();
  stopRefreshListener = null;
  if (registeredToken !== null) {
    await sendToken(null);
    registeredToken = null;
  }
}
