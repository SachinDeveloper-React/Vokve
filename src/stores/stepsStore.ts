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
   * The instant this phone counts `ownerId` from (D-56): the sign-in the
   * tracker was told to start at (`setCountFrom`). Null for an owner from
   * before the tracker could be told.
   */
  countingFrom: number | null;
  /** When `ownerId` last signed out on this phone; null while signed in. */
  signedOutAt: number | null;
  /**
   * The user turned counting on and has not turned it off. Signing out
   * stops the service without clearing this, so signing back in resumes.
   */
  trackingWanted: boolean;
  /** Days waiting to reach the server, `YYYY-MM-DD`. */
  queue: string[];
  synced: Record<string, SyncedDayMark>;
  /**
   * Days the server refused outright, and the figures it refused — a day
   * past the ingest window, or one the tracker cannot read.
   *
   * Kept because the app now re-offers every day in the window on each
   * foreground (`daysToCatchUp`), and without this a day that can never be
   * accepted would be offered, refused and dropped again on every single
   * one. Keyed on the figures rather than the date alone, so a day whose
   * count has since *moved* is tried once more: the same numbers being
   * refused twice says something permanent, a new number says nothing yet.
   */
  refused: Record<string, SyncedDayMark>;
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
      countingFrom: null,
      signedOutAt: null,
      trackingWanted: false,
      queue: [],
      synced: {},
      refused: {},
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
        countingFrom: state.countingFrom,
        signedOutAt: state.signedOutAt,
        trackingWanted: state.trackingWanted,
        queue: state.queue,
        synced: state.synced,
        refused: state.refused,
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
/**
 * Whether this phone's steps are written into Health Connect (D-57), as the
 * server's set-up says — on, as it ships, before the server has answered.
 */
export const useHealthConnectWrites = () =>
  useStepsStore(
    s => s.activityConfig?.tracker.healthConnectWriteEnabled ?? true,
  );
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

/**
 * How much of a day's count stood up to the server's checks:
 *
 * - `pending` — the server has not answered for the day yet;
 * - `verified` — every step it counted is verified, a day with none included;
 * - `partly` — part of the count is verified and part of it is not;
 * - `held` — the day counted steps and the server verified none of them.
 */
export type VerifiedState = 'pending' | 'verified' | 'partly' | 'held';

export interface VerifiedActivity {
  /** Steps that passed every check — the only step figure a screen shows. */
  steps: number;
  /** Everything the day counted, verified or not. */
  counted: number;
  /** `counted` less `steps`: counted on a phone, and not verified. */
  unverified: number;
  /** Distance, calories and active minutes, cut to the verified share. */
  distanceKm: number;
  caloriesBurned: number;
  activeMinutes: number;
  state: VerifiedState;
}

const NOTHING_COUNTED: VerifiedActivity = {
  steps: 0,
  counted: 0,
  unverified: 0,
  distanceKm: 0,
  caloriesBurned: 0,
  activeMinutes: 0,
  state: 'pending',
};

/**
 * A day cut to the steps the server verified — the real ones.
 *
 * A phone's counter, and the notification its service draws from it, carry
 * everything the phone saw: a watch's steps read out of Health Connect, and
 * the steps the counter handed over in one go when an OEM task killer let
 * the service back (`recoveredSteps`, and the untimed steps with them). The
 * server judges every day it is sent (BACKEND §7.5) and answers with both
 * figures — `steps`, what a phone showed, and `verifiedSteps`, what stood
 * up. Only the second is shown, so no screen promises a count the coins,
 * the streak and the leaderboard will not pay on.
 *
 * Distance, calories and active minutes are the server's too and are worked
 * out from the whole day, so the same share comes off them: 8,569 verified
 * steps out of 11,199 must not carry 11,199 steps' distance.
 */
export function verifiedActivityOf(
  day: DailyActivity | null | undefined,
): VerifiedActivity {
  if (!day) {
    return NOTHING_COUNTED;
  }
  const counted = Math.max(0, Math.round(day.steps));
  // Never above the day's own count, whatever arrived: a verified figure
  // larger than the day it belongs to is a server the app cannot reconcile,
  // and the smaller of the two is the safe way to be wrong about steps.
  const steps = Math.min(counted, Math.max(0, Math.round(day.verifiedSteps)));
  const share = counted > 0 ? steps / counted : 1;
  return {
    steps,
    counted,
    unverified: counted - steps,
    distanceKm: day.distanceKm * share,
    caloriesBurned: day.caloriesBurned * share,
    activeMinutes: Math.round(day.activeMinutes * share),
    state:
      counted === 0
        ? 'verified'
        : steps === 0
        ? 'held'
        : steps < counted
        ? 'partly'
        : 'verified',
  };
}

/**
 * One day's verified steps on their own — for a chart, where a day the
 * server has not answered for yet is a bar of zero rather than a gap. Takes
 * a stored day or a range point, both of which carry the two figures.
 */
export const verifiedStepsOf = (
  day: Pick<DailyActivity, 'steps' | 'verifiedSteps'> | null | undefined,
): number =>
  day
    ? Math.min(
        Math.max(0, Math.round(day.steps)),
        Math.max(0, Math.round(day.verifiedSteps)),
      )
    : 0;

