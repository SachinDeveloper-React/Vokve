/**
 * The steps service is the only owner of the tracker, and the only thing
 * that sends steps anywhere. These checks pin down the sync's contract with
 * the server — attest once, sign each day with a fresh nonce, answer an
 * integrity request with the same snapshot — and what happens to the phone's
 * history when the person signed in changes.
 *
 * @format
 */

import { AppState } from 'react-native';
import StepTracker from 'react-native-step-tracker-pro';
import { ApiError } from '../src/services/api/errors';
import {
  endStepSession,
  startStepSession,
  stopStepsForSignOut,
  type StepProfile,
} from '../src/services/steps';
import { useStepsStore } from '../src/stores/stepsStore';
import { addDays, todayIso } from '../src/utils/date';

const mockActivityApi = {
  ingestNonce: jest.fn(),
  ingest: jest.fn(),
  config: jest.fn(),
  weekly: jest.fn(),
};
const mockDeviceApi = {
  attestationChallenge: jest.fn(),
  submitAttestation: jest.fn(),
};

// Getters, so the doubles are read when the service calls them rather than
// when the module is first required — before the consts above exist.
jest.mock('../src/services/api/endpoints', () => ({
  get activityApi() {
    return mockActivityApi;
  },
  get deviceApi() {
    return mockDeviceApi;
  },
  walletApi: {},
}));

jest.mock('../src/services/device', () => ({
  getDeviceId: () => 'dev_1',
}));

// The development console report reads the tracker on its own; not here.
jest.mock('../src/services/stepsDebug', () => ({
  logStepDebug: jest.fn(async () => {}),
}));

const tracker = StepTracker as unknown as Record<string, jest.Mock>;

const PROFILE: StepProfile = {
  userId: 'user_a',
  heightCm: 172,
  weightKg: 68,
  gender: 'female',
  dailyGoal: 8000,
};

const today = todayIso();

/** The server's set-up, as `GET /activity/config` answers. */
const SERVER_CONFIG = {
  tracker: {
    healthConnectReadTypes: ['steps', 'distance'] as ('steps' | 'distance')[],
    healthConnectWriteEnabled: false,
    healthConnectIgnoreManualEntries: true,
    wearableTrust: 'catalog' as const,
    wearableAllowlist: ['com.google.android.apps.fitness'],
    gapRecovery: 'split' as const,
    historyRetentionDays: 400,
    motionWindowRetention: 864,
    fraudDetection: { enabled: true, mode: 'flag' as const },
    motionSampling: { enabled: true, windowSeconds: 10, intervalMinutes: 5 },
    privacyPolicyUrl: 'https://vokve.app/privacy',
  },
  sync: {
    intervalMinutes: 5,
    minGapSeconds: 120,
    maxAgeDays: 7,
    include: ['minutes', 'motionWindows', 'healthConnectRecords'] as (
      | 'minutes'
      | 'motionWindows'
      | 'healthConnectRecords'
    )[],
    healthConnectRecordTypes: ['steps', 'distance'] as ('steps' | 'distance')[],
  },
  playIntegrity: { cloudProjectNumber: null },
};

const day = (date: string, steps: number) => ({
  date,
  steps,
  distance: 0,
  calories: 0,
  synced: false,
  syncedRemote: false,
  recoveredSteps: 0,
  suspectSteps: 0,
});

const SIGNATURE = {
  keyId: 'mock-key',
  algorithm: 'SHA256withECDSA',
  value: 'c2ln',
  attested: true,
  signedPayload: '{}',
  payloadSha256: 'abc123',
};

const ingested = (steps: number) => ({
  day: {
    date: today,
    steps,
    verifiedSteps: steps,
    distanceKm: 0,
    activeMinutes: 0,
    caloriesBurned: 0,
    workoutsCompleted: 0,
    source: 'device',
    verified: true,
  },
  duplicate: false,
  coinsHeld: 0,
  releaseAfter: null,
});

/** Lets a flush that was started and not awaited run to its end. */
const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
};

const INITIAL = useStepsStore.getState();

