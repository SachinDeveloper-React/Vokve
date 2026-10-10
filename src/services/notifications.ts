import { Platform } from 'react-native';
import notifee, {
  AlarmType,
  AndroidImportance,
  AndroidNotificationSetting,
  AuthorizationStatus,
  EventType,
  RepeatFrequency,
  TriggerType,
  type Notification,
} from '@notifee/react-native';
import {
  DEFAULT_SOUND_ID,
  soundAssetFor,
  type SoundAsset,
} from '../constants/reminderSounds';
import type { HydrationReminderPlan } from '../types/models';
import { logger } from '../utils/logger';
import { deviceApi } from './api/endpoints';
import { toApiError } from './api/errors';
import { getDeviceId } from './device';
import {
  ALARM_ID_PREFIX,
  planReminderAlarms,
  type QuietHours,
  type ReminderAlarm,
} from './reminderSchedule';

/**
 * Hydration reminders, as the phone itself rings them (RULES Y6).
 *
 * ## Why the phone and not the server
 *
 * A reminder is a promise about a minute. A local alarm keeps it: it fires
 * at 07:15 whether or not there is a network, carries the sound the user
 * picked, and costs nothing to deliver. A push cannot promise any of the
 * three — FCM batches in Doze, a plane turns it off, and the sound belongs
 * to a channel the server does not own. So this is the channel, and the
 * server's push is the fallback for an account with no phone scheduling for
 * it; `claimLocalScheduling` is what tells the server which it is, and
 * getting that wrong in either direction means a reminder twice or not at
 * all.
 *
 * ## Android channels
 *
 * A channel's sound and vibration are fixed the moment it is created —
 * Android will not let an app change them afterwards, by design, because
 * they are the user's to change from then on. So the sound and the
 * vibration are *in the channel's id*: picking a new sound means a new
 * channel, and the stale ones are deleted on the way past. The cost is that
 * a user who tuned the channel in Android's own settings loses that tuning
 * when they change sound in the app, which is the right way round — they
 * just said what they wanted in the app.
 *
 * On iOS the sound is on each notification instead, and vibration is not
 * ours to set at all: iOS vibrates for a notification that makes a sound
 * and does not for one that does not. The switch still decides Android.
 */

/** Everything this app creates is named from here, channels included. */
const CHANNEL_PREFIX = 'vokve.hydration.';

/**
 * A short double buzz: enough to feel in a pocket, not a phone alarm.
 *
 * Read as alternating wait-then-vibrate pairs. Android's own convention
 * starts the pattern with 0 for "no initial delay", but notifee rejects a
 * pattern containing any value that is not strictly positive, so the lead-in
 * is 1 ms instead — imperceptible, and it validates. Every value must be
 * above zero and the count must be even; `reminderNotifications.test` holds
 * that rule, because getting it wrong throws inside `createChannel` and used
 * to take every reminder down with it.
 */
export const VIBRATION_PATTERN = [1, 250, 200, 250];

/**
 * The channel used when the one the plan asks for cannot be created.
 *
 * Android requires a channel id on every notification, so there is no
 * "schedule it without one" — and a reminder with the phone's default sound
 * is worth immeasurably more than no reminder at all. This is what an OEM
 * that refuses one of our channel settings falls back to.
 */
const FALLBACK_CHANNEL_ID = `${CHANNEL_PREFIX}fallback`;

/**
 * The preview in the sound picker, cleared again a moment later.
 *
 * Deliberately outside `ALARM_ID_PREFIX`: a sample is not a reminder, and an
 * id under that prefix would be swept up by `cancelHydrationReminders` and
 * read as a real reminder by the tap handler.
 */
const PREVIEW_ID = 'vokve.sound-preview';
const PREVIEW_LINGER_MS = 5_000;

export interface ReminderScheduleStatus {
  /** How many alarms the OS now holds for the plan. */
  scheduled: number;
  /** False when the OS will not show this app's notifications at all. */
  allowed: boolean;
  /**
   * Whether the alarms are exact. Android 12 and up gate exact alarms
   * behind a permission of their own; without it they still fire, within
   * the few minutes the system chooses, which is worth saying out loud on
   * the screen rather than leaving as a mystery.
   */
  exact: boolean;
}

/**
 * The channel for one sound-and-vibration pair.
 *
 * The id has to be derived rather than stored: it is how a re-sync finds the
 * channel it made last time instead of making a second one.
 */
export function reminderChannelId(soundId: string, vibration: boolean): string {
  return `${CHANNEL_PREFIX}${soundId}.${vibration ? 'buzz' : 'quiet'}`;
}

/** What a sound id means for an Android channel. */
function androidChannelSound(asset: SoundAsset): string | undefined {
  if (asset.kind === 'silent') return undefined;
  if (asset.kind === 'system') return 'default';
  return asset.name;
}

