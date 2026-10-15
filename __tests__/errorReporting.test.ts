/**
 * Error reporting is the one thing that has to work when nothing else does,
 * so the checks here are about exactly that: that an existing
 * `logger.error` call reaches both destinations without its call site
 * changing, that a report queued before anybody is signed in is not lost,
 * that a server which refuses the batch for what it *is* does not have it
 * sent again forever, and that reporting a failure can never become one.
 *
 * @format
 */

jest.mock('../src/services/api/endpoints', () => ({
  telemetryApi: { reportErrors: jest.fn() },
}));
jest.mock('../src/services/device', () => ({ getDeviceId: jest.fn() }));

import { recordError, setUserId } from '@react-native-firebase/crashlytics';
import { ApiError } from '../src/services/api/errors';
import {
  flushErrors,
  reportError,
  setErrorIdentity,
  setErrorScreen,
  startErrorReporting,
} from '../src/services/errorReporting';
import { getDeviceId } from '../src/services/device';
import { getMMKV } from '../src/stores';
import { logger } from '../src/utils/logger';

const { telemetryApi } = jest.requireMock('../src/services/api/endpoints') as {
  telemetryApi: { reportErrors: jest.Mock };
};

/** The one batch the server was handed. */
const sent = () => telemetryApi.reportErrors.mock.calls[0]?.[0] ?? [];

let stopSink: (() => void) | null = null;

beforeEach(() => {
  getMMKV().remove('vokve.errors.queue');
  telemetryApi.reportErrors.mockReset().mockResolvedValue({ accepted: 1 });
  (recordError as jest.Mock).mockClear();
  (setUserId as jest.Mock).mockClear();
  (getDeviceId as jest.Mock).mockReturnValue('dev_1');
  jest.spyOn(console, 'error').mockImplementation(() => {});
  setErrorIdentity('user_a', { sessionId: 'ses_1' });
  setErrorScreen('StepTracking');
});

afterEach(async () => {
  stopSink?.();
  stopSink = null;
  setErrorIdentity(null);
  await flushErrors();
  jest.restoreAllMocks();
});

test('an existing logger.error reaches Crashlytics and the server, with no call site changed', async () => {
  stopSink = startErrorReporting();

  logger.error('steps', 'Steps could not be synced', new ApiError('network', 'Offline'));
  await flushErrors();

  // Crashlytics gets the error itself, named by the scope so one TypeError
  // tells itself apart from another.
  expect(recordError).toHaveBeenCalledTimes(1);
  expect((recordError as jest.Mock).mock.calls[0][2]).toContain('steps');

  expect(sent()).toHaveLength(1);
  expect(sent()[0]).toMatchObject({
    kind: 'js',
    scope: 'steps',
    message: 'Offline',
    screen: 'StepTracking',
    sessionId: 'ses_1',
    fatal: false,
    // The parts of an API failure worth keeping beside the message.
    context: { kind: 'network' },
  });
});

test('a warning is not a fault: only errors are forwarded', async () => {
  stopSink = startErrorReporting();

  logger.warn('steps', 'Health Connect would not answer');
  await flushErrors();

  expect(recordError).not.toHaveBeenCalled();
  expect(telemetryApi.reportErrors).not.toHaveBeenCalled();
});

test('the identity reaches Crashlytics, and is cleared on sign-out', () => {
  expect(setUserId).toHaveBeenCalledWith(expect.anything(), 'user_a');

  setErrorIdentity(null);
  expect(setUserId).toHaveBeenLastCalledWith(expect.anything(), '');
});

test('a report with nobody signed in waits, and goes up when somebody is', async () => {
  setErrorIdentity(null);
  reportError({ kind: 'boundary', message: 'Render failed', fatal: true });
  await flushErrors();

  // Nothing to attribute it to yet — but it is not thrown away either.
  expect(telemetryApi.reportErrors).not.toHaveBeenCalled();

  setErrorIdentity('user_a');
  await flushErrors();

  expect(sent()).toHaveLength(1);
  expect(sent()[0]).toMatchObject({ kind: 'boundary', fatal: true, message: 'Render failed' });
});

test('a batch the server refuses for what it is, is dropped rather than retried forever', async () => {
  telemetryApi.reportErrors.mockRejectedValue(new ApiError('validation', 'No', 422));

  reportError({ kind: 'js', message: 'Bad' });
  await flushErrors();
  expect(telemetryApi.reportErrors).toHaveBeenCalledTimes(1);

  // Dropped: a second flush has nothing left to send.
  telemetryApi.reportErrors.mockClear().mockResolvedValue({ accepted: 0 });
  await flushErrors();
  expect(telemetryApi.reportErrors).not.toHaveBeenCalled();
});

test('a batch that failed for any other reason is kept for the next try', async () => {
  telemetryApi.reportErrors.mockRejectedValue(new ApiError('server', 'Down', 503));

  reportError({ kind: 'js', message: 'Bad' });
  await flushErrors();

  telemetryApi.reportErrors.mockReset().mockResolvedValue({ accepted: 1 });
  await flushErrors();
  expect(sent()).toHaveLength(1);
});

test('a failure inside the reporting cannot report itself', async () => {
  stopSink = startErrorReporting();
  // The sink logs its own trouble through the same logger; without the
  // guard that would recurse until the stack gave out.
  telemetryApi.reportErrors.mockImplementation(() => {
    logger.error('errors', 'the sink itself failed');
    return Promise.resolve({ accepted: 1 });
  });

  reportError({ kind: 'js', message: 'First' });
  await flushErrors();

  expect(sent()).toHaveLength(1);
});
