import { useEffect, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useAuthStatus } from '../stores/authStore';

/**
 * Asks the server again when the screen opens and whenever it comes back
 * into focus — a tab stays mounted, so "opened" means focused. Only with a
 * session: the dev bypass opens screens without one, and every request
 * would fail.
 *
 * The refreshers are the stores' own `refreshIfStale`, so flicking between
 * tabs does not fire a request each time; this hook only says when to ask.
 */
export function useRefreshOnFocus(...refreshers: (() => unknown)[]): void {
  const navigation = useNavigation();
  const isSignedIn = useAuthStatus() === 'authenticated';
  const latest = useRef(refreshers);
  latest.current = refreshers;

  useEffect(() => {
    if (!isSignedIn) {
      return undefined;
    }
    const run = () => latest.current.forEach(refresh => refresh());
    run();
    return navigation.addListener('focus', run);
  }, [isSignedIn, navigation]);
}
