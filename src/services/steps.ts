import { AppState, PermissionsAndroid, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import StepTracker, {
  StepTrackerError,
  isSupported,
  type HealthConnectStatus,
  type IntegrityErrorDetails,
  type SnapshotSignature,
  type StepTrackerConfig,
  type VerificationSnapshotOptions,
} from 'react-native-step-tracker-pro';
import { useCoinsStore } from '../stores/coinsStore';
import { useStepsStore, type SyncedDayMark } from '../stores/stepsStore';
import { useStreakStore } from '../stores/streakStore';
import type {
  ActivityConfig,
  DailyActivity,
  Gender,
  StepIngestResult,
} from '../types/models';
import { addDays, toIsoDate, todayIso } from '../utils/date';
import { logger } from '../utils/logger';
import { uuid } from '../utils/uuid';
import { track } from './analytics';
import type { IngestIntegrity } from './api/contracts';
import { activityApi, deviceApi } from './api/endpoints';
import { ApiError, toApiError } from './api/errors';
import { getDeviceId } from './device';
import { logStepDebug } from './stepsDebug';

/**
 * Steps: counted on the phone by react-native-step-tracker-pro, signed there
 * by a Keystore key the server has seen attested, and sent a day at a time to
 * `POST /activity/ingest` (BACKEND.md §7.3).
 *
 * This module is the only owner of the tracker. Its config is pushed from
 * here and nowhere else, its events are heard here and put in the steps
 * store, and every screen reads that store — two owners would each push their
 * own config, and the second would quietly win.
 *
 * A session runs while someone is signed in with a finished profile
 * (`useStepTrackingSession`). Counting itself is the user's choice, made on
 * the step tracking screen, and it outlives the session: the service counts
 * with the app closed, which is the point of it. Only signing out stops it.
 */

/**
 * How the tracker is set up and when it syncs come from the server
 * (`GET /activity/config`) and are kept with the steps store. This copy is
 * only for the moments before the server has ever answered — a first launch
 * with no connection — and matches the server's defaults.
 */
const FALLBACK_CONFIG: ActivityConfig = {
  tracker: {
    healthConnectReadTypes: ['steps', 'distance'],
    healthConnectWriteEnabled: true,
    healthConnectWriteGranularity: 'minute',
    healthConnectIgnoreManualEntries: true,
    wearableTrust: 'catalog',
    wearableAllowlist: ['com.google.android.apps.fitness'],
    gapRecovery: 'drop',
    historyRetentionDays: 400,
    motionWindowRetention: 864,
    fraudDetection: { enabled: true, mode: 'flag' },
    motionSampling: { enabled: true, windowSeconds: 10, intervalMinutes: 5 },
    privacyPolicyUrl: 'https://vokve.app/privacy',
  },
  sync: {
    intervalMinutes: 5,
    minGapSeconds: 120,
    maxAgeDays: 14,
    include: ['minutes', 'motionWindows', 'healthConnectRecords'],
    healthConnectRecordTypes: ['steps', 'distance'],
  },
  playIntegrity: { cloudProjectNumber: null },
};

/** How often the open app checks whether a sync of today is due. */
const TICK_MS = 60_000;
/** Snapshots taken for one day before giving up until the next flush. */
const MAX_SEND_ATTEMPTS = 3;

/** The server's set-up, or the fallback until it has answered once. */
const activityConfig = (): ActivityConfig =>
  useStepsStore.getState().activityConfig ?? FALLBACK_CONFIG;

/** Who the tracker is counting for: the parts of the profile it uses. */
export interface StepProfile {
  userId: string;
  heightCm: number | null;
  weightKg: number | null;
  gender: Gender | null;
  dailyGoal: number;
}

/**
 * What the counting notification says. No step count, by choice: the
 * tracker's own figure is everything this phone saw — a watch's steps out
 * of Health Connect, and the steps the counter handed over in one go after
 * an OEM task killer let the service back — while every screen shows only
 * the part the server verified (`verifiedActivityOf`). An ongoing
 * notification quoting the larger number is a second, louder answer to
 * "how many steps today?", and it is the one the user cannot refresh.
 *
 * To put the live count back, make the title `'{steps} steps so far'` — the
 * tracker fills the token — and say in the text that the app verifies them.
 */
const NOTIFICATION_COPY = {
  notificationTitle: 'Counting your steps',
  notificationText: 'Vokve is counting, even with the app closed.',
} as const;

/**
 * The tracker's config: the server's set-up (Health Connect read for a
 * watch and written with this phone's own steps, checks that flag and
 * remove nothing, `split` recovery, as it stands by default), the
 * notification's words, and the user's own body and goal.
 */
function trackerConfig(
  profile: StepProfile,
  server: ActivityConfig['tracker'],
): StepTrackerConfig {
  const config: StepTrackerConfig = {
    ...server,
    ...NOTIFICATION_COPY,
    healthConnectReadTypes: [...server.healthConnectReadTypes],
    // A set-up kept from before the server sent one has none.
    wearableAllowlist: [...(server.wearableAllowlist ?? [])],
    sex:
      profile.gender === 'male' || profile.gender === 'female'
        ? profile.gender
        : 'unspecified',
    dailyGoal: profile.dailyGoal,
  };
  // Left out rather than sent empty: the tracker keeps what it has, or its
  // own default, for anything it is not given.
  if (profile.heightCm) config.height = profile.heightCm;
  if (profile.weightKg) config.weight = profile.weightKg;
  return config;
}

/** The keys of `next` whose values differ from `previous`. */
function changedKeys(
  previous: StepTrackerConfig,
  next: StepTrackerConfig,
): StepTrackerConfig {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    const before = (previous as Record<string, unknown>)[key];
    if (JSON.stringify(before) !== JSON.stringify(value)) {
      patch[key] = value;
    }
  }
  return patch as StepTrackerConfig;
}

interface Session {
  id: number;
  userId: string;
  profile: StepProfile;
  config: StepTrackerConfig;
  subscriptions: { remove(): void }[];
  interval: ReturnType<typeof setInterval> | null;
}

let session: Session | null = null;
let sessionCounter = 0;

/**
 * The user a sync with no session is running for: set only for the headless
 * pass behind the server's silent "sync now" push (`syncStepsInBackground`).
 * A session's own user always wins, so the two can never both be sending.
 */
let backgroundOwner: string | null = null;
/**
 * How many headless syncs are in flight. Two triggers can land together —
 * the server's push and the daily worker (A28d) — and the first to finish
 * must not clear the owner the second is still sending under.
 */