/** What it means for an iOS notification. */
function iosSound(asset: SoundAsset): string | undefined {
  if (asset.kind === 'silent') return undefined;
  if (asset.kind === 'system') return 'default';
  return asset.name;
}

/**
 * Creates the channel this plan needs and clears the ones it has outgrown.
 *
 * A no-op off Android, where there are no channels; the caller does not
 * branch on the platform for it.
 */
async function ensureReminderChannel(
  soundId: string,
  vibration: boolean,
): Promise<string | undefined> {
  if (Platform.OS !== 'android') return undefined;

  const id = reminderChannelId(soundId, vibration);
  const asset = soundAssetFor(soundId);
  let created = id;

  try {
    await notifee.createChannel({
      id,
      name: 'Hydration reminders',
      description: 'The times you asked to be reminded to drink water.',
      // HIGH rather than DEFAULT: a reminder the user set for a minute has to
      // arrive at that minute and be noticed, which is what heads-up means.
      importance: AndroidImportance.HIGH,
      sound: androidChannelSound(asset),
      vibration,
      vibrationPattern: vibration ? VIBRATION_PATTERN : undefined,
    });
  } catch (error) {
    // One setting this phone would not take must not cost the user every
    // reminder: the sound and the buzz are how a reminder arrives, not
    // whether it does. So the plain channel instead, and the reminders go on.
    logger.warn(
      'notifications',
      `The ${soundId} channel was refused; falling back to the default sound`,
      error,
    );
    await notifee.createChannel({
      id: FALLBACK_CHANNEL_ID,
      name: 'Hydration reminders',
      description: 'The times you asked to be reminded to drink water.',
      importance: AndroidImportance.HIGH,
    });
    created = FALLBACK_CHANNEL_ID;
  }

  // The ones from previous sounds. Left alone they pile up in Android's own
  // notification settings, where the user would see a list of every sound
  // they have ever tried.
  try {
    const channels = await notifee.getChannels();
    await Promise.all(
      channels
        .filter(
          channel =>
            channel.id.startsWith(CHANNEL_PREFIX) && channel.id !== created,
        )
        .map(channel => notifee.deleteChannel(channel.id)),
    );
  } catch (error) {
    // Tidying is not worth failing a sync over.
    logger.warn('notifications', 'Could not clear old channels', error);
  }

  return created;
}

/** Whether the OS will show this app's notifications. Asks nobody. */
export async function remindersAllowed(): Promise<boolean> {
  try {
    const settings = await notifee.getNotificationSettings();
    return (
      settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
      settings.authorizationStatus === AuthorizationStatus.PROVISIONAL
    );
  } catch (error) {
    logger.warn('notifications', 'Could not read the notification settings', error);
    return false;
  }
}

/**
 * Whether this phone will let the app set alarms for an exact minute.
 *
 * True everywhere but Android 12 and up without `SCHEDULE_EXACT_ALARM`.
 * Inexact alarms still arrive — the system batches them with others within
 * a window of its choosing — so this governs what the screen says, never
 * whether anything is scheduled.
 */
export async function exactAlarmsAllowed(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const settings = await notifee.getNotificationSettings();
    return settings.android.alarm === AndroidNotificationSetting.ENABLED;
  } catch {
    return false;
  }
}

/** Opens the system page where exact alarms are granted. Android only. */
export async function openExactAlarmSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.openAlarmPermissionSettings();
}

/**
 * Asks for permission to notify, with the system dialog.
 *
 * Only called from where the user has already been told what the
 * notifications are for — the reminder screen's own switch, or the
 * permission flow after sign-up.
 */
export async function requestReminderPermission(): Promise<boolean> {
  try {
    const settings = await notifee.requestPermission();
    return (
      settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
      settings.authorizationStatus === AuthorizationStatus.PROVISIONAL
    );
  } catch (error) {
    logger.warn('notifications', 'The notification permission was not granted', error);
    return false;
  }
}

/**
 * Tells the server whether this install is ringing the plan itself, so it
 * knows whether to push as well (RULES Y6).
 *
 * Best-effort and deliberately quiet: a failure here means the server keeps
 * whatever it last heard, which is either a push the user did not need or a
 * missing one for a minute — not something to interrupt them about. The
 * next sync says it again.
 */
async function claimLocalScheduling(scheduled: boolean): Promise<void> {
  const deviceId = getDeviceId();
  if (!deviceId) return;
  try {
    await deviceApi.setLocalReminders(deviceId, scheduled);
  } catch (error) {
    logger.warn('notifications', 'Could not tell the server who is reminding', toApiError(error));
  }
}

