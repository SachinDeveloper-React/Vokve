import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  BackgroundRestrictionStatus,
  HealthConnectStatus,
  PermissionStatus,
  StepSnapshot,
  TrackingHealth,
  TrackingState,
} from 'react-native-step-tracker-pro';
import type { ActivityConfig, DailyActivity } from '../types/models';
import { todayIso } from '../utils/date';
import { mmkvStorage } from './index';

export type StepSyncStatus = 'idle' | 'syncing' | 'failed';

/**
 * What the last accepted sync of a day carried. A day whose figures still
 * match is not sent again: the server already has exactly that.
 */
export interface SyncedDayMark {
  steps: number;
  recoveredSteps: number;
  suspectSteps: number;
  /**
   * The best other Health Connect app's count — a watch's, say. Absent on
   * marks kept from before it was recorded.
   */
  externalSteps?: number;
  /** Epoch ms the server took it. */
  at: number;
}

interface StepsState {
  /**
   * Whether this phone can count steps at all — Android, with the tracker
   * linked. Null until a session has asked; iOS answers false until
   * HealthKit lands (PHASES.md, phase 6).
   */
  supported: boolean | null;
  trackingState: TrackingState;
  permissions: PermissionStatus | null;
  /** Today as the tracker on this phone counts it, kept live by its `stepsChanged` event. */
  today: StepSnapshot | null;
  healthConnect: HealthConnectStatus | null;
  trackingHealth: TrackingHealth | null;
  background: BackgroundRestrictionStatus | null;
  syncStatus: StepSyncStatus;
  /** The last sync's failure, worded for the user; null after a success. */
  syncError: string | null;

  // Kept across launches. All of it belongs to `ownerId`, and goes when the
  // phone changes hands — see `claimOwnership` in `services/steps`.

  /** The account whose steps the tracker's history holds. */
  ownerId: string | null;
  /**
   * The user turned counting on and has not turned it off. Signing out
   * stops the service without clearing this, so signing back in resumes.
   */
  trackingWanted: boolean;
  /** Days waiting to reach the server, `YYYY-MM-DD`. */
  queue: string[];
  synced: Record<string, SyncedDayMark>;
  /** The server's side of each synced day — what it verified. */
  serverDays: Record<string, DailyActivity>;
  /**
   * The last seven days as the server holds them, today last — what the
   * dashboard shows. Kept, so the app opens on the last known figures.
   */
  serverWeek: DailyActivity[];
  /** Epoch ms `serverWeek` was last read; null before the first. */
  serverWeekAt: number | null;
  /** How the tracker is set up and when it syncs, as the server last said (`GET /activity/config`). */
  activityConfig: ActivityConfig | null;
  lastSyncedAt: number | null;
  /** The server device the install's Keystore key was attested for. */
  attestedDeviceId: string | null;
  /** The Cloud project Play Integrity tokens are requested for, as the server last named it. */
  cloudProjectNumber: number | null;
  /**
   * The service's recovery count when the user last went to fix the
   * phone's background limits; null until they have. Recoveries past it are
   * what say the fix did not take.
   */
  recoveriesAcknowledged: number | null;

  enqueue: (dates: string[]) => void;
  /** Forgets everything about the live session; the kept bookkeeping stays. */
  resetLive: () => void;
}

const LIVE_DEFAULTS = {
  supported: null,
  trackingState: 'idle' as TrackingState,
  permissions: null,
  today: null,
  healthConnect: null,
  trackingHealth: null,
  background: null,
  syncStatus: 'idle' as StepSyncStatus,
  syncError: null,
};

export const useStepsStore = create<StepsState>()(
  persist(
    set => ({
      ...LIVE_DEFAULTS,
      ownerId: null,
      trackingWanted: false,
      queue: [],
      synced: {},
      serverDays: {},
      serverWeek: [],
      serverWeekAt: null,
      activityConfig: null,
      lastSyncedAt: null,
      attestedDeviceId: null,
      cloudProjectNumber: null,
      recoveriesAcknowledged: null,

      enqueue: dates =>
        set(state => {
          const missing = dates.filter(date => !state.queue.includes(date));
          return missing.length === 0
            ? state
            : { queue: [...state.queue, ...missing].sort() };
        }),

      resetLive: () => set(LIVE_DEFAULTS),
    }),
    {
      name: 'vokve.steps',
      storage: createJSONStorage(() => mmkvStorage),
      version: 2,
      partialize: state => ({
        ownerId: state.ownerId,
        trackingWanted: state.trackingWanted,
        queue: state.queue,
        synced: state.synced,
        serverDays: state.serverDays,
        serverWeek: state.serverWeek,
        serverWeekAt: state.serverWeekAt,
        activityConfig: state.activityConfig,
        lastSyncedAt: state.lastSyncedAt,
        attestedDeviceId: state.attestedDeviceId,
        cloudProjectNumber: state.cloudProjectNumber,
        recoveriesAcknowledged: state.recoveriesAcknowledged,
      }),
    },
  ),
);

