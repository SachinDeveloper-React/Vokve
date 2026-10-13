/**
 * The trail on its way to the server (PRD ADV2): queued, kept across
 * launches, sent in batches, and never at the cost of anything on screen.
 *
 * @format
 */

import { getMMKV } from '../src/stores';
import { ApiError } from '../src/services/api/errors';

jest.mock('../src/services/api/endpoints', () => ({
  ...jest.requireActual('../src/services/api/endpoints'),
  telemetryApi: { sendEvents: jest.fn(), reportPermissions: jest.fn(), permissions: jest.fn() },
}));

jest.mock('../src/services/device', () => ({
  ...jest.requireActual('../src/services/device'),
  getDeviceId: jest.fn(() => 'dev_test'),
}));

const { telemetryApi } = jest.requireMock('../src/services/api/endpoints') as {
  telemetryApi: { sendEvents: jest.Mock };
};
const { getDeviceId } = jest.requireMock('../src/services/device') as {
  getDeviceId: jest.Mock;
};

const {
  analyticsInternals,
  flushEvents,
  setAnalyticsAllowed,
  setAnalyticsIdentity,
  track,
  trackScreen,
} = require('../src/services/analytics') as typeof import('../src/services/analytics');

beforeEach(() => {
  jest.useFakeTimers();
  analyticsInternals.reset();
  telemetryApi.sendEvents.mockResolvedValue({ accepted: 1 });
  getDeviceId.mockReturnValue('dev_test');
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
});

test('nothing is queued before anyone is signed in — there is no account to attribute it to', () => {
  track('water_logged', { ml: 250 });
  expect(analyticsInternals.queued()).toHaveLength(0);
});

test('a signed-in member opens the app, and the launch is the first row', () => {
  setAnalyticsIdentity('usr_1');
  const [open] = analyticsInternals.queued();
  expect(open.name).toBe('app_open');
  expect(open.sessionId).toBeTruthy();
});

test('a screen view carries the screen, and the one before it with its dwell time', () => {
  setAnalyticsIdentity('usr_1');
  trackScreen('Home');
  jest.advanceTimersByTime(4_000);
  trackScreen('Shop', { category: 'gym' });

  const views = analyticsInternals
    .queued()
    .filter(event => event.name === 'screen_view');
  expect(views[0].props).toEqual({ screen: 'Home' });
  expect(views[1].props).toMatchObject({
    screen: 'Shop',
    from: 'Home',
    category: 'gym',
  });
  expect(views[1].props?.fromDurationMs).toBeGreaterThanOrEqual(4_000);
});

test('the same screen twice in a row is one view — a re-render is not a visit', () => {
  setAnalyticsIdentity('usr_1');
  trackScreen('Home');
  trackScreen('Home');
  expect(
    analyticsInternals.queued().filter(e => e.name === 'screen_view'),
  ).toHaveLength(1);
});

test('a lone event waits for company, then goes', async () => {
  setAnalyticsIdentity('usr_1');
  await flushEvents();
  telemetryApi.sendEvents.mockClear();

  track('water_logged', { ml: 250 });
  expect(telemetryApi.sendEvents).not.toHaveBeenCalled();

  jest.advanceTimersByTime(15_000);
  await Promise.resolve();
  await Promise.resolve();
  expect(telemetryApi.sendEvents).toHaveBeenCalledTimes(1);
  expect(analyticsInternals.queued()).toHaveLength(0);
});

test('a queue that reaches twenty is sent at once, without waiting', async () => {
  setAnalyticsIdentity('usr_1');
  await flushEvents();
  telemetryApi.sendEvents.mockClear();

  for (let i = 0; i < 20; i += 1) {
    track('water_logged', { ml: 250 });
  }
  await Promise.resolve();
  await Promise.resolve();
  expect(telemetryApi.sendEvents).toHaveBeenCalledTimes(1);
  expect(telemetryApi.sendEvents.mock.calls[0][0]).toHaveLength(20);
});

test('an unreachable server keeps the batch for the next flush', async () => {
  setAnalyticsIdentity('usr_1');
  telemetryApi.sendEvents.mockRejectedValue(
    new ApiError('network', 'No connection'),
  );
  track('water_logged', { ml: 250 });
  await flushEvents();
  expect(analyticsInternals.queued().length).toBeGreaterThan(0);

  telemetryApi.sendEvents.mockResolvedValue({ accepted: 2 });
  await flushEvents();
  expect(analyticsInternals.queued()).toHaveLength(0);
});

test('a batch the server refuses outright is dropped, not retried forever', async () => {
  setAnalyticsIdentity('usr_1');
  telemetryApi.sendEvents.mockRejectedValue(
    new ApiError('validation', 'Check the highlighted fields.', 422),
  );
  track('water_logged', { ml: 250 });
  await flushEvents();
  expect(analyticsInternals.queued()).toHaveLength(0);
});

test('an install with no registered device keeps everything until there is one', async () => {
  getDeviceId.mockReturnValue(null);
  setAnalyticsIdentity('usr_1');
  track('water_logged', { ml: 250 });
  await flushEvents();
  expect(telemetryApi.sendEvents).not.toHaveBeenCalled();
  expect(analyticsInternals.queued().length).toBeGreaterThan(0);
});

test('the queue outlives the process — it is kept in storage as it is written', () => {
  setAnalyticsIdentity('usr_1');
  track('water_logged', { ml: 250 });
  const stored = JSON.parse(getMMKV().getString('vokve.events.queue') ?? '[]');
  expect(stored.map((event: { name: string }) => event.name)).toEqual([
    'app_open',
    'water_logged',
  ]);
});

test('switching usage analytics off drops what was queued and queues nothing more (RULES P7)', () => {
  setAnalyticsIdentity('usr_1');
  track('water_logged', { ml: 250 });
  setAnalyticsAllowed(false);
  expect(analyticsInternals.queued()).toHaveLength(0);

  track('water_logged', { ml: 500 });
  expect(analyticsInternals.queued()).toHaveLength(0);

  setAnalyticsAllowed(true);
  track('water_logged', { ml: 500 });
  expect(analyticsInternals.queued()).toHaveLength(1);
});

test('signing out sends what is left, and nothing after it is attributed to them', async () => {
  setAnalyticsIdentity('usr_1');
  track('water_logged', { ml: 250 });
  await flushEvents();
  expect(telemetryApi.sendEvents).toHaveBeenCalled();

  setAnalyticsIdentity(null);
  track('water_logged', { ml: 250 });
  expect(analyticsInternals.queued()).toHaveLength(0);
});
