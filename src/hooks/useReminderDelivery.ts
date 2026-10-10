import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import {
  exactAlarmsAllowed,
  openExactAlarmSettings,
  remindersAllowed,
  requestReminderPermission,
} from '../services/notifications';
import { lastReminderStatus, resyncReminders } from '../services/reminderScheduler';
import { isQuiet } from '../services/reminderSchedule';
import { useNotificationSettingsStore } from '../stores/notificationSettingsStore';
import { useRemindersStore } from '../stores/remindersStore';

/**
 * Whether the reminders the plan describes will actually arrive.
 *
 * A plan can be perfect and still ring for nobody: the OS permission may
 * have been refused, the member may have health notifications switched off
 * (RULES Y6), or Android may be holding the app to inexact alarms. None of
 * that is visible from the plan itself, and a settings screen that says
 * "7 reminders active" over a phone that will show none of them is worse
 * than one that says nothing — so the screen asks this, and says so.
 *
 * Re-read whenever the plan or the consent changes, and whenever the app
 * comes back to the foreground: two of the three can be changed in the
 * system settings, where nothing tells the app about it.
 */
export interface ReminderDelivery {
  /** The OS will show this app's notifications. */
  allowed: boolean;
  /** Health notifications are on — the member's consent to be reminded. */
  healthOn: boolean;
  /** Alarms are set for the exact minute rather than a window near it. */
  exact: boolean;
  /** How many alarms this phone is holding for the plan. */
  scheduled: number;
  /**
   * How many of the plan's live times fall inside quiet hours and so will
   * never ring (RULES Y6).
   *
   * The window is on by default, 22:00–07:00, which is exactly when somebody
   * tries the feature out for the first time — so without this the plan says
   * "9 reminders active", the evening time the user just added sits in the
   * list looking live, and nothing arrives. Dropping it is correct; saying
   * nothing about it is not.
   */
  quietCount: number;
  /** "22:00–07:00", for the wording, or null when the window is off. */
  quietLabel: string | null;
  /** Still finding out; nothing is worth saying yet. */
  checking: boolean;
  /** The system permission dialog, then a re-schedule if it was granted. */
  allow: () => Promise<void>;
  /** Turns health notifications on, with the member's own tap. */
  enableHealth: () => void;
  /** The system page where exact alarms are granted. Android only. */
  openExactAlarms: () => Promise<void>;
}

export function useReminderDelivery(): ReminderDelivery {
  const plan = useRemindersStore(s => s.plan);
  const healthOn = useNotificationSettingsStore(s => s.categories.health);
  const quietHours = useNotificationSettingsStore(s => s.quietHours);
  const setCategory = useNotificationSettingsStore(s => s.setCategory);

  const quietCount = useMemo(
    () =>
      (plan?.reminders ?? []).filter(
        reminder => reminder.enabled && isQuiet(reminder.time, quietHours),
      ).length,
    [plan, quietHours],
  );

  const [state, setState] = useState({
    allowed: true,
    exact: true,
    scheduled: 0,
    checking: true,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    // The schedule first, then what the OS says about it. Opening this
    // screen is a moment the plan should already be on the device, and
    // asking for it here means the count below is this plan's rather than
    // whatever the last sync happened to leave behind. A sync with nothing
    // to do returns the previous answer without touching the OS.
    resyncReminders()
      .then(() => Promise.all([remindersAllowed(), exactAlarmsAllowed()]))
      .then(([allowed, exact]) => {
        if (!current) return;
        setState({
          allowed,
          exact,
          scheduled: lastReminderStatus()?.scheduled ?? 0,
          checking: false,
        });
      })
      .catch(() => {
        if (current) setState(previous => ({ ...previous, checking: false }));
      });
    return () => {
      current = false;
    };
  }, [plan, healthOn, attempt]);

  // The permission can be withdrawn while the app is away.
  useEffect(() => {
    const listener = AppState.addEventListener('change', next => {
      if (next === 'active') setAttempt(n => n + 1);
    });
    return () => listener.remove();
  }, []);

  const allow = useCallback(async () => {
    const granted = await requestReminderPermission();
    if (granted) await resyncReminders({ force: true });
    setAttempt(n => n + 1);
  }, []);

  const enableHealth = useCallback(() => {
    setCategory('health', true);
  }, [setCategory]);

  const openExactAlarms = useCallback(async () => {
    await openExactAlarmSettings();
    // Nothing comes back from the system page; the foreground listener
    // above picks the answer up when the user returns.
  }, []);

  return {
    ...state,
    healthOn,
    quietCount,
    quietLabel: quietHours.enabled ? `${quietHours.start}–${quietHours.end}` : null,
    allow,
    enableHealth,
    openExactAlarms,
  };
}
