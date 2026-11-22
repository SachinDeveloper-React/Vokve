import { useEffect } from 'react';
import { AppState } from 'react-native';
import {
  appleCredentialState,
  onAppleCredentialRevoked,
} from '../services/appleCredential';
import { useAuthStore } from '../stores/authStore';
import { logger } from '../utils/logger';

const REVOKED_NOTICE =
  'You stopped using Sign in with Apple for VOKVE, so you have been signed out. Sign in again to continue.';

/**
 * Ends a session that Apple was the way into, once the member withdraws
 * VOKVE from their Apple ID (RULES O16) — checked at launch, each time the
 * app comes back to the foreground, and on Apple's own revocation event
 * while it runs.
 *
 * Only `revoked` signs anybody out. Apple's sample treats "not found" the
 * same way, but a false "not found" — a simulator, a restored phone —
 * would throw a member out of an account they are using, so it is logged
 * and left alone; the server's sessions are still the authority.
 */
export function useAppleCredentialWatch(): void {
  const status = useAuthStore(s => s.status);

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    let ended = false;
    const end = () => {
      if (ended || useAuthStore.getState().status !== 'authenticated') {
        return;
      }
      ended = true;
      logger.info('appleCredential', 'Apple credential revoked; signing out');
      useAuthStore.getState().signOut(REVOKED_NOTICE).catch(error => {
        logger.warn('appleCredential', 'Sign-out after Apple revocation did not finish', error);
      });
    };
    const check = async () => {
      const state = await appleCredentialState();
      if (state === 'revoked') {
        end();
      } else if (state === 'not_found') {
        logger.warn('appleCredential', 'Apple reports no credential for this session’s Apple id');
      }
    };

    check();
    const foreground = AppState.addEventListener('change', next => {
      if (next === 'active') {
        check();
      }
    });
    const stopListening = onAppleCredentialRevoked(end);
    return () => {
      foreground.remove();
      stopListening();
    };
  }, [status]);
}
