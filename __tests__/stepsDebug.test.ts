/**
 * The development console report: what it says about a day where the phone
 * counted more than Google Fit though the watch saw a walk the phone did
 * not, and about Health Connect refusing the app for calling it too often —
 * the two ways a watch's steps "do not show".
 *
 * @format
 */

import StepTracker, {
  type HealthConnectStatus,
} from 'react-native-step-tracker-pro';
import { logStepDebug, stepDebugReport } from '../src/services/stepsDebug';
import { useStepsStore } from '../src/stores/stepsStore';
import { todayIso } from '../src/utils/date';

const tracker = StepTracker as unknown as Record<string, jest.Mock>;

const today = todayIso();
const midnight = new Date();
midnight.setHours(0, 0, 0, 0);
/** Today at hh:mm, local. */
const at = (hour: number, minute = 0) =>
  midnight.getTime() + (hour * 60 + minute) * 60_000;

const hours = (counts: Record<number, number>) =>
  Array.from({ length: 24 }, (_, hour) => counts[hour] ?? 0);

const CONNECTED = {
  available: true,
  availability: 'available',
  stepsGranted: true,
  grantedPermissions: ['android.permission.health.READ_STEPS'],
  missingPermissions: ['android.permission.health.READ_DISTANCE'],
  undeclaredPermissions: [],
} as unknown as HealthConnectStatus;

const googleFit = {
  packageName: 'com.google.android.apps.fitness',
  appName: 'Google Fit',
  kind: 'app',
  steps: 1500,
  distance: 0,
  calories: 0,
  lastRecordAt: at(14, 5),
  isSelf: false,
  isWearable: false,
  trustedWearable: true,
  isPlatform: false,
  manualSteps: 0,
  unknownMethodSteps: 1500,
  recordingMethods: { active: 0, automatic: 0, manual: 0, unknown: 1500 },
  lateWrittenSteps: 0,
  // The morning walk, which the phone saw too, and a watch-only one at 14:00.
  hourlySteps: hours({ 9: 1300, 14: 200 }),
  activeCalories: -1,
  distanceSource: 'none',
};

/** The snapshot of a day the phone counted 2,000 and Google Fit 1,500. */
const snapshot = (date: string, overrides: Record<string, unknown> = {}) => ({
  date,
  deviceSteps: 2000,
  recoveredSteps: 0,
  suspectSteps: 0,
  sensor: 'step_counter',
  coverageStartAt: 0,
  sources: [googleFit],
  sourcesStatus: 'read',
  resolved: {
    date,
    steps: 2000,
    kind: 'self',
    packageName: null,
    appName: 'This device',
    deviceSteps: 2000,
    externalSteps: 1500,
    usedExternal: false,
    merged: false,
    baselineSteps: 0,
    manualStepsExcluded: 0,
    suspectStepsExcluded: 0,
  },
  capabilities: { manufacturer: 'samsung', model: 'SM-A146B', sdkInt: 33 },
  // Twenty minutes of a hundred steps from 09:00.
  minutes: Array.from({ length: 20 }, (_, i) => ({
    minuteStart: at(9, i),
    steps: 100,
    untimedSteps: 0,
    chargingSteps: 0,
    stillSteps: 0,
    vehicleSteps: 0,
  })),
  minutesStatus: 'enabled',
  healthConnectRecords: {
    status: 'read',
    recordTypes: ['steps'],
    truncated: false,
    // Newest first, as Health Connect may give them.
    records: [
      {
        id: 'r2',
        recordType: 'steps',
        packageName: 'com.google.android.apps.fitness',
        recordingMethod: 'unknown',
        device: { type: 'watch', manufacturer: 'Samsung', model: 'SM-R870' },
        startTime: at(14),
        endTime: at(14, 5),
        count: 200,
      },
      {
        id: 'r1',
        recordType: 'steps',
        packageName: 'com.google.android.apps.fitness',
        recordingMethod: 'unknown',
        device: null,
        startTime: at(9),
        endTime: at(9, 30),
        count: 1300,
      },
    ],
  },
  ...overrides,
});

const INITIAL = useStepsStore.getState();

beforeEach(() => {
  jest.clearAllMocks();
  useStepsStore.setState({ ...INITIAL, healthConnect: CONNECTED }, true);

  tracker.getConfig.mockResolvedValue({
    stepSource: 'auto',
    wearableTrust: 'catalog',
    wearableAllowlist: ['com.google.android.apps.fitness'],
    healthConnectEnabled: true,
    healthConnectReadEnabled: true,
    healthConnectReadTypes: ['steps', 'distance'],
    healthConnectIgnoreManualEntries: true,
  });
  tracker.getVerificationSnapshot.mockImplementation(async (date: string) =>
    snapshot(date),
  );
});

const report = async () =>
  (await stepDebugReport('test', at(23))).map(section => section.join('\n'));

