/**
 * The device-health report is the answer to "my steps are not counting",
 * which is the commonest thing support is asked. So the checks here are
 * that the report actually carries what decides that question — a service
 * an OEM killed, a Health Connect grant withdrawn, a sync that keeps
 * failing — and that it is diffed, because a phone that is fine must not
 * spend a request on saying so every time somebody opens the app.
 *
 * @format
 */

jest.mock('../src/services/api/endpoints', () => ({
  telemetryApi: { reportDeviceHealth: jest.fn() },
}));
jest.mock('../src/services/device', () => ({ getDeviceId: jest.fn() }));

import StepTracker from 'react-native-step-tracker-pro';
import {
  collectDeviceHealth,
  reportDeviceHealth,
} from '../src/services/deviceHealth';
import { getDeviceId } from '../src/services/device';
import { getMMKV } from '../src/stores';
import { useStepsStore } from '../src/stores/stepsStore';

const { telemetryApi } = jest.requireMock('../src/services/api/endpoints') as {
  telemetryApi: { reportDeviceHealth: jest.Mock };
};
const tracker = StepTracker as unknown as Record<string, jest.Mock>;

const DEAD_SERVICE = {
  serviceAlive: false,
  shouldBeRunning: true,
  looksDead: true,
  lastHeartbeatAt: Date.now() - 5_400_000,
  heartbeatAgeMs: 5_400_000,
  lastSensorEventAt: null,
  lastRecoveryAt: Date.now() - 600_000,
  lastRecoveryReason: 'watchdog',
  recoveryCount: 4,
  batteryOptimizationEnabled: true,
  aggressiveOem: true,
  manufacturer: 'Xiaomi',
};

const INITIAL = useStepsStore.getState();

beforeEach(() => {
  getMMKV().remove('vokve.deviceHealth.sent');
  useStepsStore.setState(INITIAL, true);
  telemetryApi.reportDeviceHealth.mockReset().mockResolvedValue({
    deviceId: 'dev_1',
    at: new Date().toISOString(),
  });
  (getDeviceId as jest.Mock).mockReturnValue('dev_1');
  tracker.getTrackingHealth.mockResolvedValue(DEAD_SERVICE);
});

test('carries the three things that decide why steps are not counting', async () => {
  useStepsStore.setState({
    trackingState: 'running',
    trackingWanted: true,
    syncStatus: 'failed',
    syncError: 'No connection.',
    lastSyncedAt: Date.parse('2026-10-14T06:00:00.000Z'),
    queue: ['2026-10-13', '2026-10-14'],
    healthConnect: {
      availability: 'installed',
      canRead: false,
      canWrite: false,
      grantedReadTypes: [],
    } as never,
    today: { steps: 4120 } as never,
  });

  const report = await collectDeviceHealth();

  expect(report.tracking).toMatchObject({
    state: 'running',
    wanted: true,
    // The service the member started is not there any more.
    looksDead: true,
    recoveryCount: 4,
    batteryOptimizationEnabled: true,
    aggressiveOem: true,
    manufacturer: 'Xiaomi',
  });
  expect(report.healthConnect).toMatchObject({ availability: 'installed', canRead: false });
  expect(report.sync).toMatchObject({
    status: 'failed',
    error: 'No connection.',
    queued: 2,
    lastSyncedAt: '2026-10-14T06:00:00.000Z',
    // What the phone shows, for "it says 4,120 and the server has nothing".
    todaySteps: 4120,
  });
});

test('a tracker that will not answer still reports the rest', async () => {
  tracker.getTrackingHealth.mockRejectedValue(new Error('no service'));
  useStepsStore.setState({ trackingState: 'stopped', syncStatus: 'idle' });

  const report = await collectDeviceHealth();

  expect(report.tracking).toEqual({ state: 'stopped', wanted: false });
  expect(report.sync?.status).toBe('idle');
});

test('an unchanged phone says nothing the second time', async () => {
  await reportDeviceHealth();
  expect(telemetryApi.reportDeviceHealth).toHaveBeenCalledTimes(1);

  await reportDeviceHealth();
  expect(telemetryApi.reportDeviceHealth).toHaveBeenCalledTimes(1);
});

test('a service that has just died says so at once', async () => {
  tracker.getTrackingHealth.mockResolvedValue({ ...DEAD_SERVICE, looksDead: false, serviceAlive: true });
  await reportDeviceHealth();
  expect(telemetryApi.reportDeviceHealth).toHaveBeenCalledTimes(1);

  tracker.getTrackingHealth.mockResolvedValue(DEAD_SERVICE);
  await reportDeviceHealth();
  expect(telemetryApi.reportDeviceHealth).toHaveBeenCalledTimes(2);
});

test('a step count moving is not news', async () => {
  useStepsStore.setState({ today: { steps: 100 } as never });
  await reportDeviceHealth();

  useStepsStore.setState({ today: { steps: 9000 } as never });
  await reportDeviceHealth();

  // Walking is not a health change; the count rides along with the next
  // report that has something to say.
  expect(telemetryApi.reportDeviceHealth).toHaveBeenCalledTimes(1);
});

test('nothing is sent before the phone is registered', async () => {
  (getDeviceId as jest.Mock).mockReturnValue(null);

  await reportDeviceHealth();

  expect(telemetryApi.reportDeviceHealth).not.toHaveBeenCalled();
});

test('a server that refuses it is not an error anybody sees', async () => {
  telemetryApi.reportDeviceHealth.mockRejectedValue(new Error('offline'));

  await expect(reportDeviceHealth()).resolves.toBeUndefined();
});
