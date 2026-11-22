import { useEffect } from 'react';
import { AppState } from 'react-native';
import { syncAppIcon } from '../services/appIcon';

/** Checked at most this often, so flicking between apps is not a poll loop. */
const MIN_CHECK_INTERVAL_MS = 60_000;

/**
 * Keeps the launcher icon on what the server says (RULES DV13), asking on
 * launch and on every return to the foreground — the only moments it can
 * change anyway: iOS refuses while the app is not in front, and nothing
 * wakes the app for it. Not gated on a session: the icon is the same signed
 * in or out.
 */
export function useAppIconSync(): void {
  useEffect(() => {
    let last = 0;
    const check = () => {
      if (Date.now() - last < MIN_CHECK_INTERVAL_MS) return;
      last = Date.now();
      syncAppIcon().catch(() => {});
    };

    check();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, []);
}
