import { PermissionsAndroid, Platform } from 'react-native';
import type { HealthConnectStatus } from 'react-native-step-tracker-pro';
import { getMMKV } from '../stores';
import { useStepsStore } from '../stores/stepsStore';
import type { PermissionEntry, PermissionState } from '../types/models';
import { logger } from '../utils/logger';
import { track } from './analytics';
import { activityApi, telemetryApi } from './api/endpoints';
import { toApiError } from './api/errors';
import { getDeviceId } from './device';
import { notificationsAllowed } from './push';
import { countingNeedsTurningOn, healthConnectNeedsConnecting } from './steps';

/** How long the set-up waits on the server before it asks for a goal anyway. */
const GOAL_CHECK_TIMEOUT_MS = 4000;

/**
 * The permission screens after sign-in, in the order they ask: physical
 * activity (and counting on), notifications, Health Connect.
 */
export type PermissionStep = 'activity' | 'notifications' | 'healthConnect';

/**
 * The screens this phone still needs, in order. A permission already
 * granted is not asked for again, and one the phone has no use for — Health
 * Connect where it is not supported, physical activity on a phone that
 * cannot count — is not asked for at all. Never throws: a check that fails
 * asks rather than skips, except Health Connect, which is optional.
 */
export async function pendingPermissionSteps(): Promise<PermissionStep[]> {
  const [activity, notifications, healthConnect] = await Promise.all([
    countingNeedsTurningOn().catch(() => true),
    notificationsAllowed().then(
      allowed => !allowed,
      () => true,
    ),
    healthConnectNeedsConnecting().catch(() => false),
  ]);
  const steps: PermissionStep[] = [];
  if (activity) steps.push('activity');
  if (notifications) steps.push('notifications');
  if (healthConnect) steps.push('healthConnect');
  return steps;
}

/**
 * Whether the set-up after sign-in ends on the daily step goal (D-55): only
 * while the account has never chosen one. The goal is the account's, so one
 * chosen on another phone is not asked for again. A server that does not
 * answer in time, or at all, means asking — the goal screen works without
 * it, and asking twice costs a tap where not asking would cost the goal.
 */
