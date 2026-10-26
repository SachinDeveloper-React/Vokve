import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import { useNetworkStatus } from './useNetworkStatus';

/**
 * The least time between two attempts. A phone switching from wifi to mobile
 * data reports the change more than once, and the app foregrounding right
 * after a reconnect is a third event about the same thing — one `GET /me` is
 * the answer to all of them.
 */
const MIN_INTERVAL_MS = 15_000;

/**
 * Confirms a session that was restored from the stored snapshot (see
 * `isSessionUnconfirmed`), as soon as the phone has any chance of reaching
 * the server.
 *
 * The restore is what lets a member off the network open the app on their own
 * figures; this is the other half of it, and the reason that is safe. The
 * server is asked again when the connection comes back and on every
 * foreground until it answers — and its answer decides: the session is
 * confirmed and the figures refresh, or it was revoked while the phone was
 * away and `hydrate` ends it there and then. Nothing is shown differently in
 * the meantime: the app is already on screen, and `hydrate` keeps it there
 * (`isSubmitting`, not the splash).
 */
export function useSessionRecovery(): void {
  const isUnconfirmed = useAuthStore(s => s.isSessionUnconfirmed);
  const { isOffline } = useNetworkStatus();
  const askedAt = useRef(0);

  const confirm = useCallback(() => {
    const { isSessionUnconfirmed, isSubmitting, hydrate } =
      useAuthStore.getState();
    if (!isSessionUnconfirmed || isSubmitting) {
      return;
    }
    const now = Date.now();
    if (now - askedAt.current < MIN_INTERVAL_MS) {
      return;
    }
    askedAt.current = now;
    hydrate();
  }, []);

  // The network coming back — and the restore itself, when the server was
  // down rather than the connection: there is nothing to wait for then.
  useEffect(() => {
    if (isUnconfirmed && !isOffline) {
      confirm();
    }
  }, [confirm, isOffline, isUnconfirmed]);

  // And a foreground, for everything NetInfo does not say: a captive portal
  // the member has since signed into, a server that was being deployed, a
  // phone that spent the night in a basement.
  useEffect(() => {
    if (!isUnconfirmed) {
      return;
    }
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        confirm();
      }
    });
    return () => subscription.remove();
  }, [confirm, isUnconfirmed]);
}