test('lists every app and record, and says why the watch walk does not show', async () => {
  const [setup, day, apps, byHour, records, server] = await report();

  expect(setup).toContain('Phone: samsung SM-A146B');
  expect(setup).toContain('watch relays [com.google.android.apps.fitness]');
  expect(setup).toContain(
    'steps allowed: yes · granted [READ_STEPS] · missing [READ_DISTANCE]',
  );

  expect(day).toContain('Shown: 2,000 from this phone · best other app 1,500');
  expect(day).toContain(
    "Why: Google Fit has 1,500, not more than the phone's 2,000.",
  );

  expect(apps).toContain('1. Google Fit (com.google.android.apps.fitness)');
  expect(apps).toContain(
    '1,500 steps · kind app · trusted as a watch yes · recorded: active 0, automatic 0, typed in 0, not stated 1,500',
  );

  // The phone saw the morning; only the watch saw 14:00.
  expect(byHour).toMatch(/09:00\s+2,000 \|\s+1,300/);
  expect(byHour).toMatch(/14:00\s+0 \|\s+200 {2}← more than the phone/);
  expect(byHour).toContain(
    'The phone and Google Fit, the higher of the two each hour: 2,200 — 200 more than shown',
  );

  // Oldest first, whatever order Health Connect gave them in.
  expect(records).toMatch(
    /09:00–09:30\s+1,300 {2}Google Fit {2}unknown {2}no device[\s\S]*14:00–14:05\s+200 {2}Google Fit {2}unknown {2}watch Samsung SM-R870/,
  );
  expect(records).toContain('By app: Google Fit 1,500');

  expect(server).toContain('nothing yet');

  // One read of Health Connect: the records came with the snapshot.
  expect(tracker.getVerificationSnapshot).toHaveBeenCalledTimes(1);
  expect(tracker.getVerificationSnapshot).toHaveBeenCalledWith(today, {
    include: ['minutes', 'healthConnectRecords'],
    healthConnectRecordTypes: ['steps'],
  });
  expect(tracker.getHealthConnectRecords).not.toHaveBeenCalled();
  expect(tracker.getHealthConnectStatus).not.toHaveBeenCalled();
});

test('says plainly when Health Connect is refusing the app for calling it too often', async () => {
  // As on the phone: the grants read back as none, nothing was read, and
  // asking directly names the reason.
  useStepsStore.setState({
    healthConnect: {
      ...CONNECTED,
      stepsGranted: false,
      grantedPermissions: [],
      missingPermissions: [
        'android.permission.health.READ_STEPS',
        'android.permission.health.READ_DISTANCE',
      ],
    } as HealthConnectStatus,
  });
  tracker.getVerificationSnapshot.mockImplementation(async (date: string) =>
    snapshot(date, {
      deviceSteps: 0,
      sources: [],
      sourcesStatus: 'not_consulted',
      healthConnectRecords: {
        status: 'not_granted',
        recordTypes: ['steps'],
        records: [],
        truncated: false,
      },
    }),
  );
  tracker.getHealthConnectRecords.mockRejectedValue(
    Object.assign(
      new Error(
        'Request rejected. Rate limited request quota has been exceeded. Please wait until quota has replenished before making further requests.',
      ),
      { code: 'E_UNKNOWN' },
    ),
  );

  const [, day, , , records] = await report();

  expect(day).toContain("Why: Health Connect is refusing Vokve's calls");
  expect(day).toContain('Leave Vokve closed for 15 minutes');
  expect(records).toContain(
    'not read — E_UNKNOWN: Request rejected. Rate limited request quota has been exceeded.',
  );
  expect(tracker.getHealthConnectRecords).toHaveBeenCalledTimes(1);
});

test('a permission that is really missing is said to be missing', async () => {
  useStepsStore.setState({
    healthConnect: {
      ...CONNECTED,
      stepsGranted: false,
      grantedPermissions: [],
    } as HealthConnectStatus,
  });
  tracker.getVerificationSnapshot.mockImplementation(async (date: string) =>
    snapshot(date, {
      sources: [],
      sourcesStatus: 'not_consulted',
      healthConnectRecords: {
        status: 'not_granted',
        recordTypes: ['steps'],
        records: [],
        truncated: false,
      },
    }),
  );
  tracker.getHealthConnectRecords.mockRejectedValue(
    Object.assign(new Error('READ_STEPS is not granted'), {
      code: 'E_HEALTH_CONNECT_DENIED',
    }),
  );

  const [, day, , , records] = await report();

  expect(day).toContain(
    'Why: Vokve is not allowed to read steps from Health Connect.',
  );
  expect(records).toContain(
    'not read — E_HEALTH_CONNECT_DENIED: READ_STEPS is not granted',
  );
});

test('writes the report to the console in a development build, one a minute at most', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await logStepDebug('test');
    const text = log.mock.calls.map(call => call.join(' ')).join('\n');
    expect(text).toContain(`══ Steps debug · test · ${today}`);
    expect(text).toContain('Google Fit (com.google.android.apps.fitness)');

    log.mockClear();
    await logStepDebug('again');
    expect(log.mock.calls.map(call => call.join(' ')).join('\n')).toContain(
      'again: no report — the last was',
    );
    expect(tracker.getVerificationSnapshot).toHaveBeenCalledTimes(1);
  } finally {
    log.mockRestore();
  }
});