let backgroundSyncs = 0;

/** Each await in a session's start can outlive it — a sign-out mid-way. */
const isLive = (id: number) => session?.id === id;
const steps = () => useStepsStore.getState();
/** Whose days are being sent: the session's user, or the headless pass's. */
const syncOwner = (): string | null => session?.userId ?? backgroundOwner;

/** Tolerates one read failing without losing the others. */
async function settle<T>(read: Promise<T>, what: string): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    logger.warn('steps', `Could not read ${what}`, error);
    return null;
  }
}

// ─── Session ────────────────────────────────────────────────────────────────

/**
 * Starts (or, for the same user, refreshes) the session: config, the events,
 * the foreground and network listeners, the sync timer — and counting again,
 * if the user had it on when they last signed out.
 */
export async function startStepSession(profile: StepProfile): Promise<void> {
  if (session?.userId === profile.userId) {
    return updateStepProfile(profile);
  }
  endStepSession();

  // What the server holds is shown whether or not this phone can count.
  refreshServerActivity();

  if (!isSupported()) {
    useStepsStore.setState({ supported: false });
    return;
  }

  const id = (sessionCounter += 1);
  // The last set-up the server gave is used at once; the very first launch
  // waits for one.
  const server = useStepsStore.getState().activityConfig
    ? activityConfig()
    : await loadActivityConfig();
  // Signed out, or started again, while the set-up was on its way.
  if (sessionCounter !== id) return;
  const config = trackerConfig(profile, server.tracker);
  session = {
    id,
    userId: profile.userId,
    profile,
    config,
    subscriptions: [],
    interval: null,
  };
  useStepsStore.setState({ supported: true });

  try {
    const snapshot = await StepTracker.initialize(config);
    if (!isLive(id)) return;
    useStepsStore.setState({ today: snapshot, trackingState: snapshot.state });

    listen(id);
    await catchUp(id, { start: true });
    if (!isLive(id)) return;
    // The server's week, read as the session began, may already be in.
    shareOtherDevicesSteps();

    // Play's token provider takes seconds to warm up; doing it now means the
    // first token the server asks for does not pay for it.
    const cloudProjectNumber =
      activityConfig().playIntegrity.cloudProjectNumber ??
      steps().cloudProjectNumber;
    if (cloudProjectNumber) {
      StepTracker.prepareIntegrity(cloudProjectNumber).catch(() => {});
    }
  } catch (error) {
    logger.warn('steps', 'Step session did not start', error);
  }
}

/**
 * What a session does when it starts and every time the app comes back to
 * the foreground: make sure the phone's history is this user's, re-read the
 * status, put counting back on if it should be, and send what is new.
 *
 * Health Connect's grants are asked for when the session starts; on a
 * foreground after that the tracker re-reads them itself and says so when
 * they moved (`healthConnectStatusChanged`). Asking again here would spend
 * Health Connect's rate limit on an answer already on its way.
 */
async function catchUp(
  id: number,
  { start = false }: { start?: boolean } = {},
): Promise<void> {
  const userId = session?.userId;
  if (!userId) return;
  try {
    await claimOwnership(userId);
  } catch (error) {
    // Until the last account's days are gone, nothing on this phone is shown
    // or sent as this user's (see `runFlush`); the next foreground retries.
    logger.warn('steps', "Could not clear the last account's steps", error);
    useStepsStore.setState({ today: null });
    return;
  }
  if (!isLive(id)) return;
  // Counting allowed on the permission screens before this session was up:
  // wanted now, by this user, and switched on just below.
  if (startWhenReady) {
    startWhenReady = false;
    useStepsStore.setState({ trackingWanted: true });
  }

  // Reading tracking health from the foreground also restarts a service an
  // OEM killed — the one moment a background-start limit cannot apply.
  await refreshStepStatus({ healthConnect: start });
  if (!isLive(id)) return;
  try {
    await resumeIfWanted();
  } catch (error) {
    logger.warn('steps', 'Counting did not resume', error);
  }
  scheduleSync(daysToCatchUp());
  // A set-up changed on the server reaches the tracker on the next foreground
  // — and then, in a development build, today as the phone now sees it goes
  // to the console.
  loadActivityConfig()
    .then(() => applyServerConfig(id))
    .then(() => {
      if (isLive(id)) logStepDebug(start ? 'app start' : 'foreground');
    });
}

/**
 * Fetches the server's set-up and keeps it. Never throws: offline, the last
 * one stands, and before there has ever been one the fallback does.
 */
async function loadActivityConfig(): Promise<ActivityConfig> {
  try {
    const config = await activityApi.config();
    useStepsStore.setState({ activityConfig: config });
    return config;
  } catch (error) {
    logger.warn('steps', 'Step config not loaded', toApiError(error));
    return activityConfig();
  }
}

/** Pushes whatever the server's set-up changed to the running tracker. */
async function applyServerConfig(id: number): Promise<void> {
  if (!isLive(id) || !session) return;
  const next = trackerConfig(session.profile, activityConfig().tracker);
  const patch = changedKeys(session.config, next);
  if (Object.keys(patch).length === 0) return;
  session.config = next;
  try {
    await StepTracker.updateConfig(patch);
  } catch (error) {
    logger.warn('steps', 'Server step config not applied', error);
  }
}

/**
 * The last seven days as the server holds them — what the dashboard shows.
 * Never throws: offline, the last copy stands.
 */
export async function refreshServerActivity(): Promise<void> {
  try {
    const week = await activityApi.weekly();
    useStepsStore.setState({ serverWeek: week, serverWeekAt: Date.now() });
    shareOtherDevicesSteps();
  } catch (error) {
    logger.warn('steps', 'Server steps not loaded', toApiError(error));
  }
}

/** What the tracker was last told about the other phones, so the same figure is not sent twice. */
let sharedOtherDevices: { date: string; steps: number } | null = null;

/**
 * The user's other phones' steps today, handed to the tracker, which shows
 * them on top of this phone's own — the notification, the live count and
 * the daily goal — and never counts them as this phone's (D-53). The
 * server's day less what this phone last sent it; before this phone has
 * sent anything, all of the server's day is the other phones'.
 */
