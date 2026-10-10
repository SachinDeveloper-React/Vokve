import { AppState } from 'react-native';
import { useNotificationSettingsStore } from '../stores/notificationSettingsStore';
import { useRemindersStore } from '../stores/remindersStore';
import { useSettingsStore } from '../stores/settingsStore';
import { logger } from '../utils/logger';
import { syncHydrationReminders, type ReminderScheduleStatus } from './notifications';

/**
 * Keeping what the OS holds in step with what the plan says (RULES Y6).
 *
 * The plan is the server's and the alarms are the phone's, so something has
 * to carry a change from one to the other. This is that something, and it
 * lives outside the stores on purpose: a store that scheduled notifications
 * as a side effect of a `set` could not be reasoned about, and every test
 * that touched a reminder would need the native module.
 *
 * Four things change the schedule, and all four are watched:
 *
 *  - the plan itself — a time added, a chip switched off, a new sound;
 *  - quiet hours, which decide which times are scheduled at all;
 *  - the daily water goal, which the reminder's wording quotes;
 *  - the health notification switch, which is the user's consent to be
 *    reminded about their body at all (RULES Y6).
 *
 * And one thing changes outside the app: the notification permission, or
 * the exact-alarm one, revoked in the system settings. Nothing tells the
 * app when that happens, so coming back to the foreground re-syncs
 * unconditionally.
 */

/** Coalesces the burst of store writes one edit makes into a single sync. */
const DEBOUNCE_MS = 400;

let timer: ReturnType<typeof setTimeout> | null = null;
/** What was last scheduled from, so an unrelated store write does no work. */
let lastFingerprint: string | null = null;
let lastStatus: ReminderScheduleStatus | null = null;

/** Everything that decides what gets scheduled, as one comparable string. */
function fingerprint(): string {
  const plan = useRemindersStore.getState().plan;
  const { quietHours, categories } = useNotificationSettingsStore.getState();
  const goalMl = useSettingsStore.getState().dailyWaterGoalMl;
  return JSON.stringify([plan, quietHours, categories.health, goalMl]);
}

/**
 * The last sync's result, for a screen that wants to say whether the OS is
 * actually going to ring — null before the first one.
 */
export function lastReminderStatus(): ReminderScheduleStatus | null {
  return lastStatus;
}

/**
 * Schedules the plan as it stands now.
 *
 * `force` re-syncs even when nothing in the app has changed, which is what
 * a return to the foreground needs: the thing that changed was outside it.
 */
export async function resyncReminders({ force = false } = {}): Promise<ReminderScheduleStatus | null> {
  const next = fingerprint();
  if (!force && next === lastFingerprint) return lastStatus;
  lastFingerprint = next;

  const plan = useRemindersStore.getState().plan;
  const { quietHours, categories } = useNotificationSettingsStore.getState();
  const goalMl = useSettingsStore.getState().dailyWaterGoalMl;

  try {
    lastStatus = await syncHydrationReminders(
      // Health notifications off is the user saying they do not want to be
      // told about their body (RULES Y6). The plan is theirs and is kept;
      // it is simply not scheduled until they say yes — which the reminder
      // screen offers them in one tap rather than leaving a mystery.
      categories.health ? plan : null,
      { quietHours, goalMl },
    );
    return lastStatus;
  } catch (error) {
    // A native module missing on this build, or an OS that refused the
    // whole batch. The plan is safe either way; the server pushes.
    logger.warn('reminderScheduler', 'Could not schedule the reminders', error);
    lastFingerprint = null;
    return null;
  }
}

function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    // Handles its own failures; there is nothing here to await it.
    resyncReminders();
  }, DEBOUNCE_MS);
}

/**
 * Starts watching, and returns what stops it. Called once, where the app
 * starts; calling it twice would double every sync.
 */
export function startReminderScheduler(): () => void {
  const unsubscribers = [
    useRemindersStore.subscribe(schedule),
    useNotificationSettingsStore.subscribe(schedule),
    useSettingsStore.subscribe(schedule),
  ];

  const appState = AppState.addEventListener('change', state => {
    if (state !== 'active') return;
    // Unconditional: the permission may have been taken away in the system
    // settings while the app was away, and nothing here would know.
    resyncReminders({ force: true });
  });

  // The stores may already hold a plan, restored from disk before this ran.
  schedule();

  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    appState.remove();
    unsubscribers.forEach(stop => stop());
  };
}

/** Forgets what was last scheduled, so the next sync does the work again. */
export function resetReminderScheduler(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  lastFingerprint = null;
  lastStatus = null;
}