/**
 * Today, cut to what the server verified. `pending` with everything at zero
 * until the server has answered for today.
 */
export const useVerifiedToday = (): VerifiedActivity => {
  const today = useServerToday();
  return useMemo(() => verifiedActivityOf(today), [today]);
};

/**
 * What this phone has counted today beyond what it last got the server to
 * accept, less the part of it the phone already doubts.
 *
 * Zero when a sync is up to date, when the only snapshot is from an earlier
 * day, and when the phone's count has gone *backwards* against the mark — a
 * counter reset, or a day starting over at a sign-in — which the next sync
 * settles rather than this. The other phones' steps are left out: they are
 * already inside the server's figure this is added to, and counting them
 * here would show them twice.
 *
 * The tracker's own integrity checks run live, so by the time a shaken or
 * in-vehicle minute reaches this it is already counted in the snapshot's
 * `suspectSteps` (the tracker runs in `flag` mode, which reports them and
 * removes nothing). Taking the ones that arrived since the last sync off the
 * tail is what stops the dashboard counting a minute it can already see the
 * server will refuse: a minute walked and flagged in the same breath adds to
 * both figures, so the number **stalls** rather than climbing and then being
 * taken back.
 *
 * Under `exclude` the tracker has already removed them from its own count,
 * and subtracting again would discount them twice — so the mode is checked
 * rather than assumed. It is one switch away in the operator's config.
 */
export function liveTailOf(
  state: Pick<StepsState, 'today' | 'synced' | 'activityConfig'>,
): number {
  const today = todayIso();
  if (!state.today || state.today.date !== today) {
    return 0;
  }
  const mark = state.synced[today];
  const phone = state.today.steps - (state.today.otherDevicesSteps ?? 0);
  const counted = phone - (mark?.steps ?? 0);
  // What the phone has flagged since the server last took a figure from it.
  const flagged =
    (state.activityConfig?.tracker.fraudDetection.mode ?? 'flag') === 'flag'
      ? Math.max(0, state.today.suspectSteps - (mark?.suspectSteps ?? 0))
      : 0;
  return Math.max(0, Math.round(counted - flagged));
}

export interface TodaySteps extends VerifiedActivity {
  /** The verified figure plus this phone's live tail — what a screen shows. */
  shown: number;
  /** This phone's steps since its last accepted sync. */
  live: number;
}

/**
 * Today's steps for the dashboard: what the server verified, plus what this
 * phone has counted since its last accepted sync.
 *
 * The verified figure on its own only moves when a sync lands — every few
 * minutes at best, and not at all while the app is closed — so the number
 * stood still through a walk and then jumped. The tail is this phone's own
 * count past what it last sent: live, small, and judged on the next sync,
 * which is what makes the figure climb with the walk (3,000 → 3,002 →
 * 3,006) instead of sitting and leaping.
 *
 * The tail is cut by the share of today the server has been verifying, for
 * the reason this whole figure exists: on a day it has verified *none* of,
 * an unjudged tail would put the refused count back on the dashboard a few
 * steps at a time — which is the number that disagreed with the
 * notification in the first place. So a held day does not climb; it waits
 * for a sync to say the day is worth something. A day the server has not
 * answered for at all does not climb either, and a day it has answered for
 * with nothing counted yet is an ordinary morning, where the tail stands.
 *
 * Only the step count carries it. Distance, calories and active minutes
 * stay the server's verified figures: they are its arithmetic over the
 * whole day, and a tail's worth of distance guessed here would not match
 * what the next sync replaces it with.
 *
 * The share and the tail's own flagged steps overlap a little — the share
 * already knows the server drops what the phone flagged — so a flagged step
 * is discounted about three per cent twice. Both corrections pull the same
 * way, which is downwards, so the figure is never above what the day will
 * stand up; a tenth of a step is not worth a second arithmetic path to
 * avoid it.
 */
export const useTodaySteps = (): TodaySteps => {
  const verified = useVerifiedToday();
  const counted = useStepsStore(liveTailOf);
  return useMemo(() => {
    const share =
      verified.counted > 0 ? verified.steps / verified.counted : 1;
    const live =
      verified.state === 'pending' ? 0 : Math.round(counted * share);
    return { ...verified, live, shown: verified.steps + live };
  }, [counted, verified]);
};

/**
 * What the tracker on this phone has counted today — the step tracking
 * screen's live figure, before it has reached the server. Its own count,
 * without the other phones' steps the tracker shows on top of it. A
 * snapshot from an earlier day reads as zero: the app can sit across
 * midnight with nothing to replace it until it comes back.
 */
export const usePhoneStepsToday = (): number =>
  useStepsStore(s =>
    s.today && s.today.date === todayIso()
      ? s.today.steps - (s.today.otherDevicesSteps ?? 0)
      : 0,
  );

/**
 * The user's other phones' steps today, as the tracker shows them on top of
 * this phone's — the server's day less what this phone sent it (D-53).
 */
export const useOtherDevicesStepsToday = (): number =>
  useStepsStore(s =>
    s.today && s.today.date === todayIso() ? s.today.otherDevicesSteps ?? 0 : 0,
  );