function shareOtherDevicesSteps(): void {
  if (!session) {
    return;
  }
  const today = todayIso();
  const state = steps();
  const day =
    state.serverWeek.find(entry => entry.date === today) ??
    state.serverDays[today];
  if (!day) {
    return;
  }
  const others = Math.max(
    0,
    Math.round(day.steps - (state.synced[today]?.steps ?? 0)),
  );
  if (
    sharedOtherDevices?.date === today &&
    sharedOtherDevices.steps === others
  ) {
    return;
  }
  sharedOtherDevices = { date: today, steps: others };
  StepTracker.setOtherDevicesSteps(today, others)
    .then(snapshot => {
      if (session) {
        useStepsStore.setState({
          today: snapshot,
          trackingState: snapshot.state,
        });
      }
    })
    .catch(error => {
      sharedOtherDevices = null;
      logger.warn('steps', "Other phones' steps were not shown", error);
    });
}

/** No other phones' steps on this phone any more: another account, or none. */
async function clearOtherDevicesSteps(): Promise<void> {
  sharedOtherDevices = null;
  try {
    await StepTracker.setOtherDevicesSteps(todayIso(), 0);
  } catch (error) {
    logger.warn('steps', "Other phones' steps were not cleared", error);
  }
}

/** One day as an upload's answer has it, put into the dashboard's week. */
function patchServerWeek(day: DailyActivity): void {
  useStepsStore.setState(state => ({
    serverWeek: state.serverWeek.some(entry => entry.date === day.date)
      ? state.serverWeek.map(entry => (entry.date === day.date ? day : entry))
      : state.serverWeek,
  }));
}

/**
 * Pushes a profile change — height, weight, gender, goal — to the tracker.
 * Only the keys that moved are sent: every config change is written to the
 * integrity log, and a log full of changes that changed nothing is noise.
 */
export async function updateStepProfile(profile: StepProfile): Promise<void> {
  if (!session || session.userId !== profile.userId) {
    return;
  }
  session.profile = profile;
  const next = trackerConfig(profile, activityConfig().tracker);
  const patch = changedKeys(session.config, next);
  if (Object.keys(patch).length === 0) {
    return;
  }
  session.config = next;
  try {
    await StepTracker.updateConfig(patch);
    await refreshToday();
  } catch (error) {
    logger.warn('steps', 'Tracker config was not updated', error);
  }
}

/**
 * Stops listening and syncing. Counting carries on: the service runs
 * without the app, and an expired session is no reason to lose the walk the
 * user is on. `stopStepsForSignOut` is the one that stops it.
 */
export function endStepSession(): void {
  // A start still waiting on the server's set-up sees this and gives up.
  sessionCounter += 1;
  if (!session) {
    return;
  }
  session.subscriptions.forEach(subscription => subscription.remove());
  if (session.interval) {
    clearInterval(session.interval);
  }
  session = null;
  sharedOtherDevices = null;
  forced.clear();
  steps().resetLive();
}

/**
 * Signing out stops counting: a phone signed out of Vokve has no one to
 * count for, and a notification saying it is counting would be untrue. The
 * history and `trackingWanted` stay, so the same user signing back in picks
 * up where they were; someone else signing in gets a clean phone instead
 * (`claimOwnership`).
 */
export async function stopStepsForSignOut(): Promise<void> {
  // A start asked for on the permission screens belongs to this account.
  startWhenReady = false;
  endStepSession();
  // The next sign-in decides from this whether today started over (D-56).
  useStepsStore.setState({ signedOutAt: Date.now() });
  if (!isSupported()) {
    return;
  }
  try {
    const state = await StepTracker.getTrackingState();
    if (state === 'running' || state === 'paused') {
      await StepTracker.stopTracking();
    }
  } catch (error) {
    logger.warn('steps', 'Could not stop counting on sign-out', error);
  }
  // The other phones were this account's; the next sign-in learns its own.
  await clearOtherDevicesSteps();
}

/**
 * Stops a counter left running with nobody signed in.
 *
 * The repair path. A phone signed out by the server rather than by its owner
 * used to keep the service alive — the app showed the sign-in screen while
 * the notification went on counting — and a phone already in that state
 * stays in it until something asks the service to stop, because the service
 * outlives the app that started it. So a launch with no session asks.
 *
 * Deliberately **not** `stopStepsForSignOut`: that stamps `signedOutAt`, and
 * a launch is not a sign-out. Moving that stamp forward would make a
 * sign-in the next morning resume a day it should have started over (D-56).
 */
export async function stopStepsWhenSignedOut(): Promise<void> {
  startWhenReady = false;
  endStepSession();
  if (!isSupported()) {
    return;
  }
  try {
    const state = await StepTracker.getTrackingState();
    if (state !== 'running' && state !== 'paused') {
      return;
    }
    logger.warn(
      'steps',
      'Counting was still on with nobody signed in; stopping it',
    );
    await StepTracker.stopTracking();
  } catch (error) {
    logger.warn(
      'steps',
      'Could not stop counting for a signed-out phone',
      error,
    );
  }
}

/**
 * Whose steps the phone counts, and from when (D-56). Counting starts at
 * sign-in: the tracker is told to count nothing before it
 * (`setCountFrom`) — not the steps its counter held, not any Health
 * Connect app's, a watch's included — and starts today over.
 *
 * - **Another account** (or the first): the last one's days are cleared
 *   rather than shown — or worse, synced — as this one's, counting starts
 *   now, and waits for this user to turn it on themselves.
 * - **The same account, back after a sign-out**: counting starts now if the
 *   sign-out was on an earlier day. Signed out earlier today, it carries on
 *   from where it was: what was walked before the sign-out is this
 *   account's, and starting over would lose it. What the phone counted
 *   while signed out is never counted — tracking was stopped, and a stop is
 *   a stop (tracker 2.7).
 * - **A launch** with the session still there changes nothing.
 */
async function claimOwnership(userId: string): Promise<void> {
  const { ownerId, signedOutAt } = steps();
  if (ownerId === userId) {
    if (signedOutAt === null) {
      return;
    }
    if (toIsoDate(new Date(signedOutAt)) !== todayIso()) {
      await countFrom(Date.now());
    }
    useStepsStore.setState({ signedOutAt: null });
    return;
  }
  if (ownerId !== null) {
    const state = await StepTracker.getTrackingState();
    if (state === 'running' || state === 'paused') {
      await StepTracker.stopTracking();
    }
    // The last account's days, and what its other phones counted on them.
    await StepTracker.clearHistory();
    sharedOtherDevices = null;
    useStepsStore.setState({ trackingState: 'stopped', today: null });
  }
  // Starting today over is what keeps the last account's walk off this
  // one's: done by hand where the tracker could not be told.
  if (!(await countFrom(Date.now())) && ownerId !== null) {
    await StepTracker.resetToday();
  }
  useStepsStore.setState({
    ownerId: userId,
    signedOutAt: null,
    trackingWanted: false,
    queue: [],
    synced: {},
    refused: {},
    serverDays: {},
    lastSyncedAt: null,
    recoveriesAcknowledged: null,
  });
}

