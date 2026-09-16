/**
 * Push registration is what turns a server-side notification into one on
 * the phone, so the checks here are that the token reaches the server on
 * the right device, that a refusal is respected and reaches nobody, that a
 * rotated token is re-sent and an unchanged one is not, and that sign-out
 * withdraws it so the next person on the phone hears nothing of the last.
 *
 * @format
 */

jest.mock('../src/services/api/endpoints', () => ({
  deviceApi: { register: jest.fn(), setPushToken: jest.fn() },
}));
jest.mock('../src/services/device', () => ({
  getDeviceId: jest.fn(),
}));

import {
  AuthorizationStatus,
  getToken,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import { registerForPush, unregisterFromPush } from '../src/services/push';
import { getDeviceId } from '../src/services/device';

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
  (requestPermission as jest.Mock).mockResolvedValue(
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

test('a refusal is respected: nothing is sent, and the caller is told', async () => {
  (requestPermission as jest.Mock).mockResolvedValue(
    AuthorizationStatus.DENIED,
  );

  expect(await registerForPush()).toBe(false);
  expect(deviceApi.setPushToken).not.toHaveBeenCalled();
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