/** Clears every alarm this app scheduled, leaving anything else alone. */
export async function cancelHydrationReminders(): Promise<void> {
  try {
    const ids = await notifee.getTriggerNotificationIds();
    const ours = ids.filter(id => id.startsWith(ALARM_ID_PREFIX));
    if (ours.length > 0) await notifee.cancelTriggerNotifications(ours);
  } catch (error) {
    logger.warn('notifications', 'Could not clear the scheduled reminders', error);
  }
}

/**
 * What a reminder says. The goal is the one in force when it was scheduled,
 * written in litres to one place — the same way every card in the app writes
 * it, so a reminder does not read as a different number from the screen it
 * came from.
 */
function bodyFor(goalMl: number | null): string {
  if (goalMl === null) return 'Tap to log a glass.';
  return `A glass now keeps you on track for your ${(goalMl / 1000).toFixed(1)} L goal.`;
}

function notificationFor(
  alarm: ReminderAlarm,
  channelId: string | undefined,
  soundId: string,
  goalMl: number | null,
): Notification {
  return {
    id: alarm.id,
    title: 'Time for water 💧',
    body: bodyFor(goalMl),
    // Read by the tap handler, and by the push handler for a server-sent
    // one, so both land on the same screen.
    data: { topic: 'hydration', kind: 'reminder', time: alarm.time },
    android: {
      channelId,
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default', launchActivity: 'default' },
      showTimestamp: true,
      // Cleared from the shade when the next one is due at the latest: a
      // reminder for a time that has gone is not worth a badge.
      autoCancel: true,
    },
    ios: {
      sound: iosSound(soundAssetFor(soundId)),
      // Vibration on iOS follows the sound; there is nothing to set.
    },
  };
}

export interface SyncOptions {
  quietHours?: QuietHours | null;
  /** The daily water goal, for the wording. Null leaves it out. */
  goalMl?: number | null;
  now?: Date;
}

/**
 * Puts the plan on the device: cancels what was scheduled, schedules what
 * the plan now comes to, and tells the server which of the two of them is
 * reminding the user.
 *
 * Safe to call as often as anything changes — the whole point of the stable
 * alarm ids is that re-scheduling is a replace, not an addition.
 */
export async function syncHydrationReminders(
  plan: HydrationReminderPlan | null,
  { quietHours = null, goalMl = null, now = new Date() }: SyncOptions = {},
): Promise<ReminderScheduleStatus> {
  const alarms = planReminderAlarms(plan, { now, quietHours });

  await cancelHydrationReminders();

  if (alarms.length === 0) {
    // Nothing to ring, so the server should be the one reminding — if the
    // plan is off entirely there is nothing for it to send either, and
    // saying so costs one field on a heartbeat.
    await claimLocalScheduling(false);
    return { scheduled: 0, allowed: await remindersAllowed(), exact: false };
  }

  const allowed = await remindersAllowed();
  if (!allowed) {
    // The user refused notifications, so nothing this app schedules will
    // ever be shown. The server has to be the one that pushes — and it may
    // yet get through, because a push the OS blocks still leaves a feed row.
    await claimLocalScheduling(false);
    return { scheduled: 0, allowed: false, exact: false };
  }

  const soundId = plan?.sound ?? DEFAULT_SOUND_ID;
  const channelId = await ensureReminderChannel(soundId, plan?.vibration ?? true);
  const exact = await exactAlarmsAllowed();

  let scheduled = 0;
  for (const alarm of alarms) {
    try {
      await notifee.createTriggerNotification(
        notificationFor(alarm, channelId, soundId, goalMl),
        {
          type: TriggerType.TIMESTAMP,
          timestamp: alarm.timestamp,
          repeatFrequency:
            alarm.repeat === 'daily' ? RepeatFrequency.DAILY : RepeatFrequency.WEEKLY,
          // AlarmManager rather than WorkManager: a reminder set for 07:15
          // has to arrive at 07:15, and WorkManager will not wake a dozing
          // phone to do it. Exact where the phone allows it, and allowed
          // while idle either way.
          alarmManager: {
            type: exact
              ? AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE
              : AlarmType.SET_AND_ALLOW_WHILE_IDLE,
          },
        },
      );
      scheduled += 1;
    } catch (error) {
      // One alarm the OS refused — a budget hit, a trigger in the past
      // after a slow sync — is not a reason to abandon the rest.
      logger.warn('notifications', `Could not schedule ${alarm.id}`, error);
    }
  }

  await claimLocalScheduling(scheduled > 0);
  logger.info('notifications', `Scheduled ${scheduled} hydration reminders`);
  return { scheduled, allowed: true, exact };
}

/**
 * Why a sound could not be played, or `played` when it was.
 *
 * A result rather than nothing, because the one thing a preview must never
 * do is appear to work. Pressing play and hearing silence is unreadable —
 * it could be the sound, the phone's volume, the permission, or a bug — so
 * the screen is told which it was and can say so.
 */