/**
 * Tells the tracker to count nothing before `at` — the sign-in — and starts
 * today over from it. False, never a throw, when it could not be told — a
 * build from before tracker 2.7 — which counts the day as it always did;
 * the server still counts only what was walked after the sign-in.
 */
async function countFrom(at: number): Promise<boolean> {
  try {
    const snapshot = await StepTracker.setCountFrom(at);
    useStepsStore.setState({ countingFrom: at, today: snapshot });
    return true;
  } catch (error) {
    logger.warn('steps', 'Counting from sign-in was not set', error);
    return false;
  }
}

/** Counting back on after a sign-out, for a user who never turned it off. */
async function resumeIfWanted(): Promise<void> {
  const state = await StepTracker.getTrackingState();
  if (state === 'running' || state === 'paused') {
    useStepsStore.setState({ trackingState: state, trackingWanted: true });
    return;
  }
  if (!steps().trackingWanted) {
    return;
  }
  const permissions = await StepTracker.checkPermissions();
  useStepsStore.setState({ permissions });
  // Revoked in system settings since: the tracking screen asks again.
  if (!permissions.allGranted) {
    return;
  }
  const snapshot = await StepTracker.startTracking();
  useStepsStore.setState({ today: snapshot, trackingState: snapshot.state });
}

function listen(id: number): void {
  if (!session) {
    return;
  }
  let lastPeriodicSync = Date.now();

  session.subscriptions = [
    StepTracker.addListener('stepsChanged', snapshot => {
      useStepsStore.setState({
        today: snapshot,
        trackingState: snapshot.state,
      });
    }),
    StepTracker.addListener('trackingStateChanged', ({ state }) => {
      useStepsStore.setState({ trackingState: state });
    }),
    // Yesterday is final now: send its last count, and start today afresh.
    StepTracker.addListener('dayChanged', ({ previousDate, currentDate }) => {
      refreshToday();
      scheduleSync([previousDate, currentDate], { force: true });
    }),
    // A closed day grew — recovered steps, or late ones from the sensor hub.
    StepTracker.addListener('historyBackfilled', ({ date }) => {
      scheduleSync([date], { force: true });
    }),
    // A watch came into range or a pin changed: the number may have moved
    // without a step to carry it.
    StepTracker.addListener('stepSourceChanged', () => {
      refreshToday();
    }),
    StepTracker.addListener('healthConnectStatusChanged', status => {
      useStepsStore.setState({ healthConnect: status });
    }),
    StepTracker.addListener('error', ({ code, message }) => {
      logger.warn('steps', `Tracker reported ${code}: ${message}`);
    }),
    AppState.addEventListener('change', next => {
      if (next === 'active' && isLive(id)) {
        catchUp(id);
      }
    }),
    // Back online with days waiting.
    {
      remove: NetInfo.addEventListener(state => {
        const online =
          state.isConnected === true && state.isInternetReachable !== false;
        if (online && isLive(id) && steps().queue.length > 0) {
          flush();
        }
      }),
    },
  ];

  // Today goes up every few minutes while the app is open (⚙
  // `activity.sync.intervalMinutes`), so the dashboard — which shows the
  // server's figures — keeps up with the walk.
  session.interval = setInterval(() => {
    const due = activityConfig().sync.intervalMinutes * 60_000;
    if (
      isLive(id) &&
      AppState.currentState === 'active' &&
      Date.now() - lastPeriodicSync >= due
    ) {
      lastPeriodicSync = Date.now();
      scheduleSync([todayIso()]);
    }
  }, TICK_MS);
}

// ─── Status ─────────────────────────────────────────────────────────────────

/** Which status read is the newest; an older one landing late is dropped. */
let statusRead = 0;

/**
 * Re-reads everything the screens show about counting — Health Connect's
 * grants too, unless the caller knows they are already on their way (see
 * `catchUp`).
 */
export async function refreshStepStatus({
  healthConnect: askHealthConnect = true,
}: { healthConnect?: boolean } = {}): Promise<void> {
  if (!session) {
    return;
  }
  // Reads overlap — a foreground and the start button can both ask while a
  // permission dialog closes — and a read begun before counting started
  // must not land after it and put the switch back to off.
  const read = (statusRead += 1);
  const [
    today,
    trackingState,
    permissions,
    healthConnect,
    trackingHealth,
    background,
  ] = await Promise.all([
    settle(StepTracker.getTodaySteps(), 'today'),
    settle(StepTracker.getTrackingState(), 'tracking state'),
    settle(StepTracker.checkPermissions(), 'permissions'),
    askHealthConnect
      ? settle(StepTracker.getHealthConnectStatus(), 'Health Connect')
      : null,
    settle(StepTracker.getTrackingHealth(), 'tracking health'),
    settle(StepTracker.getBackgroundRestrictionStatus(), 'background limits'),
  ]);
  if (!session || read !== statusRead) {
    return;
  }
  useStepsStore.setState(state => ({
    today: today ?? state.today,
    trackingState: trackingState ?? state.trackingState,
    permissions: permissions ?? state.permissions,
    healthConnect: healthConnect ?? state.healthConnect,
    trackingHealth: trackingHealth ?? state.trackingHealth,
    background: background ?? state.background,
  }));
}

async function refreshToday(): Promise<void> {
  const today = await settle(StepTracker.getTodaySteps(), 'today');
  if (today && session) {
    useStepsStore.setState({ today, trackingState: today.state });
  }
}

// ─── What the user does ─────────────────────────────────────────────────────

export type EnableTrackingResult =
  | 'started'
  | 'permission_denied'
  | 'no_sensor'
  | 'failed';

/**
 * Asks for physical activity (and, on Android 13+, notifications) and starts
 * counting. Called from the tracking screen, after it has said what is
 * counted and why — never on its own.
 */
export async function enableStepTracking(): Promise<EnableTrackingResult> {
  if (!session) {
    return 'failed';
  }
  try {
    const permissions = await StepTracker.requestPermissions();
    useStepsStore.setState({ permissions });
    if (!permissions.allGranted) {
      return 'permission_denied';
    }
    return await startCounting();
  } catch (error) {
    return startFailure(error);
  }
}

