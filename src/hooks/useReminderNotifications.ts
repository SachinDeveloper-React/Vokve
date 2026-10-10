import { useEffect } from 'react';
import type { NavigationContainerRef } from '@react-navigation/native';
import {
  onPendingNotificationRoute,
  startReminderTapHandling,
  takePendingNotificationRoute,
} from '../services/notifications';
import { startReminderScheduler } from '../services/reminderScheduler';
import type { RootStackParamList } from '../types/navigation';

/**
 * Hydration reminders, for as long as the app is running (RULES Y6).
 *
 * Two jobs, both of which belong to the app rather than to any screen: the
 * plan is kept scheduled with the OS whatever the user is looking at, and a
 * tapped reminder opens the hydration screen — which is the thing it is
 * reminding them to do, not the screen the plan is set on.
 *
 * Mounted from the root navigator, once, because the tap has to be able to
 * navigate: a reminder tapped from a cold start is read before any screen
 * exists, so the route waits until navigation is ready and is then taken.
 */
export function useReminderNotifications(
  navigationRef: NavigationContainerRef<RootStackParamList>,
  ready: boolean,
): void {
  useEffect(() => {
    const stopScheduler = startReminderScheduler();
    const stopTaps = startReminderTapHandling();
    return () => {
      stopScheduler();
      stopTaps();
    };
  }, []);

  useEffect(() => {
    const open = () => {
      if (!ready) return;
      if (takePendingNotificationRoute() === 'hydration') {
        navigationRef.navigate('Hydration');
      }
    };
    // Once now, for a tap that landed before navigation was ready, and then
    // whenever one arrives.
    open();
    return onPendingNotificationRoute(open);
  }, [navigationRef, ready]);
}
