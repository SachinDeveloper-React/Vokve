/**
 * The steps service is the only owner of the tracker, and the only thing
 * that sends steps anywhere. These checks pin down the sync's contract with
 * the server — attest once, sign each day with a fresh nonce, answer an
 * integrity request with the same snapshot — and what happens to the phone's
 * history when the person signed in changes.
 *
 * @format
 */

import { AppState, PermissionsAndroid, Platform } from 'react-native';
import StepTracker from 'react-native-step-tracker-pro';
import { ApiError } from '../src/services/api/errors';
import {
  allowHealthConnectWrites,
  enableStepCounting,
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
    healthConnectWriteEnabled: true,
    healthConnectWriteGranularity: 'minute' as const,
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
        // This phone's own steps go into Health Connect, a minute at a time (D-57).
        healthConnectWriteEnabled: true,
        healthConnectWriteGranularity: 'minute',
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

  test('shows the other phones’ steps on top of this phone’s: the server’s day less what this phone sent (D-53)', async () => {
    // 629 walked on another phone; this one counted 72, and once it is in
    // the server's day is both.
    mockActivityApi.weekly.mockImplementation(async () => {
      const steps = mockActivityApi.ingest.mock.calls.length > 0 ? 701 : 629;
      return [{ ...ingested(0).day, date: today, steps, verifiedSteps: steps }];
    });
    tracker.getStepsForDate.mockImplementation(async (date: string) =>
      day(date, date === today ? 72 : 0),
    );
    mockActivityApi.ingest.mockResolvedValue(ingested(701));

    await startStepSession(PROFILE);
    await settle();

    // Before this phone has sent anything, all of the server's day is the
    // other phones'; once it has, the rest is.
    expect(tracker.setOtherDevicesSteps).toHaveBeenCalledWith(today, 629);
    expect(tracker.setOtherDevicesSteps).toHaveBeenLastCalledWith(today, 629);
    expect(mockActivityApi.ingest).toHaveBeenCalledTimes(1);
    expect(useStepsStore.getState().serverDays[today]?.steps).toBe(701);
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
  /** The instant the tracker was told to count from, if it was. */
  const countedFrom = () =>
    tracker.setCountFrom.mock.calls.at(-1)?.[0] as number | undefined;

  test('another account signing in gets a clean phone, counted from now, and its own choice', async () => {
    useStepsStore.setState({
      ownerId: 'user_b',
      trackingWanted: true,
      queue: [today],
    });
    tracker.getTrackingState.mockResolvedValueOnce('running');
    const before = Date.now();

    await startStepSession(PROFILE);

    expect(tracker.stopTracking).toHaveBeenCalled();
    // The last account's days, and its other phones' steps with them (2.7).
    expect(tracker.clearHistory).toHaveBeenCalled();
    // Today starts over from the sign-in: nothing before it counts (D-56).
    expect(countedFrom()).toBeGreaterThanOrEqual(before);
    expect(tracker.resetToday).not.toHaveBeenCalled();
    const state = useStepsStore.getState();
    expect(state.ownerId).toBe('user_a');
    expect(state.countingFrom).toBe(countedFrom());
    expect(state.trackingWanted).toBe(false);
    expect(tracker.startTracking).not.toHaveBeenCalled();
  });

  test('the first account on a phone counts from its sign-in too', async () => {
    const before = Date.now();
    await startStepSession(PROFILE);

    expect(countedFrom()).toBeGreaterThanOrEqual(before);
    expect(tracker.clearHistory).not.toHaveBeenCalled();
  });

  test('a tracker that cannot be told still starts the next account on a clean today', async () => {
    useStepsStore.setState({ ownerId: 'user_b' });
    tracker.setCountFrom.mockRejectedValueOnce(new Error('not in this build'));

    await startStepSession(PROFILE);

    expect(tracker.resetToday).toHaveBeenCalled();
    expect(useStepsStore.getState().ownerId).toBe('user_a');
  });

  test('a launch with the session still there changes nothing', async () => {
    useStepsStore.setState({ ownerId: 'user_a', trackingWanted: true });
    tracker.getTrackingState.mockResolvedValue('stopped');

    await startStepSession(PROFILE);

    expect(tracker.clearHistory).not.toHaveBeenCalled();
    expect(tracker.setCountFrom).not.toHaveBeenCalled();
    expect(tracker.startTracking).toHaveBeenCalled();
  });

  test('back after a sign-out on an earlier day, today counts from the sign-in', async () => {
    useStepsStore.setState({
      ownerId: 'user_a',
      trackingWanted: true,
      signedOutAt: Date.now() - 36 * 3_600_000,
    });
    const before = Date.now();

    await startStepSession(PROFILE);

    expect(countedFrom()).toBeGreaterThanOrEqual(before);
    expect(tracker.clearHistory).not.toHaveBeenCalled();
    expect(useStepsStore.getState().signedOutAt).toBeNull();
  });

  test('back after a sign-out earlier today, the morning stays: counting carries on', async () => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    useStepsStore.setState({
      ownerId: 'user_a',
      trackingWanted: true,
      // Signed out earlier today — whatever the clock says now.
      signedOutAt: Math.max(midnight.getTime(), Date.now() - 60_000),
    });

    await startStepSession(PROFILE);

    expect(tracker.setCountFrom).not.toHaveBeenCalled();
    expect(useStepsStore.getState().signedOutAt).toBeNull();
  });

  test('signing out stops counting, remembers it was on, and when', async () => {
    useStepsStore.setState({ ownerId: 'user_a', trackingWanted: true });
    await startStepSession(PROFILE);
    tracker.getTrackingState.mockResolvedValue('running');
    const before = Date.now();

    await stopStepsForSignOut();

    expect(tracker.stopTracking).toHaveBeenCalled();
    const state = useStepsStore.getState();
    expect(state.trackingWanted).toBe(true);
    expect(state.signedOutAt).toBeGreaterThanOrEqual(before);
    expect(tracker.setOtherDevicesSteps).toHaveBeenLastCalledWith(today, 0);
  });
});