/** Counting on, once physical activity is allowed. */
async function startCounting(): Promise<EnableTrackingResult> {
  const snapshot = await StepTracker.startTracking();
  useStepsStore.setState({
    today: snapshot,
    trackingState: snapshot.state,
    trackingWanted: true,
  });
  refreshStepStatus();
  scheduleSync([todayIso()]);
  track('step_tracking_started');
  return 'started';
}

function startFailure(error: unknown): EnableTrackingResult {
  const code = error instanceof StepTrackerError ? error.code : null;
  if (code === 'E_PERMISSION_DENIED') return 'permission_denied';
  if (code === 'E_NO_SENSOR') return 'no_sensor';
  logger.warn('steps', 'Counting did not start', error);
  return 'failed';
}

/** Physical activity is a runtime permission from Android 10. */
const ACTIVITY_PERMISSION_FROM_API = 29;

const hasActivityPermission = async (): Promise<boolean> =>
  Platform.OS === 'android' &&
  (Number(Platform.Version) < ACTIVITY_PERMISSION_FROM_API ||
    (await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
    )));

/**
 * Counting asked for while the session that follows a sign-in was still
 * starting. The session turns it on as soon as it is up — see `catchUp`.
 */
let startWhenReady = false;

/**
 * The permission screens' first ask, after sign-in: physical activity on
 * its own — notifications have a screen of their own next — and counting
 * on. The session may still be starting a moment after sign-in; counting
 * then starts with it, so the user is never sent back to switch it on.
 */
export async function enableStepCounting(): Promise<EnableTrackingResult> {
  if (Platform.OS !== 'android' || !isSupported()) {
    return 'no_sensor';
  }
  try {
    const allowed =
      (await hasActivityPermission()) ||
      (await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
      )) === PermissionsAndroid.RESULTS.GRANTED;
    if (!allowed) {
      return 'permission_denied';
    }
    if (!session) {
      startWhenReady = true;
      return 'started';
    }
    return await startCounting();
  } catch (error) {
    return startFailure(error);
  }
}

/** Whether the permission screens should ask about counting: this phone can, and is not yet. */
export async function countingNeedsTurningOn(): Promise<boolean> {
  if (Platform.OS !== 'android' || !isSupported()) {
    return false;
  }
  try {
    const state = await StepTracker.getTrackingState();
    const counting = state === 'running' || state === 'paused';
    return !(counting && (await hasActivityPermission()));
  } catch {
    return true;
  }
}

/**
 * Whether the permission screens should offer Health Connect: it can be
 * used on this phone — installed or installable — and steps are not yet
 * allowed. Its status is kept for the screen that asks.
 */
export async function healthConnectNeedsConnecting(): Promise<boolean> {
  if (Platform.OS !== 'android' || !isSupported()) {
    return false;
  }
  try {
    const status = await StepTracker.getHealthConnectStatus();
    useStepsStore.setState({ healthConnect: status });
    if (status.availability === 'not_supported') {
      return false;
    }
    return !(status.stepsGranted ?? status.canReadSteps ?? status.canRead);
  } catch {
    return false;
  }
}

export async function pauseStepTracking(): Promise<void> {
  const snapshot = await StepTracker.pauseTracking();
  useStepsStore.setState({ today: snapshot, trackingState: snapshot.state });
}

export async function resumeStepTracking(): Promise<void> {
  const snapshot = await StepTracker.resumeTracking();
  useStepsStore.setState({ today: snapshot, trackingState: snapshot.state });
}

/** Turns counting off until the user turns it on again — sign-ins included. */
export async function stopStepTracking(): Promise<void> {
  track('step_tracking_stopped');
  const snapshot = await StepTracker.stopTracking();
  useStepsStore.setState({
    today: snapshot,
    trackingState: snapshot.state,
    trackingWanted: false,
  });
}

/** The app's own settings page, for a permission refused for good. */
export async function openStepPermissionSettings(): Promise<void> {
  await StepTracker.openAppSettings();
}

/**
 * Install, ask, or send to settings — whichever Health Connect needs next.
 * The answer is the status afterwards; a sheet the user dismissed is not an
 * error.
 */
export async function connectHealthConnect(): Promise<HealthConnectStatus> {
  const status = await StepTracker.enableHealthConnect();
  useStepsStore.setState({ healthConnect: status });
  return status;
}

/**
 * Asks for what Health Connect still lacks of what Vokve uses — for a user
 * who connected before Vokve wrote its steps there (D-57), the write grant.
 * `enableHealthConnect` stops at steps being readable, so this is the one
 * that shows the sheet for the rest. A sheet the user dismissed is not an
 * error; the answer is the status afterwards.
 */
export async function allowHealthConnectWrites(): Promise<HealthConnectStatus> {
  const status = await StepTracker.requestHealthConnectPermissions();
  useStepsStore.setState({ healthConnect: status });
  return status;
}

/**
 * Health Connect's own settings, where Vokve's access is managed — and the
 * only way left to grant it once the sheet has stopped appearing. Coming
 * back is a foreground, after which the tracker says if the grants moved.
 */
export async function openHealthConnectSettings(): Promise<void> {
  await StepTracker.openHealthConnectSettings();
}

/**
 * Takes Vokve's Health Connect access away at once — Android 13 and below,
 * where an app's own revocation is immediate (see the step tracking screen).
 */
export async function disconnectHealthConnect(): Promise<void> {
  await StepTracker.revokeHealthConnectPermissions();
  const status = await settle(
    StepTracker.getHealthConnectStatus(),
    'Health Connect',
  );
  if (status) {
    useStepsStore.setState({ healthConnect: status });
  }
}

/**
 * One screen of the phone's battery or autostart settings — never the direct
 * exemption prompt, which Play allows only for a few kinds of app. Called
 * again on a later visit until there is nothing left to lift.
 */
export async function improveBackgroundCounting(): Promise<
  'none' | 'battery' | 'autostart'
> {
  const opened = await StepTracker.requestBackgroundPermissions({
    directPrompt: false,
  });
  // Recoveries from here on are the ones that say the fix did not take.
  useStepsStore.setState({
    recoveriesAcknowledged: steps().trackingHealth?.recoveryCount ?? 0,
  });
  return opened;
}

/** How long sign-out waits for this phone's days to reach the server. */
const SIGN_OUT_FLUSH_MS = 8000;