export type PreviewResult = 'played' | 'not_permitted' | 'failed';

/**
 * Rings a sound once so the user can hear it before choosing it.
 *
 * Shown as a real notification rather than played through an audio player,
 * because that is the only way to hear what it will actually sound like:
 * the channel's volume, the phone's do-not-disturb, and the vibration all
 * apply to a notification and none of them apply to a media stream. It is
 * cleared again a few seconds later so the shade is not left with a row
 * that was only ever a sample.
 */
export async function previewReminderSound(
  soundId: string,
  vibration: boolean,
): Promise<PreviewResult> {
  // Asked for rather than simply refused: a user pressing play has said
  // plainly that they want to hear a notification, which is the best moment
  // there will ever be to ask for permission to make one.
  if (!(await remindersAllowed()) && !(await requestReminderPermission())) {
    return 'not_permitted';
  }
  try {
    return await displayPreview(soundId, vibration);
  } catch (error) {
    // A channel the OS refused, a sound resource missing from this build:
    // either way the user heard nothing and has to be told why.
    logger.warn('notifications', 'The sound preview failed', error);
    return 'failed';
  }
}

async function displayPreview(
  soundId: string,
  vibration: boolean,
): Promise<PreviewResult> {
  const channelId = await ensureReminderChannel(soundId, vibration);
  await notifee.displayNotification({
    id: PREVIEW_ID,
    title: 'Time for water 💧',
    body: 'This is how your reminder will sound.',
    android: {
      channelId,
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default', launchActivity: 'default' },
      timeoutAfter: PREVIEW_LINGER_MS,
      autoCancel: true,
    },
    ios: { sound: iosSound(soundAssetFor(soundId)) },
  });
  // Android clears it itself through `timeoutAfter`; iOS has no equivalent.
  setTimeout(() => {
    notifee.cancelNotification(PREVIEW_ID).catch(() => {});
  }, PREVIEW_LINGER_MS);
  return 'played';
}

/** Whether a notification is one of ours — a reminder, local or pushed. */
function isHydrationReminder(notification: Notification | undefined): boolean {
  if (!notification) return false;
  if (notification.data?.topic === 'hydration') return true;
  return typeof notification.id === 'string' && notification.id.startsWith(ALARM_ID_PREFIX);
}

/**
 * Where a tapped reminder goes, held until the navigator is ready to take
 * it.
 *
 * A notification tapped from a cold start arrives before any screen exists,
 * so it cannot be navigated to when it is read. One slot rather than a
 * queue: the user tapped one notification, and the second of two taps is
 * the one they meant.
 */
let pendingTap: 'hydration' | null = null;
const tapListeners = new Set<() => void>();

function recordTap(): void {
  pendingTap = 'hydration';
  tapListeners.forEach(listener => listener());
}

/**
 * The route a tapped notification asked for, if any — and taking it clears
 * it, so a remount does not navigate again.
 */
export function takePendingNotificationRoute(): 'hydration' | null {
  const route = pendingTap;
  pendingTap = null;
  return route;
}

/**
 * Says when one has arrived.
 *
 * The navigator cannot ask: a cold-start tap is read asynchronously and may
 * land either side of the moment navigation becomes ready, so whoever
 * navigates has to be told rather than poll.
 */
export function onPendingNotificationRoute(listener: () => void): () => void {
  tapListeners.add(listener);
  return () => {
    tapListeners.delete(listener);
  };
}

/**
 * The tap handler for a notification pressed while the app is in the
 * background.
 *
 * Registered at the top of the bundle, not from a component: by the time a
 * component could run, the event has been and gone. Notifee requires the
 * handler to return a promise and will wait on it, so it does as little as
 * possible — the route is picked up by the navigator when the app comes
 * forward.
 */
export async function handleReminderBackgroundEvent({
  type,
  detail,
}: {
  type: EventType;
  detail: { notification?: Notification };
}): Promise<void> {
  if (type !== EventType.PRESS) return;
  if (isHydrationReminder(detail.notification)) recordTap();
}

/**
 * Starts listening for taps while the app is running. The cold-start tap is
 * read once here too, since `getInitialNotification` only answers for the
 * notification the app was opened by.
 */
export function startReminderTapHandling(): () => void {
  notifee
    .getInitialNotification()
    .then(initial => {
      if (initial && isHydrationReminder(initial.notification)) recordTap();
    })
    .catch(error => logger.warn('notifications', 'Could not read the opening notification', error));

  return notifee.onForegroundEvent(({ type, detail }) => {
    if (type !== EventType.PRESS) return;
    if (isHydrationReminder(detail.notification)) recordTap();
  });
}