describe('writing to Health Connect (D-57)', () => {
  test('asks for what Vokve uses, writing included, and keeps the answer', async () => {
    const status = { canWriteSteps: true, undeclaredPermissions: [] };
    tracker.requestHealthConnectPermissions.mockResolvedValueOnce(status);

    await expect(allowHealthConnectWrites()).resolves.toBe(status);

    expect(useStepsStore.getState().healthConnect).toBe(status);
  });
});

describe('the permission screens’ ask (D-54)', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34);
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('asks for physical activity alone, and starts counting', async () => {
    const request = jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    await startStepSession(PROFILE);

    expect(await enableStepCounting()).toBe('started');

    expect(request).toHaveBeenCalledWith(
      PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
    );
    // Notifications have a screen of their own: the tracker's combined ask is not used.
    expect(tracker.requestPermissions).not.toHaveBeenCalled();
    expect(tracker.startTracking).toHaveBeenCalledTimes(1);
    expect(useStepsStore.getState().trackingWanted).toBe(true);
  });

  test('allowed before the session is up, counting starts with it', async () => {
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

    expect(await enableStepCounting()).toBe('started');
    expect(tracker.startTracking).not.toHaveBeenCalled();

    // The session that follows the sign-in: a first one on this phone.
    await startStepSession(PROFILE);
    await settle();

    expect(tracker.startTracking).toHaveBeenCalledTimes(1);
    expect(useStepsStore.getState().trackingWanted).toBe(true);
  });

  test('a refusal leaves counting off', async () => {
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    await startStepSession(PROFILE);

    expect(await enableStepCounting()).toBe('permission_denied');
    expect(tracker.startTracking).not.toHaveBeenCalled();
  });
});