/**
 * Everything this phone has counted, sent while the session can still send
 * it — the last thing a sign-out does before the tokens go.
 *
 * Counting stops at the sign-out and starts again at the next sign-in
 * (D-56), so the tail of today between the last sync and the sign-out is
 * the account's and will never be sent by anything else: after this the
 * tokens are gone, and the queue only moves again if *this* account signs
 * back in on *this* phone. Sign in on another phone instead and the day
 * shown there would be missing that tail for good.
 *
 * Bounded, and it never throws. Leaving must not wait on a slow network,
 * and a sync that could not finish is not a reason to keep somebody signed
 * in — what does not get out stays queued for the next sign-in here.
 */
export async function flushStepsForSignOut(
  timeoutMs = SIGN_OUT_FLUSH_MS,
): Promise<void> {
  if (!syncOwner()) {
    return;
  }
  scheduleSync(daysToCatchUp(), { force: true });
  await Promise.race([
    flush().catch(error => {
      logger.warn('steps', 'Sign-out sync did not finish', error);
    }),
    new Promise<void>(resolve => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

/**
 * Today and yesterday, now, whatever was sent last — then the server's week
 * again, so whatever asked sees the server's answer.
 */
export async function syncStepsNow(): Promise<void> {
  scheduleSync(daysToCatchUp(), { force: true });
  await flush();
  await refreshServerActivity();
  // Not awaited: whatever asked is waiting on the server, not on this.
  logStepDebug('sync now');
}

/**
 * What one headless sync did, for the handler that logs it.
 *
 * `no_owner` is a phone that has never counted for anybody, `signed_out`
 * one whose account has since left — the push was addressed to an install
 * that is no longer theirs — and `session` means the app was already
 * running and its own session sent the days instead.
 */
export type BackgroundSyncOutcome =
  | 'sent'
  | 'session'
  | 'no_owner'
  | 'signed_out';

/**
 * Sends what this phone has not sent, with no session and no screen: the
 * headless pass behind the server's silent "sync now" push (⚙
 * `activity.syncNudge`).
 *
 * Counting is native and survives the app being closed, but until now
 * uploading needed the app *open* — the periodic sync asks for an active
 * app, and the other triggers are a foreground and a network coming back
 * while it runs. So a phone counting faithfully in a pocket could go quiet
 * for a fortnight and then have those days refused as too old (⚙
 * `activity.maxAgeDays`). This is the floor under that: the server notices
 * the silence and asks, and this answers without the member doing anything.
 *
 * Nothing here needs a screen to have been mounted. The tracker reads on the
 * config it already holds — every method works before `initialize()` (tracker
 * 2.7) — the store hydrates from MMKV synchronously on import, and the API
 * client takes its tokens from the keychain per request and refreshes them
 * itself. What it does need is for the phone to still be this user's: a
 * signed-out install has nothing of theirs to send, and says so rather than
 * sending the days anyway.
 */
export async function syncStepsInBackground(): Promise<BackgroundSyncOutcome> {
  // The app is up: its session owns the queue, and a second sender beside it
  // would race it for the same days and the same nonces.
  if (session) {
    await syncStepsNow();
    return 'session';
  }
  const { ownerId, signedOutAt } = steps();
  if (!ownerId) {
    return 'no_owner';
  }
  // Signed out: the days are kept for the same account coming back
  // (`claimOwnership`), but there are no tokens left to send them with, and
  // nothing walked since is anybody's. The server does not nudge an install
  // in this state either; this is the phone's own half of that rule.
  if (signedOutAt !== null) {
    return 'signed_out';
  }
  backgroundOwner = ownerId;
  backgroundSyncs += 1;
  try {
    scheduleSync(daysToCatchUp());
    await flush();
  } finally {
    backgroundSyncs -= 1;
    if (backgroundSyncs === 0) {
      backgroundOwner = null;
    }
  }
  return 'sent';
}

/**
 * What Android's daily worker runs (RULES A28d) — the same sync the push
 * asks for, through the same code, so a day that arrives this way is
 * indistinguishable from one that arrived by push.
 *
 * Never throws: a headless task that rejects is logged by the OS against
 * the app, and there is nobody to tell. The days are still on the phone and
 * the window is a fortnight.
 */
export async function runStepSyncTask(): Promise<void> {
  try {
    const outcome = await syncStepsInBackground();
    logger.info('steps', `Daily step sync: ${outcome}`);
  } catch (error) {
    logger.warn('steps', 'Daily step sync failed', error);
  }
}

// ─── Sync ───────────────────────────────────────────────────────────────────

/**
 * Every day the ingest window still covers, oldest first.
 *
 * Not "yesterday and today", which is what this used to offer and is what
 * made the window a fiction: counting is native and survives the app being
 * closed, but the events that queue a *past* day — `dayChanged`,
 * `historyBackfilled` — only fire while a React instance is alive. So a
 * phone closed for a week came back, sent yesterday and today, and left the
 * five days in between on the device until they aged out (RULES A8) —
 * days the server would gladly have taken.
 *
 * Offering the whole window costs one local read each (`getStepsForDate`
 * is the tracker's own database, not the network) and almost no requests:
 * `shouldSend` drops an empty day, a day whose figures match its last
 * accepted sync, and a day already refused with these same numbers, all
 * before anything is signed or sent. It also picks up what the lost
 * `historyBackfilled` events would have said — a closed day that grew
 * while the app was shut is simply a day whose figures no longer match.
 */
function daysToCatchUp(): string[] {
  const today = todayIso();
  const window = Math.max(1, activityConfig().sync.maxAgeDays);
  return Array.from({ length: window + 1 }, (_, back) =>
    addDays(today, -(window - back)),
  );
}

/** Days whose next sync skips the gap kept between syncs of today. */
const forced = new Set<string>();

function scheduleSync(
  dates: string[],
  options: { force?: boolean } = {},
): void {
  if (!syncOwner()) {
    return;
  }
  if (options.force) {
    dates.forEach(date => forced.add(date));
  }
  steps().enqueue(dates);
  flush();
}

let flushing: Promise<void> | null = null;
let flushAgain = false;

/**
 * Sends the queue, oldest day first. One flush at a time; a call made while
 * one runs is folded into a second pass, so a day queued mid-flush is not
 * left waiting for the next trigger.
 */
function flush(): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = runFlush().finally(() => {
    flushing = null;
    if (flushAgain) {
      flushAgain = false;
      flush();
    }
  });
  return flushing;
}

type SyncOutcome =
  | { kind: 'sent' }
  | { kind: 'skipped' }
  /** The server refused the day itself; sending it again changes nothing. */
  | { kind: 'dropped' }
  /** Not now — offline, the server down, attestation pending. Kept queued. */
  | { kind: 'retry'; message: string };

async function runFlush(): Promise<void> {
  const owner = syncOwner();
  // Nothing goes up as this user's while the phone still holds another's.
  if (!owner || steps().ownerId !== owner) {
    return;
  }
  // A session that ends mid-flush abandons the rest of it. The headless pass
  // has no session to end, so it runs until its own owner is cleared.
  const id = session?.id;
  const live = () =>
    id === undefined ? backgroundOwner === owner : isLive(id);
  pruneBookkeeping();
  const dates = [...steps().queue];
  if (dates.length === 0) {
    return;
  }

  useStepsStore.setState({ syncStatus: 'syncing' });
  let failure: string | null = null;
  let sent = false;
  for (const date of dates) {
    const outcome = await syncDay(date);
    if (!live()) {
      return;
    }
    sent = sent || outcome.kind === 'sent';
    if (outcome.kind === 'retry') {
      // Whatever stopped this day stops the rest: they wait for the next
      // trigger rather than each failing the same way now.
      failure = outcome.message;
      break;
    }
    if (outcome.kind === 'dropped') {
      logger.warn('steps', `The server refused ${date}; not sending it again`);
    }
    forced.delete(date);
    useStepsStore.setState(state => ({
      queue: state.queue.filter(queued => queued !== date),
    }));
  }
  useStepsStore.setState({
    syncStatus: failure ? 'failed' : 'idle',
    syncError: failure,
  });
  // Each upload's answer is already on the dashboard; reading the week again
  // settles it against anything a read in flight brought back older.
  if (sent) {
    await refreshServerActivity();
  }
}

/**
 * Days the server would refuse leave the queue, and the per-day records
 * older than any day that can still be sent are dropped with them.
 */
function pruneBookkeeping(): void {
  const today = todayIso();
  const oldest = addDays(today, -activityConfig().sync.maxAgeDays);
  const keep = (date: string) => date >= oldest && date <= today;
  const pick = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([date]) => keep(date)));
  useStepsStore.setState(state => ({
    queue: state.queue.filter(keep),
    synced: pick(state.synced),
    refused: pick(state.refused),
    serverDays: pick(state.serverDays),
  }));
}

async function syncDay(date: string): Promise<SyncOutcome> {
  // Held outside the try so a refusal can be remembered against the exact
  // numbers that earned it.
  let figures: Omit<SyncedDayMark, 'at'> | null = null;
  try {
    const record = await StepTracker.getStepsForDate(date);
    figures = {
      steps: record.steps,
      recoveredSteps: record.recoveredSteps,
      suspectSteps: record.suspectSteps,
      externalSteps: record.stepSource?.externalSteps ?? 0,
    };
    if (!shouldSend(date, figures)) {
      return { kind: 'skipped' };
    }

    const deviceId = getDeviceId();
    if (!deviceId) {
      return {
        kind: 'retry',
        message: 'This phone is still being registered.',
      };
    }
    if (!(await ensureAttested(deviceId))) {
      return {
        kind: 'retry',
        message: "Syncing isn't set up on this phone yet. Trying again soon.",
      };
    }

    const result = await sendDay(date, deviceId);
    recordSent(date, figures, result);
    return { kind: 'sent' };
  } catch (error) {
    const outcome = classify(error);
    // Refused for what it is: remembered, so the window's next pass does
    // not offer the same numbers again (see `refused`).
    if (outcome.kind === 'dropped' && figures) {
      recordRefused(date, figures);
    }
    return outcome;
  }
}

/**
 * Whether a day has anything new for the server. An empty day that was
 * never sent has nothing to say; a day whose figures match its last
 * accepted sync is already there; and today is not sent more than once
 * every few minutes unless something asked for it.
 *
 * The best other Health Connect app's count is one of the figures: a
 * watch's steps arriving there may leave the phone's own number where it
 * was, and the server would otherwise never see them. A read that found
 * nothing is not news — Health Connect may just not have answered.
 */
function shouldSend(date: string, figures: Omit<SyncedDayMark, 'at'>): boolean {
  const state = steps();
  // Already refused with exactly these numbers: the server said no for a
  // reason that has not changed, and the window will offer this day again
  // on every foreground until it ages out.
  if (same(state.refused[date], figures)) {
    return false;
  }
  const mark = state.synced[date];
  if (!mark) {
    return figures.steps > 0;
  }
  const changed =
    mark.steps !== figures.steps ||
    mark.recoveredSteps !== figures.recoveredSteps ||
    mark.suspectSteps !== figures.suspectSteps ||
    ((figures.externalSteps ?? 0) > 0 &&
      mark.externalSteps !== figures.externalSteps);
  if (!changed) {
    return false;
  }
  if (
    date === todayIso() &&
    !forced.has(date) &&
    Date.now() - mark.at < activityConfig().sync.minGapSeconds * 1000
  ) {
    return false;
  }
  return true;
}

/** Whether a mark describes the figures in hand. */
function same(
  mark: SyncedDayMark | undefined,
  figures: Omit<SyncedDayMark, 'at'>,
): boolean {
  return (
    mark !== undefined &&
    mark.steps === figures.steps &&
    mark.recoveredSteps === figures.recoveredSteps &&
    mark.suspectSteps === figures.suspectSteps &&
    (mark.externalSteps ?? 0) === (figures.externalSteps ?? 0)
  );
}

/** The day the server refused, and what it was refused with. */
function recordRefused(date: string, figures: Omit<SyncedDayMark, 'at'>): void {
  useStepsStore.setState(state => ({
    refused: { ...state.refused, [date]: { ...figures, at: Date.now() } },
  }));
}

function recordSent(
  date: string,
  figures: Omit<SyncedDayMark, 'at'>,
  result: StepIngestResult,
): void {
  const at = Date.now();
  useStepsStore.setState(state => ({
    synced: { ...state.synced, [date]: { ...figures, at } },
    serverDays: { ...state.serverDays, [date]: result.day },
    lastSyncedAt: at,
  }));
  patchServerWeek(result.day);
  // The answer has the other phones in it as of this upload.
  shareOtherDevicesSteps();
  if (result.coinsHeld > 0) {
    useCoinsStore.getState().hydrateFromServer();
  }
  // The server says when a sync took the day to the goal; the streak it
  // earned is the server's to count, so it is asked again rather than guessed.
  if (result.streakEarned) {
    useStreakStore.getState().hydrateFromServer();
  }
}

function classify(error: unknown): SyncOutcome {
  if (error instanceof StepTrackerError) {
    // A date the tracker cannot read is not going to become readable.
    return error.code === 'E_INVALID_CONFIG'
      ? { kind: 'dropped' }
      : { kind: 'retry', message: error.message };
  }
  const apiError = toApiError(error);
  // The day itself was refused — too old, unreadable, not signed right.
  if (apiError.kind === 'validation') {
    return { kind: 'dropped' };
  }
  return { kind: 'retry', message: apiError.message };
}

/**
 * Takes a nonce, has the tracker sign the day with it, and sends that. A
 * spent or expired nonce means a new one and a new snapshot; a key the
 * server has not seen means attesting once more first.
 */
async function sendDay(
  date: string,
  deviceId: string,
): Promise<StepIngestResult> {
  let reattested = false;
  for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
    const { nonce } = await activityApi.ingestNonce();
    const snapshot = await StepTracker.getSignedSnapshot(
      date,
      await snapshotOptions(nonce),
    );
    try {
      return await ingest(date, snapshot);
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'NONCE_INVALID') {
        continue;
      }
      if (apiError.code === 'ATTESTATION_REQUIRED' && !reattested) {
        reattested = true;
        useStepsStore.setState({ attestedDeviceId: null });
        if (await ensureAttested(deviceId)) {
          continue;
        }
      }
      throw apiError;
    }
  }
  throw new ApiError(
    'unknown',
    'Steps could not be synced. Trying again later.',
  );
}

