/**
 * Push registration is what turns a server-side notification into one on
 * the phone, so the checks here are that the token reaches the server on
 * the right device even when notifications are refused — the token is what
 * the server's silent sync ping is addressed to, and consent is enforced
 * where a message is sent rather than by withholding it — that a rotated
 * token is re-sent and an unchanged one is not, and that sign-out withdraws
 * it so the next person on the phone hears nothing of the last. The system
 * dialog is the notification screen's to show, after sign-in (D-54): the
 * sign-in itself only checks.
 *
 * @format
 */

jest.mock('../src/services/api/endpoints', () => ({
  deviceApi: { register: jest.fn(), setPushToken: jest.fn() },
}));
jest.mock('../src/services/device', () => ({
  getDeviceId: jest.fn(),
}));
// The headless sync is the steps service's, and has its own checks; here
// what matters is only whether a data message reaches it.
jest.mock('../src/services/steps', () => ({
  syncStepsInBackground: jest.fn(async () => 'sent'),
}));

import { Platform } from 'react-native';
import notifee from '@notifee/react-native';
import {
  AuthorizationStatus,
  getInitialNotification,
  getToken,
  hasPermission,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import {
  enablePushNotifications,
  handleBackgroundMessage,
  registerForPush,
  startPushHandling,
  unregisterFromPush,
} from '../src/services/push';
import { getDeviceId } from '../src/services/device';
import { takePendingNotificationRoute } from '../src/services/notifications';
import { syncStepsInBackground } from '../src/services/steps';
import { useNotificationsStore } from '../src/stores/notificationsStore';

const { deviceApi } = jest.requireMock('../src/services/api/endpoints') as {
  deviceApi: { setPushToken: jest.Mock };
};

beforeEach(async () => {
  // A clean slate: whatever the last test registered is withdrawn.
  deviceApi.setPushToken.mockReset().mockResolvedValue({ ok: true });
  await unregisterFromPush();
  deviceApi.setPushToken.mockClear();
  (getDeviceId as jest.Mock).mockReturnValue('dev_1');
  (getToken as jest.Mock).mockResolvedValue('fcm-test-token');
  (requestPermission as jest.Mock)
    .mockClear()
    .mockResolvedValue(AuthorizationStatus.AUTHORIZED);
  (hasPermission as jest.Mock).mockResolvedValue(
    AuthorizationStatus.AUTHORIZED,
  );
  (onTokenRefresh as jest.Mock).mockReset().mockReturnValue(jest.fn());
});

test('hands the token to the server for this device, once', async () => {
  expect(await registerForPush()).toBe(true);
  expect(deviceApi.setPushToken).toHaveBeenCalledWith(
    'dev_1',
    'fcm-test-token',
  );

  // The same token again is not re-sent.
  await registerForPush();
  expect(deviceApi.setPushToken).toHaveBeenCalledTimes(1);
});

test('a refusal is answered honestly — and the token still goes up', async () => {
  (requestPermission as jest.Mock).mockResolvedValue(
    AuthorizationStatus.DENIED,
  );

  // The caller is told no, so the screen can say so.
  expect(await enablePushNotifications()).toBe(false);
  // But the token is how the server's silent "sync now" ping reaches this
  // phone (RULES A28), and that shows nothing. Somebody who does not want
  // to be notified should still be paid for the steps their phone is
  // holding. Whether a *message* may be shown is the server's to honour.
  expect(deviceApi.setPushToken).toHaveBeenCalledWith('dev_1', 'fcm-test-token');
});

test('signing in only checks: no dialog, and the token goes up either way', async () => {
  (hasPermission as jest.Mock).mockResolvedValue(
    AuthorizationStatus.NOT_DETERMINED,
  );

  expect(await registerForPush()).toBe(false);
  expect(requestPermission).not.toHaveBeenCalled();
  expect(deviceApi.setPushToken).toHaveBeenCalledWith('dev_1', 'fcm-test-token');
});

test('the notification screen asks, then hands the token over', async () => {
  (hasPermission as jest.Mock).mockResolvedValue(
    AuthorizationStatus.NOT_DETERMINED,
  );

  expect(await enablePushNotifications()).toBe(true);
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(deviceApi.setPushToken).toHaveBeenCalledWith(
    'dev_1',
    'fcm-test-token',
  );
});

test('a rotated token is re-sent; the same one is not', async () => {
  await registerForPush();
  const listener = (onTokenRefresh as jest.Mock).mock.calls[0][1] as (
    token: string,
  ) => void;

  listener('fcm-test-token');
  await new Promise(resolve => setImmediate(resolve));
  expect(deviceApi.setPushToken).toHaveBeenCalledTimes(1);

  listener('fcm-rotated');
  await new Promise(resolve => setImmediate(resolve));
  expect(deviceApi.setPushToken).toHaveBeenLastCalledWith(
    'dev_1',
    'fcm-rotated',
  );
});

test('sign-out withdraws the token and stops listening', async () => {
  const stop = jest.fn();
  (onTokenRefresh as jest.Mock).mockReturnValue(stop);
  await registerForPush();

  await unregisterFromPush();

  expect(stop).toHaveBeenCalled();
  expect(deviceApi.setPushToken).toHaveBeenLastCalledWith('dev_1', null);
});

test('without a registered device there is nothing to attach the token to', async () => {
  (getDeviceId as jest.Mock).mockReturnValue(null);

  await registerForPush();

  expect(deviceApi.setPushToken).not.toHaveBeenCalled();
});

test('a Firebase that is not set up on this build is not an error the user sees', async () => {
  (getToken as jest.Mock).mockRejectedValue(new Error('No Firebase App'));

  expect(await registerForPush()).toBe(false);
});

describe('the server’s silent “sync now” message (A28)', () => {
  const sync = syncStepsInBackground as jest.Mock;

  beforeEach(() => sync.mockClear().mockResolvedValue('sent'));

  test('an activity_sync message sends the days the phone has been holding', async () => {
    await handleBackgroundMessage({ data: { type: 'activity_sync' } });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  test('every other message is left to the tray', async () => {
    await handleBackgroundMessage({ data: { type: 'coins', notificationId: 'ntf_1' } });
    await handleBackgroundMessage({});
    expect(sync).not.toHaveBeenCalled();
  });

  test('a sync that fails is not an error the OS sees', async () => {
    sync.mockRejectedValue(new Error('offline'));
    // A rejected handler counts against the app's standing with the OS, and
    // there is nobody to tell: the next nudge tries again.
    await expect(
      handleBackgroundMessage({ data: { type: 'activity_sync' } }),
    ).resolves.toBeUndefined();
  });
});

describe('a push while the app is running (A28, P13)', () => {
  const sync = syncStepsInBackground as jest.Mock;
  const display = notifee.displayNotification as jest.Mock;
  const createChannel = notifee.createChannel as jest.Mock;
  let feed: jest.Mock;

  /** The handler `startPushHandling` gave to each of the three channels. */
  const handlers = () => ({
    foreground: (onMessage as jest.Mock).mock.calls[0][1] as (m: unknown) => Promise<void>,
    tapped: (onNotificationOpenedApp as jest.Mock).mock.calls[0][1] as (m: unknown) => void,
  });

  const coinsPush = {
    notification: { title: 'You earned 28 coins', body: 'From yesterday’s walk.' },
    data: { topic: 'coins', notificationId: 'ntf_1' },
  };

  beforeEach(() => {
    sync.mockClear().mockResolvedValue('session');
    display.mockClear();
    createChannel.mockClear();
    (onMessage as jest.Mock).mockClear().mockReturnValue(jest.fn());
    (onNotificationOpenedApp as jest.Mock).mockClear().mockReturnValue(jest.fn());
    (getInitialNotification as jest.Mock).mockClear().mockResolvedValue(null);
    feed = jest.fn().mockResolvedValue(undefined);
    useNotificationsStore.setState({ hydrateFromServer: feed });
    takePendingNotificationRoute();
  });

  test('creates the channel the server addresses, and listens on all three channels', async () => {
    // The channel is Android's; on iOS there is nothing to create.
    jest.replaceProperty(Platform, 'OS', 'android');
    const stop = startPushHandling();

    // Android 8+ shows nothing on a channel that does not exist, and the id
    // is a contract with the server and with firebase.json.
    expect(createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'vokve.default' }),
    );
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onNotificationOpenedApp).toHaveBeenCalledTimes(1);
    expect(getInitialNotification).toHaveBeenCalledTimes(1);
    stop();
    jest.restoreAllMocks();
  });

  test('shows a push the OS would not have shown, and catches the bell up', async () => {
    startPushHandling();
    await handlers().foreground(coinsPush);

    // In the foreground Android hands the message over instead of drawing
    // it, so nothing would appear at all without this.
    expect(display).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'You earned 28 coins',
        body: 'From yesterday’s walk.',
        data: { topic: 'coins', notificationId: 'ntf_1' },
        android: expect.objectContaining({ channelId: 'vokve.default' }),
      }),
    );
    // A push means a feed row was written a moment ago.
    expect(feed).toHaveBeenCalled();
  });

  test('the silent sync ping is not drawn, it is answered', async () => {
    startPushHandling();
    await handlers().foreground({ data: { type: 'activity_sync' } });

    expect(display).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  test('a tap from the background goes where the topic says, and nothing is drawn twice', () => {
    startPushHandling();
    handlers().tapped(coinsPush);

    // The wallet is a tab, so it is reached through Main rather than pushed.
    expect(takePendingNotificationRoute()).toEqual({ kind: 'tab', name: 'Wallet' });
    // The OS already drew this one.
    expect(display).not.toHaveBeenCalled();
  });

  test('a topic this build has never heard of lands on the feed, not nowhere', () => {
    startPushHandling();
    handlers().tapped({ notification: { title: 'New' }, data: { topic: 'tournament' } });

    expect(takePendingNotificationRoute()).toEqual({ kind: 'screen', name: 'Notifications' });
  });

  test('the notification the app was opened by is read once, and routed', async () => {
    (getInitialNotification as jest.Mock).mockResolvedValue({
      notification: { title: 'Challenge over' },
      data: { topic: 'challenge' },
    });

    startPushHandling();
    await new Promise(resolve => setImmediate(resolve));

    expect(takePendingNotificationRoute()).toEqual({ kind: 'screen', name: 'Challenges' });
  });

  test('a build with no Firebase starts nothing and throws nothing', () => {
    (onMessage as jest.Mock).mockImplementation(() => {
      throw new Error('no firebase');
    });

    expect(() => startPushHandling()()).not.toThrow();
  });
});
