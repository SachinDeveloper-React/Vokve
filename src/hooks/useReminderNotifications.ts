import { useEffect } from 'react';
import { startReminderTapHandling } from '../services/notifications';
import { startReminderScheduler } from '../services/reminderScheduler';

/**
 * Hydration reminders, for as long as the app is running (RULES Y6).
 *
 * Two jobs, both of which belong to the app rather than to any screen: the
 * plan is kept scheduled with the OS whatever the user is looking at, and a
 * tapped reminder is noted so the water log can be opened — which is the
 * thing it is reminding them to do, not the screen the plan is set on.
 *
 * Only *noted*: a tap goes into the shared slot in `services/notifications`,
 * and `usePushNotifications` is the single consumer that navigates, so a
 * reminder and a push cannot both try to steer at once.
 */
export function useReminderNotifications(): void {
  useEffect(() => {
    const stopScheduler = startReminderScheduler();
    const stopTaps = startReminderTapHandling();
    return () => {
      stopScheduler();
      stopTaps();
    };
  }, []);
}