beforeEach(() => {
  jest.clearAllMocks();
  useStepsStore.setState(INITIAL, true);

  tracker.getStepsForDate.mockImplementation(async (date: string) =>
    day(date, date === today ? 500 : 0),
  );
  tracker.getTrackingState.mockResolvedValue('idle');
  tracker.getHealthConnectStatus.mockResolvedValue({ grantedReadTypes: [] });
  tracker.hasAttestationKey.mockResolvedValue(false);
  tracker.getSignedSnapshot.mockResolvedValue(SIGNATURE);

  mockDeviceApi.attestationChallenge.mockResolvedValue({
    challenge: 'challenge-1',
    expiresAt: new Date().toISOString(),
  });
  mockDeviceApi.submitAttestation.mockResolvedValue({
    keyId: 'mock-key',
    attested: true,
    securityLevel: 'tee',
  });
  let nonces = 0;
  mockActivityApi.ingestNonce.mockImplementation(async () => ({
    nonce: `nonce-${(nonces += 1)}`,
    expiresAt: new Date().toISOString(),
  }));
  mockActivityApi.ingest.mockResolvedValue(ingested(500));
  mockActivityApi.config.mockResolvedValue(SERVER_CONFIG);
  mockActivityApi.weekly.mockResolvedValue([]);
});

afterEach(async () => {
  // A flush left running would finish inside the next test.
  await settle();
  endStepSession();
});

