import { PermissionsAndroid, Platform } from 'react-native';
import {
  AuthorizationStatus,
  getInitialNotification,
  getMessaging,
  getToken,
  hasPermission,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import { useNotificationsStore } from '../stores/notificationsStore';
import { logger } from '../utils/logger';
import { deviceApi } from './api/endpoints';
import { toApiError } from './api/errors';
import { getDeviceId } from './device';
import {
  displayPushNotification,
  ensureDefaultChannel,
  recordNotificationTap,
  routeForTopic,
} from './notifications';
import { syncStepsInBackground } from './steps';

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

/**
 * Whether the OS shows this app's notifications now — asked of nobody. On
 * Android before 13 they need no permission; from 13 the runtime one says;
 * iOS answers through Firebase without a dialog.
 */
export async function notificationsAllowed(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      return (
        Platform.Version < 33 ||
        (await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        ))
      );
    }
    const status = await hasPermission(getMessaging());
    return (
      status === AuthorizationStatus.AUTHORIZED ||
      status === AuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
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
 * Hands the device's FCM token to the server (`PATCH /devices/:id
 * { pushToken }`) — which is where a message for this user is actually
 * addressed. Called whenever a session and a device registration exist, and
 * then it only checks: the asking is the notification screen's, after
 * sign-in (`ask`), where the user has been told what the notifications are
 * for before the system dialog appears.
 *
 * **The token goes up whether or not notifications are allowed**, and the
 * answer about notifications is what this returns. The two are different
 * questions: a data-only message (the server's silent "sync now" ping,
 * RULES A28) shows nothing and needs no permission to arrive, and the steps
 * a phone has been holding are worth sending for somebody who said no to
 * being notified. Consent governs what may be *shown*, and it is honoured
 * where that decision is made — the server will not push a message to an
 * install whose notifications are refused (`pushRow`), so a refusal still
 * means feed rows only.
 *
 * On iOS a refusal means no token either: FCM cannot mint one without APNs,
 * which needs the permission. That is the platform's rule, not ours, and it
 * costs nothing here — counting is Android-only.
 *
 * Firebase rotates tokens; the listener keeps the server current for as
 * long as the app runs.
 */
export async function registerForPush({
  ask = false,
}: { ask?: boolean } = {}): Promise<boolean> {
  try {
    const allowed = ask
      ? await ensurePermission()
      : await notificationsAllowed();
    const messaging = getMessaging();
    const token = await getToken(messaging);
    if (token !== registeredToken) {
      await sendToken(token);
    }
    if (!allowed) {
      logger.info(
        'push',
        'Notifications not permitted; the token stands for the silent sync',
      );
    }
    stopRefreshListener?.();
    stopRefreshListener = onTokenRefresh(messaging, fresh => {
      if (fresh !== registeredToken) {
        sendToken(fresh);
      }
    });
    return allowed;
  } catch (error) {
    // Firebase not configured on this build, an emulator without Play
    // services, a flaky network: none of these should reach the user.
    logger.warn('push', 'Push registration skipped', error);
    return false;
  }
}

/**
 * The notification screen's "Allow": the system dialog, then the token to
 * the server. True when notifications are on afterwards.
 */
export function enablePushNotifications(): Promise<boolean> {
  return registerForPush({ ask: true });
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

/** What arrives from FCM, in the shape this module reads it. */
interface PushMessage {
  notification?: { title?: string; body?: string };
  data?: Record<string, unknown>;
}

/** Whether a message is the server's silent "sync now" ping (RULES A28). */
const isSyncPing = (message: PushMessage) => message.data?.type === 'activity_sync';

/**
 * Everything that happens to a push while the app is running (RULES A28, P13).
 *
 * Three things the OS will not do for us:
 *
 * - **Foreground**: Android draws an FCM notification itself only while the
 *   app is in the background. In the foreground the message comes here and
 *   nothing appears, so it is drawn with notifee instead.
 * - **The bell**: a push means a feed row was written on the server a moment
 *   ago, so the notification centre is re-read and the unread dot catches up
 *   without the member opening anything.
 * - **The tap**: a notification opened from the background or from a cold
 *   start has to navigate somewhere, and the route waits for the navigator
 *   (`recordNotificationTap`).
 *
 * Returns what stops it. Mounted once, from the root navigator.
 */
export function startPushHandling(): () => void {
  ensureDefaultChannel();
  const stops: (() => void)[] = [];
  // Firebase may not exist on this build at all — an emulator without Play
  // services, a fork with no `google-services.json` — and a launch must not
  // fail over a channel nobody can deliver on. Whatever did register is
  // still returned, so it can be stopped.
  try {
    const messaging = getMessaging();
    stops.push(
      onMessage(messaging, async (message: PushMessage) => {
        if (isSyncPing(message)) {
          await handleBackgroundMessage(message);
          return;
        }
        await displayPushNotification(message);
        refreshFeed();
      }),
      // Tapped while the app was in the background: the OS drew it, so
      // there is nothing to show — only somewhere to go.
      onNotificationOpenedApp(messaging, (message: PushMessage) => {
        openFromPush(message);
      }),
    );
    // And the one the app was opened by, which no listener ever sees.
    getInitialNotification(messaging)
      .then(message => {
        if (message) openFromPush(message as PushMessage);
      })
      .catch(error => logger.warn('push', 'Could not read the opening push', error));
  } catch (error) {
    logger.warn('push', 'Push handling not started', error);
  }

  return () => stops.forEach(stop => stop());
}

function openFromPush(message: PushMessage): void {
  if (isSyncPing(message)) return;
  const topic = message.data?.topic;
  recordNotificationTap(routeForTopic(typeof topic === 'string' ? topic : undefined));
  refreshFeed();
}

/** The feed, re-read because the server has just written a row to it. */
function refreshFeed(): void {
  useNotificationsStore
    .getState()
    .hydrateFromServer()
    .catch(error => logger.warn('push', 'The feed could not be re-read', error));
}

/**
 * A data message the OS woke this app for, with no screen and possibly no
 * app: the background handler Firebase runs headlessly.
 *
 * One kind so far. `activity_sync` is the server saying "you are counting
 * but you have not reported" (⚙ `activity.syncNudge`): steps are counted by
 * a native service with the app closed, but they only ever left the phone
 * from the foreground, so days could age out of the ingest window while the
 * phone sat there with them. The push carries no text and shows nothing —
 * it is a ping, not a message — and the member is told in as many words
 * only after several days, through an ordinary notification.
 *
 * Nothing here may throw: a handler that rejects is logged by Firebase as a
 * failed background task and counts against the app's standing with the OS.
 */
export async function handleBackgroundMessage(message: PushMessage): Promise<void> {
  if (!isSyncPing(message)) {
    // Anything with text in it was drawn by the OS before this ran; the
    // tap, not the delivery, is what this app does about those.
    return;
  }
  try {
    const outcome = await syncStepsInBackground();
    logger.info('push', `Background step sync: ${outcome}`);
  } catch (error) {
    logger.warn('push', 'Background step sync failed', error);
  }
}
