/**
 * What the phone lets the app do, as the server is told it (RULES P11):
 * read without asking anybody, sent only when it changes, and never a
 * reason for anything on screen to fail.
 *
 * @format
 */

import { PermissionsAndroid, Platform } from 'react-native';
import { hasPermission } from '@react-native-firebase/messaging';
import { getMMKV } from '../src/stores';
import { useStepsStore } from '../src/stores/stepsStore';
import { ApiError } from '../src/services/api/errors';
import type { HealthConnectStatus } from 'react-native-step-tracker-pro';

jest.mock('../src/services/api/endpoints', () => ({
  ...jest.requireActual('../src/services/api/endpoints'),
  telemetryApi: {
    sendEvents: jest.fn(),
    reportPermissions: jest.fn(),
    permissions: jest.fn(),
  },
  activityApi: { goal: jest.fn() },
}));

jest.mock('../src/services/device', () => ({
  ...jest.requireActual('../src/services/device'),
  getDeviceId: jest.fn(() => 'dev_test'),
}));

const { telemetryApi } = jest.requireMock('../src/services/api/endpoints') as {
  telemetryApi: { reportPermissions: jest.Mock };
};
const { getDeviceId } = jest.requireMock('../src/services/device') as {
  getDeviceId: jest.Mock;
};

const {
  collectPermissions,
  reportPermissions,
} = require('../src/services/permissions') as typeof import('../src/services/permissions');

/** What one key says, for a readable assertion. */
const stateOf = (
  entries: Awaited<ReturnType<typeof collectPermissions>>,
  key: string,
) => entries.find(entry => entry.key === key)?.state;

const healthConnect = (
  overrides: Partial<HealthConnectStatus> = {},
): HealthConnectStatus =>
  ({
    available: true,
    availability: 'available',
    requiresUpdate: false,
    installable: false,
    granted: true,
    readRequired: true,
    writeRequired: true,
    canRead: true,
    canWrite: true,
    stepsGranted: true,
    ...overrides,
  }) as HealthConnectStatus;

beforeEach(() => {
  getMMKV().clearAll();
  getDeviceId.mockReturnValue('dev_test');
  telemetryApi.reportPermissions.mockResolvedValue({
    deviceId: 'dev_test',
    permissions: [],
    updatedAt: new Date().toISOString(),
  });
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34);
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  (hasPermission as jest.Mock).mockResolvedValue(1);
  useStepsStore.setState({
    permissions: null,
    healthConnect: healthConnect(),
    background: {
      manufacturer: 'Xiaomi',
      brand: 'Redmi',
      aggressiveOem: true,
      batteryOptimizationEnabled: true,
      directPromptAvailable: false,
      autoStartSettingsAvailable: true,
    } as never,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test('an Android phone with everything allowed reports every key, granted', async () => {
  const entries = await collectPermissions();
  expect(entries.map(entry => entry.key)).toEqual([
    'activityRecognition',
    'notifications',
    'healthConnectReadSteps',
    'healthConnectWriteSteps',
    'batteryUnrestricted',
    'camera',
    'photos',
  ]);
  expect(stateOf(entries, 'activityRecognition')).toBe('granted');
  expect(stateOf(entries, 'notifications')).toBe('granted');
  expect(stateOf(entries, 'healthConnectReadSteps')).toBe('granted');
  // Battery optimisation still on is exactly the thing support needs told.
  expect(stateOf(entries, 'batteryUnrestricted')).toBe('denied');
  expect(
    entries.find(entry => entry.key === 'batteryUnrestricted')?.detail,
  ).toContain('Xiaomi');
});

test('a refused physical activity permission is reported as refused', async () => {
  jest
    .spyOn(PermissionsAndroid, 'check')
    .mockImplementation(async permission =>
      permission !== PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
    );
  expect(stateOf(await collectPermissions(), 'activityRecognition')).toBe(
    'denied',
  );
});

test('Health Connect missing is unavailable, with which rung it is on', async () => {
  useStepsStore.setState({
    healthConnect: healthConnect({
      availability: 'not_installed',
      available: false,
      canRead: false,
      canWrite: false,
      stepsGranted: false,
    }),
  });
  const entries = await collectPermissions();
  expect(stateOf(entries, 'healthConnectReadSteps')).toBe('unavailable');
  expect(
    entries.find(entry => entry.key === 'healthConnectReadSteps')?.detail,
  ).toBe('not_installed');
});

test('a tracker that has not answered yet is unknown, which is not a refusal', async () => {
  useStepsStore.setState({ healthConnect: null, background: null });
  const entries = await collectPermissions();
  expect(stateOf(entries, 'healthConnectReadSteps')).toBe('unknown');
  expect(stateOf(entries, 'batteryUnrestricted')).toBe('unknown');
});

test('iOS reports the Android-only ones as unavailable rather than leaving them out', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const entries = await collectPermissions();
  expect(stateOf(entries, 'activityRecognition')).toBe('unavailable');
  expect(stateOf(entries, 'healthConnectWriteSteps')).toBe('unavailable');
  expect(stateOf(entries, 'batteryUnrestricted')).toBe('unavailable');
});

test('sent once, then not again while nothing has changed', async () => {
  await reportPermissions();
  expect(telemetryApi.reportPermissions).toHaveBeenCalledTimes(1);
  await reportPermissions();
  expect(telemetryApi.reportPermissions).toHaveBeenCalledTimes(1);
});

test('a permission the member turned off is sent at once', async () => {
  await reportPermissions();
  // Android 13+ answers notifications through its own runtime permission.
  jest
    .spyOn(PermissionsAndroid, 'check')
    .mockImplementation(async permission =>
      permission !== PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  await reportPermissions();
  expect(telemetryApi.reportPermissions).toHaveBeenCalledTimes(2);
  const sent = telemetryApi.reportPermissions.mock.calls[1][0] as {
    key: string;
    state: string;
  }[];
  expect(sent.find(entry => entry.key === 'notifications')?.state).toBe(
    'denied',
  );
});

test('forced past the diff — what a permission screen does once the member has answered', async () => {
  await reportPermissions();
  await reportPermissions({ force: true });
  expect(telemetryApi.reportPermissions).toHaveBeenCalledTimes(2);
});

test('nothing is sent from an install the server does not know yet', async () => {
  getDeviceId.mockReturnValue(null);
  await reportPermissions();
  expect(telemetryApi.reportPermissions).not.toHaveBeenCalled();
});

test('a failed report is not remembered as sent, and never throws', async () => {
  telemetryApi.reportPermissions.mockRejectedValue(
    new ApiError('network', 'No connection'),
  );
  await expect(reportPermissions()).resolves.toBeUndefined();

  telemetryApi.reportPermissions.mockResolvedValue({
    deviceId: 'dev_test',
    permissions: [],
    updatedAt: new Date().toISOString(),
  });
  await reportPermissions();
  expect(telemetryApi.reportPermissions).toHaveBeenCalledTimes(2);
});