describe('a step session', () => {
  test('configures the tracker as the server says, with the user’s own body and goal', async () => {
    await startStepSession(PROFILE);

    expect(mockActivityApi.config).toHaveBeenCalled();
    expect(useStepsStore.getState().activityConfig).toEqual(SERVER_CONFIG);

    expect(tracker.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        height: 172,
        weight: 68,
        sex: 'female',
        dailyGoal: 8000,
        healthConnectReadTypes: ['steps', 'distance'],
        healthConnectWriteEnabled: false,
        healthConnectIgnoreManualEntries: true,
        wearableTrust: 'catalog',
        // Google Fit relays a watch: used whenever it counted more.
        wearableAllowlist: ['com.google.android.apps.fitness'],
        gapRecovery: 'split',
        fraudDetection: { enabled: true, mode: 'flag' },
        privacyPolicyUrl: 'https://vokve.app/privacy',
      }),
    );
  });

  test('a set-up kept from before the server named watch relays still starts, and takes them when it answers', async () => {
    const older: Record<string, unknown> = { ...SERVER_CONFIG.tracker };
    delete older.wearableAllowlist;
    useStepsStore.setState({
      activityConfig: { ...SERVER_CONFIG, tracker: older } as never,
    });

    await startStepSession(PROFILE);
    await settle();

    expect(tracker.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ wearableAllowlist: [] }),
    );
    expect(tracker.updateConfig).toHaveBeenCalledWith({
      wearableAllowlist: ['com.google.android.apps.fitness'],
    });
  });

  test('takes a set-up the server changed, and what the snapshot carries with it', async () => {
    mockActivityApi.config.mockResolvedValue({
      ...SERVER_CONFIG,
      tracker: { ...SERVER_CONFIG.tracker, gapRecovery: 'drop' },
      sync: { ...SERVER_CONFIG.sync, include: ['minutes'] },
    });
    await startStepSession(PROFILE);
    await settle();

    expect(tracker.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ gapRecovery: 'drop' }),
    );
    expect(tracker.getSignedSnapshot).toHaveBeenCalledWith(today, {
      nonce: 'nonce-1',
      include: ['minutes'],
    });
  });

  test('reads the server’s week for the dashboard, and puts each upload’s answer into it', async () => {
    // The server's today grows once the upload is in.
    mockActivityApi.weekly.mockImplementation(async () => [
      {
        ...ingested(0).day,
        date: addDays(today, -1),
        steps: 7000,
        verifiedSteps: 7000,
      },
      {
        ...ingested(0).day,
        date: today,
        steps: mockActivityApi.ingest.mock.calls.length > 0 ? 500 : 0,
      },
    ]);
    await startStepSession(PROFILE);
    await settle();

    const week = useStepsStore.getState().serverWeek;
    expect(week.map(entry => entry.steps)).toEqual([7000, 500]);
    // Read at the start, and again once the upload was in.
    expect(mockActivityApi.weekly).toHaveBeenCalledTimes(2);
  });

  test('attests once, then sends today signed with a fresh nonce', async () => {
    await startStepSession(PROFILE);
    await settle();

    expect(tracker.attestDevice).toHaveBeenCalledWith('challenge-1');
    expect(mockDeviceApi.submitAttestation).toHaveBeenCalledWith(
      'dev_1',
      expect.objectContaining({ keyId: 'mock-key' }),
    );
    // No Health Connect grant, so no raw records are asked for.
    expect(tracker.getSignedSnapshot).toHaveBeenCalledWith(today, {
      nonce: 'nonce-1',
      include: ['minutes', 'motionWindows'],
    });
    expect(mockActivityApi.ingest).toHaveBeenCalledWith(
      { date: today, snapshot: SIGNATURE },
      { idempotencyKey: expect.any(String) },
    );

    const state = useStepsStore.getState();
    expect(state.queue).toEqual([]);
    expect(state.synced[today]?.steps).toBe(500);
    expect(state.serverDays[today]?.verifiedSteps).toBe(500);
    expect(state.attestedDeviceId).toBe('dev_1');
    expect(state.syncStatus).toBe('idle');
  });

  test('asks for the records of every Health Connect type the user allowed', async () => {
    tracker.getHealthConnectStatus.mockResolvedValue({
      grantedReadTypes: ['steps'],
    });
    await startStepSession(PROFILE);
    await settle();

    expect(tracker.getSignedSnapshot).toHaveBeenCalledWith(today, {
      nonce: 'nonce-1',
      include: ['minutes', 'motionWindows', 'healthConnectRecords'],
      healthConnectRecordTypes: ['steps'],
    });
    // The grants the session read when it started; Health Connect is not
    // asked again for the day it sends.
    expect(tracker.getHealthConnectStatus).toHaveBeenCalledTimes(1);
  });

  test('a foreground re-reads the status, but leaves Health Connect’s grants to the tracker', async () => {
    await startStepSession(PROFILE);
    await settle();
    expect(tracker.getHealthConnectStatus).toHaveBeenCalledTimes(1);

    const [, onChange] = (
      AppState.addEventListener as jest.Mock
    ).mock.calls.find(([event]) => event === 'change')!;
    onChange('active');
    await settle();

    // Everything else is read again; the grants arrive on their own, as
    // `healthConnectStatusChanged`, when they moved.
    expect(tracker.getTrackingHealth).toHaveBeenCalledTimes(2);
    expect(tracker.getHealthConnectStatus).toHaveBeenCalledTimes(1);
  });

  test('sends the same snapshot again with a Play Integrity token when asked', async () => {
    mockActivityApi.ingest
      .mockRejectedValueOnce(
        new ApiError(
          'forbidden',
          'Fresh integrity check needed.',
          403,
          { cloudProjectNumber: 42 },
          'INTEGRITY_REQUIRED',
        ),
      )
      .mockResolvedValueOnce(ingested(500));

    await startStepSession(PROFILE);
    await settle();

    expect(tracker.requestIntegrityToken).toHaveBeenCalledWith({
      requestHash: 'abc123',
      cloudProjectNumber: 42,
    });
    expect(mockActivityApi.ingest).toHaveBeenLastCalledWith(
      {
        date: today,
        snapshot: SIGNATURE,
        integrity: { token: 'mock-integrity-token' },
      },
      { idempotencyKey: expect.any(String) },
    );
    // One snapshot, so one nonce: the refusal did not spend it.
    expect(mockActivityApi.ingestNonce).toHaveBeenCalledTimes(1);
    expect(useStepsStore.getState().cloudProjectNumber).toBe(42);
  });

  test('attests again, once, when the server has no key on file', async () => {
    useStepsStore.setState({ ownerId: 'user_a', attestedDeviceId: 'dev_1' });
    tracker.hasAttestationKey.mockResolvedValue(true);
    mockActivityApi.ingest
      .mockRejectedValueOnce(
        new ApiError('forbidden', 'Attest.', 403, null, 'ATTESTATION_REQUIRED'),
      )
      .mockResolvedValueOnce(ingested(500));

    await startStepSession(PROFILE);
    await settle();

    expect(tracker.attestDevice).toHaveBeenCalledTimes(1);
    expect(mockActivityApi.ingestNonce).toHaveBeenCalledTimes(2);
    expect(useStepsStore.getState().queue).toEqual([]);
  });

  test('keeps the day queued when the network is down', async () => {
    mockActivityApi.ingestNonce.mockRejectedValue(
      new ApiError(
        'network',
        'No connection. Check your internet and try again.',
      ),
    );

    await startStepSession(PROFILE);
    await settle();

    const state = useStepsStore.getState();
    expect(state.queue).toContain(today);
    expect(state.syncStatus).toBe('failed');
    expect(state.syncError).toBe(
      'No connection. Check your internet and try again.',
    );
  });

  test('drops a day the server refuses outright', async () => {
    mockActivityApi.ingest.mockRejectedValue(
      new ApiError(
        'validation',
        'That day can no longer be synced.',
        422,
        null,
        'SNAPSHOT_DATE_OUT_OF_RANGE',
      ),
    );

    await startStepSession(PROFILE);
    await settle();

    expect(useStepsStore.getState().queue).toEqual([]);
    expect(useStepsStore.getState().synced[today]).toBeUndefined();
  });

  test('does not send a day the server already has', async () => {
    useStepsStore.setState({
      ownerId: 'user_a',
      attestedDeviceId: 'dev_1',
      synced: {
        [today]: {
          steps: 500,
          recoveredSteps: 0,
          suspectSteps: 0,
          at: Date.now() - 60_000,
        },
      },
    });

    await startStepSession(PROFILE);
    await settle();

    expect(mockActivityApi.ingest).not.toHaveBeenCalled();
    expect(useStepsStore.getState().queue).toEqual([]);
  });

  test('sends a day again when a watch’s steps reach Health Connect, though the phone’s own count has not moved', async () => {
    useStepsStore.setState({
      ownerId: 'user_a',
      attestedDeviceId: 'dev_1',
      synced: {
        [today]: {
          steps: 500,
          recoveredSteps: 0,
          suspectSteps: 0,
          externalSteps: 300,
          at: Date.now() - 600_000,
        },
      },
    });
    // Google Fit has caught up with the watch; the phone still counted more.
    tracker.getStepsForDate.mockImplementation(async (date: string) => ({
      ...day(date, date === today ? 500 : 0),
      stepSource: { externalSteps: date === today ? 450 : 0 },
    }));

    await startStepSession(PROFILE);
    await settle();

    expect(mockActivityApi.ingest).toHaveBeenCalledTimes(1);
    expect(useStepsStore.getState().synced[today]?.externalSteps).toBe(450);
  });

  test('never sends an old day the server would refuse', async () => {
    useStepsStore.setState({
      ownerId: 'user_a',
      queue: [addDays(today, -9)],
    });

    await startStepSession(PROFILE);
    await settle();

    expect(tracker.getStepsForDate).not.toHaveBeenCalledWith(
      addDays(today, -9),
    );
    expect(useStepsStore.getState().queue).not.toContain(addDays(today, -9));
  });
});