/**
 * The evidence the snapshot carries inside its signature, as the server asks
 * for it (⚙ `activity.sync.include`): typically the day's minutes, motion
 * windows and raw Health Connect records. Records only of types the user
 * allowed — asking for one that is not makes the tracker leave the records
 * out altogether.
 *
 * Which types are allowed comes from the status the session already holds:
 * asking Health Connect again for every day sent spends its rate limit on an
 * answer that has not changed. A grant that moved since is no harm — the
 * tracker leaves out records it may not read, and says so.
 */
async function snapshotOptions(
  nonce: string,
): Promise<Omit<VerificationSnapshotOptions, 'sign'>> {
  const { include, healthConnectRecordTypes } = activityConfig().sync;
  const wantsRecords = include.includes('healthConnectRecords');
  const others = include.filter(part => part !== 'healthConnectRecords');
  if (!wantsRecords) {
    return { nonce, include: others };
  }
  const status =
    steps().healthConnect ??
    (await settle(StepTracker.getHealthConnectStatus(), 'Health Connect'));
  // `grantedReadTypes` is sent from tracker 2.1.1; the booleans cover older.
  const granted: readonly string[] =
    status?.grantedReadTypes ??
    (status?.canRead
      ? healthConnectRecordTypes
      : status?.canReadSteps
      ? ['steps']
      : []);
  const recordTypes = healthConnectRecordTypes.filter(type =>
    granted.includes(type),
  );
  if (recordTypes.length === 0) {
    return { nonce, include: others };
  }
  return {
    nonce,
    include: [...others, 'healthConnectRecords'],
    healthConnectRecordTypes: recordTypes,
  };
}

