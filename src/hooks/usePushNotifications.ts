import { useEffect } from 'react';
import type { NavigationContainerRef } from '@react-navigation/native';
import {
  onPendingNotificationRoute,
  takePendingNotificationRoute,
} from '../services/notifications';
import { startPushHandling } from '../services/push';
import type { RootStackParamList } from '../types/navigation';

/**
 * Pushes, for as long as the app is running — and **where any tapped
 * notification goes**, reminders included (RULES A28, P13).
 *
 * The two halves belong together. `startPushHandling` draws a push the OS
 * would not have shown, re-reads the feed so the bell catches up, and
 * records where a tap wants to go; this hook is the one place that takes
 * that route and navigates. One consumer on purpose: the slot holds a
 * single tap, so two consumers would mean one tap navigating twice — or,
 * worse, one of them clearing it and nothing happening at all. The
 * hydration reminders record into the same slot
 * (`startReminderTapHandling`) and are taken from here too.
 *
 * Mounted from the root navigator, once, because a notification tapped from
 * a cold start is read before any screen exists: the route waits until
 * navigation is ready and is then taken.
 */
export function usePushNotifications(
  navigationRef: NavigationContainerRef<RootStackParamList>,
  ready: boolean,
): void {
  useEffect(() => startPushHandling(), []);

  useEffect(() => {
    const open = () => {
      if (!ready) return;
      const route = takePendingNotificationRoute();
      if (!route) return;
      if (route.kind === 'tab') {
        navigationRef.navigate('Main', { screen: route.name });
        return;
      }
      // `navigate` is typed one screen at a time, so a union of names needs
      // a cast. It is sound here because every screen in `NotificationRoute`
      // takes no params — which is the only thing the cast hides.
      navigationRef.navigate(route.name as 'Notifications');
    };
    // Once now, for a tap that landed before navigation was ready, and then
    // whenever one arrives.
    open();
    return onPendingNotificationRoute(open);
  }, [navigationRef, ready]);
}