describe('who the phone counts for', () => {
  test('another account signing in gets a clean phone and its own choice', async () => {
    useStepsStore.setState({
      ownerId: 'user_b',
      trackingWanted: true,
      queue: [today],
    });
    tracker.getTrackingState.mockResolvedValueOnce('running');

    await startStepSession(PROFILE);

    expect(tracker.stopTracking).toHaveBeenCalled();
    expect(tracker.clearHistory).toHaveBeenCalled();
    expect(tracker.resetToday).toHaveBeenCalled();
    const state = useStepsStore.getState();
    expect(state.ownerId).toBe('user_a');
    expect(state.trackingWanted).toBe(false);
    expect(tracker.startTracking).not.toHaveBeenCalled();
  });

  test('the same account signing back in picks counting up again', async () => {
    useStepsStore.setState({ ownerId: 'user_a', trackingWanted: true });
    tracker.getTrackingState.mockResolvedValue('stopped');

    await startStepSession(PROFILE);

    expect(tracker.clearHistory).not.toHaveBeenCalled();
    expect(tracker.startTracking).toHaveBeenCalled();
  });

  test('signing out stops counting but remembers it was on', async () => {
    useStepsStore.setState({ ownerId: 'user_a', trackingWanted: true });
    await startStepSession(PROFILE);
    tracker.getTrackingState.mockResolvedValue('running');

    await stopStepsForSignOut();

    expect(tracker.stopTracking).toHaveBeenCalled();
    expect(useStepsStore.getState().trackingWanted).toBe(true);
  });
});