/**
 * Sends one snapshot, and once more with a Play Integrity token if the
 * server asks for a fresh verdict. Each send is its own attempt with its
 * own idempotency key; the server dedupes the snapshot on its hash.
 */
async function ingest(
  date: string,
  snapshot: SnapshotSignature,
): Promise<StepIngestResult> {
  try {
    return await activityApi.ingest(
      { date, snapshot },
      { idempotencyKey: uuid() },
    );
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.code !== 'INTEGRITY_REQUIRED') {
      throw apiError;
    }
    const integrity = await integrityFor(snapshot, apiError.details);
    return activityApi.ingest(
      { date, snapshot, integrity },
      { idempotencyKey: uuid() },
    );
  }
}

/**
 * A token bound to the snapshot's hash, for the project the server named.
 * When Play will not give one — no Play Store, an old Play services, a
 * sideloaded build — the reason goes instead, and the server decides what
 * a day without a verdict is worth.
 */
async function integrityFor(
  snapshot: SnapshotSignature,
  details: Record<string, unknown> | null,
): Promise<IngestIntegrity> {
  const named = details?.cloudProjectNumber;
  if (typeof named === 'number' && named !== steps().cloudProjectNumber) {
    useStepsStore.setState({ cloudProjectNumber: named });
  }
  const cloudProjectNumber =
    typeof named === 'number'
      ? named
      : activityConfig().playIntegrity.cloudProjectNumber ??
        steps().cloudProjectNumber;
  if (!cloudProjectNumber) {
    return { error: 'NO_CLOUD_PROJECT', retryable: false };
  }
  try {
    const { token } = await StepTracker.requestIntegrityToken({
      requestHash: snapshot.payloadSha256,
      cloudProjectNumber,
    });
    return { token };
  } catch (error) {
    const failure = error instanceof StepTrackerError ? error : null;
    const play = failure?.details as Partial<IntegrityErrorDetails> | undefined;
    return {
      error: play?.playError ?? failure?.code ?? 'E_UNKNOWN',
      retryable: play?.retryable === true,
    };
  }
}

let attesting: Promise<boolean> | null = null;

/**
 * Makes sure the server holds this install's key, attesting when it does
 * not. Once per device, not per launch: every `attestDevice()` replaces the
 * key, so attesting again would only orphan the one the server has.
 */
async function ensureAttested(deviceId: string): Promise<boolean> {
  if (
    steps().attestedDeviceId === deviceId &&
    (await StepTracker.hasAttestationKey())
  ) {
    return true;
  }
  attesting =
    attesting ??
    attest(deviceId).finally(() => {
      attesting = null;
    });
  return attesting;
}

async function attest(deviceId: string): Promise<boolean> {
  try {
    const { challenge } = await deviceApi.attestationChallenge(deviceId);
    const key = await StepTracker.attestDevice(challenge);
    await deviceApi.submitAttestation(deviceId, {
      keyId: key.keyId,
      algorithm: key.algorithm,
      publicKey: key.publicKey,
      certificateChain: key.certificateChain,
      attested: key.attested,
      securityLevel: key.securityLevel,
      createdAt: key.createdAt,
    });
    useStepsStore.setState({ attestedDeviceId: deviceId });
    return true;
  } catch (error) {
    logger.warn('steps', 'Device attestation did not complete', error);
    return false;
  }
}