export const useStepsSupported = () => useStepsStore(s => s.supported);
export const useTrackingState = () => useStepsStore(s => s.trackingState);
export const useStepPermissions = () => useStepsStore(s => s.permissions);
export const useHealthConnectStatus = () => useStepsStore(s => s.healthConnect);
export const useTrackingHealth = () => useStepsStore(s => s.trackingHealth);
export const useBackgroundRestrictions = () => useStepsStore(s => s.background);
export const useStepSyncStatus = () => useStepsStore(s => s.syncStatus);
export const useStepSyncError = () => useStepsStore(s => s.syncError);
export const useLastStepSyncAt = () => useStepsStore(s => s.lastSyncedAt);
export const usePendingStepDays = () => useStepsStore(s => s.queue.length);
export const useTodaySnapshot = () => useStepsStore(s => s.today);

/** The server's seven days, today last. */
export const useServerWeek = () => useStepsStore(s => s.serverWeek);

/** Today as the server holds it, once it has been read or a sync has landed. */
export const useServerToday = (): DailyActivity | null => {
  const week = useServerWeek();
  const days = useStepsStore(s => s.serverDays);
  return useMemo(() => {
    const today = todayIso();
    return week.find(day => day.date === today) ?? days[today] ?? null;
  }, [days, week]);
};

const isCounting = (state: TrackingState) =>
  state === 'running' || state === 'paused';

/** Counting is on — running, or paused from the notification. */
export const useIsTracking = () =>
  useStepsStore(s => isCounting(s.trackingState));

/**
 * Why counting may not survive the app being closed:
 * `stopped` — the phone has already killed the service more than a reboot
 * or a one-off explains; `battery` — battery optimisation still applies;
 * `autostart` — a maker known to kill services, never looked at.
 */
export type BackgroundRisk = 'stopped' | 'battery' | 'autostart';

/**
 * Recoveries past the acknowledged count before the phone is blamed. One is
 * a reboot or a low-memory restart; it is the climb that means an OEM task
 * killer.
 */
const RECOVERIES_BEFORE_WARNING = 2;

export function backgroundRiskOf(
  state: Pick<
    StepsState,
    'trackingState' | 'trackingHealth' | 'background' | 'recoveriesAcknowledged'
  >,
): BackgroundRisk | null {
  if (!isCounting(state.trackingState)) {
    return null;
  }
  const health = state.trackingHealth;
  const acknowledged = state.recoveriesAcknowledged ?? 0;
  if (
    health &&
    (health.looksDead ||
      health.recoveryCount - acknowledged >= RECOVERIES_BEFORE_WARNING)
  ) {
    return 'stopped';
  }
  const background = state.background;
  if (background?.batteryOptimizationEnabled) {
    return 'battery';
  }
  // Nothing says whether an OEM's autostart switch was flipped, so this is
  // offered until the user has been once; after that only `stopped` brings
  // the card back.
  if (
    background?.aggressiveOem &&
    background.autoStartSettingsAvailable &&
    state.recoveriesAcknowledged === null
  ) {
    return 'autostart';
  }
  return null;
}

export const useBackgroundRisk = () => useStepsStore(backgroundRiskOf);

/**
 * `setup` — counting is off and the user has never turned it on, or turned
 * it off. `attention` — it is meant to be on and is not doing its job: a
 * permission revoked, or a phone that keeps killing it.
 */
export type StepPromptVariant = 'setup' | 'attention';

/** What the dashboard should say about counting, if anything. */
export const useStepPrompt = (): StepPromptVariant | null =>
  useStepsStore(state => {
    if (state.supported !== true || state.trackingState === 'unsupported') {
      return null;
    }
    if (!isCounting(state.trackingState)) {
      return state.trackingWanted ? 'attention' : 'setup';
    }
    return backgroundRiskOf(state) === 'stopped' ? 'attention' : null;
  });

export interface TodayActivity {
  steps: number;
  distanceKm: number;
  caloriesBurned: number;
  activeMinutes: number;
}

/**
 * Today's figures for the dashboard, the analytics summary and nutrition —
 * the server's, never worked out on the phone. Zero until the server has
 * answered for today.
 */
export const useTodayActivity = (): TodayActivity => {
  const today = useServerToday();
  return useMemo(
    () => ({
      steps: today?.steps ?? 0,
      distanceKm: today?.distanceKm ?? 0,
      caloriesBurned: today?.caloriesBurned ?? 0,
      activeMinutes: today?.activeMinutes ?? 0,
    }),
    [today],
  );
};

/**
 * What the tracker on this phone has counted today — the step tracking
 * screen's live figure, before it has reached the server. A snapshot from an
 * earlier day reads as zero: the app can sit across midnight with nothing to
 * replace it until it comes back.
 */
export const usePhoneStepsToday = (): number =>
  useStepsStore(s =>
    s.today && s.today.date === todayIso() ? s.today.steps : 0,
  );