export async function stepGoalNeedsChoosing(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      activityApi.goal().then(goal => goal.chosenAt === null),
      new Promise<boolean>(resolve => {
        timer = setTimeout(() => resolve(true), GOAL_CHECK_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

// ─── What the phone lets us do, and whether the server knows (RULES P14) ───

/**
 * Reporting the permissions is *not* asking for them. Nothing here opens a
 * dialog: it reads what the OS already answered, so support can tell why a
 * member's steps are zero or why a reminder never arrived without asking
 * them to read out a settings screen over the phone.
 *
 * The tracker's own grants are read from the steps store, which
 * `services/steps` owns and keeps current; the OS-level ones are asked of
 * the OS directly, so a launch that has not started a step session yet
 * still reports the truth.
 */
const SENT_KEY = 'vokve.permissions.sent';
/** A set of answers that has not changed is still re-sent this often, so a snapshot is never a mystery as to its age. */
const RECHECK_MS = 12 * 60 * 60 * 1000;

function sentCache(): { signature: string; at: number } | null {
  try {
    const raw = getMMKV().getString(SENT_KEY);
    return raw ? (JSON.parse(raw) as { signature: string; at: number }) : null;
  } catch {
    return null;
  }
}

function rememberSent(signature: string): void {
  try {
    getMMKV().set(SENT_KEY, JSON.stringify({ signature, at: Date.now() }));
  } catch (error) {
    logger.warn('permissions', 'Could not remember what was reported', error);
  }
}

const granted = (yes: boolean): PermissionState => (yes ? 'granted' : 'denied');

/**
 * Every permission this build knows about, as the OS answers it now.
 *
 * The whole set every time, including the ones this phone cannot have: a
 * report that left them out could never say that Health Connect is missing,
 * which is itself the answer to "why is the watch not counted".
 *
 * `blocked` is never reported from here. Telling it apart from `denied`
 * means asking — Android only says "never again" in answer to a request —
 * and a dialog the member did not ask for is too high a price for a finer
 * word. The screens that do ask report it when they hear it.
 */
export async function collectPermissions(): Promise<PermissionEntry[]> {
  const android = Platform.OS === 'android';
  const { permissions, healthConnect, background } = useStepsStore.getState();
  const entries: PermissionEntry[] = [];

  if (!android) {
    entries.push({
      key: 'activityRecognition',
      state: 'unavailable',
      detail: 'iOS counts through HealthKit',
    });
  } else {
    // Asked of the OS, not of the store: this is the one permission whose
    // answer decides whether anything counts at all, and it has to be right
    // on a launch that has not started a session yet.
    const allowed = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
    ).catch(() => permissions?.activityRecognition ?? null);
    entries.push({
      key: 'activityRecognition',
      state: allowed === null ? 'unknown' : granted(allowed),
    });
  }

  const notifications = await notificationsAllowed().catch(() => null);
  entries.push({
    key: 'notifications',
    state: notifications === null ? 'unknown' : granted(notifications),
    ...(Platform.OS === 'android' && Platform.Version < 33
      ? { detail: 'no permission needed below Android 13' }
      : {}),
  });

  entries.push(...healthConnectEntries(android, healthConnect));

  if (!android) {
    entries.push({
      key: 'batteryUnrestricted',
      state: 'unavailable',
      detail: 'iOS has no battery optimisation to exempt',
    });
  } else if (!background) {
    entries.push({ key: 'batteryUnrestricted', state: 'unknown' });
  } else {
    entries.push({
      key: 'batteryUnrestricted',
      state: granted(!background.batteryOptimizationEnabled),
      ...(background.aggressiveOem
        ? { detail: `aggressive OEM: ${background.manufacturer || background.brand}` }
        : {}),
    });
  }

  if (android) {
    const camera = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.CAMERA,
    ).catch(() => null);
    entries.push({
      key: 'camera',
      state: camera === null ? 'unknown' : granted(camera),
    });
    // The photo library is reached through the system picker, which hands
    // back one picked image and needs no permission at all — so there is
    // nothing here that could be refused.
    entries.push({
      key: 'photos',
      state: 'unavailable',
      detail: 'system photo picker, no permission needed',
    });
  } else {
    // iOS answers these only in reply to a request, and this never asks.
    entries.push({ key: 'camera', state: 'unknown' });
    entries.push({ key: 'photos', state: 'unknown' });
  }

  return entries;
}

function healthConnectEntries(
  android: boolean,
  status: HealthConnectStatus | null,
): PermissionEntry[] {
  const keys = ['healthConnectReadSteps', 'healthConnectWriteSteps'] as const;
  if (!android) {
    return keys.map(key => ({
      key,
      state: 'unavailable' as PermissionState,
      detail: 'Android only',
    }));
  }
  if (!status) {
    return keys.map(key => ({ key, state: 'unknown' as PermissionState }));
  }
  if (status.availability !== 'available') {
    // Not installed, or too old to use: the grants cannot be held either way,
    // and which of the two it is decides what the app can offer to fix.
    return keys.map(key => ({
      key,
      state: 'unavailable' as PermissionState,
      detail: status.availability,
    }));
  }
  return [
    {
      key: 'healthConnectReadSteps',
      state: granted(status.stepsGranted ?? status.canRead),
    },
    { key: 'healthConnectWriteSteps', state: granted(status.canWrite) },
  ];
}

/**
 * Sends the snapshot, if it is worth sending.
 *
 * Diffed against what was last accepted, so a phone whose answers are
 * stable says nothing for twelve hours and a phone where something changed
 * says so at once. A change is also tracked as an event, which is what
 * makes "they turned notifications off on Tuesday" readable in the trail
 * rather than only in the snapshot's own history.
 *
 * Never throws: this is housekeeping, and nothing the member sees depends
 * on it.
 */
export async function reportPermissions({
  force = false,
}: { force?: boolean } = {}): Promise<void> {
  // No registered device means nothing to attribute it to; the next launch
  // or foreground tries again.
  if (!getDeviceId()) return;
  try {
    const entries = await collectPermissions();
    const signature = entries
      .map(entry => `${entry.key}:${entry.state}:${entry.detail ?? ''}`)
      .join('|');
    const cached = sentCache();
    const changed = cached?.signature !== signature;
    if (!force && !changed && Date.now() - (cached?.at ?? 0) < RECHECK_MS) {
      return;
    }
    await telemetryApi.reportPermissions(entries);
    rememberSent(signature);
    if (changed && cached) {
      for (const entry of changedKeys(cached.signature, signature)) {
        track('permission_changed', entry);
      }
    }
  } catch (error) {
    logger.debug('permissions', 'Snapshot not reported', toApiError(error));
  }
}

/**
 * What a permission screen heard, and a snapshot straight after.
 *
 * The screens are the one place that *asks*, so they are the one place that
 * can tell a refusal apart from a refusal that can no longer be asked
 * about, and the only place where a `force` is worth it: the member just
 * answered, and the answer is what support will be asked about.
 */
export async function recordPermissionAnswer(
  step: PermissionStep,
  outcome: 'granted' | 'denied' | 'skipped' | 'unavailable' | 'failed',
): Promise<void> {
  track('permission_prompt', { permission: step, outcome });
  await reportPermissions({ force: true });
}

/** Which keys moved between two signatures, and to what. */
function changedKeys(
  before: string,
  after: string,
): { permission: string; state: string; was: string }[] {
  const parse = (signature: string) =>
    new Map(
      signature.split('|').map(part => {
        const [key, state] = part.split(':');
        return [key, state ?? ''] as const;
      }),
    );
  const was = parse(before);
  return [...parse(after)]
    .filter(([key, state]) => was.has(key) && was.get(key) !== state)
    .map(([key, state]) => ({
      permission: key,
      state,
      was: was.get(key) ?? '',
    }));
}
