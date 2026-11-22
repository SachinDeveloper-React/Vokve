import { Platform } from 'react-native';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import { getMMKV } from '../stores';
import { logger } from '../utils/logger';

/**
 * Whether the member still lets VOKVE use their Apple ID (RULES O16).
 *
 * Somebody can stop using Sign in with Apple for an app from iOS Settings
 * (Apple ID → Sign in with Apple) without opening the app at all. Apple
 * asks apps to notice: check the credential at launch, listen for the
 * revocation while running, and sign the member out of a session that
 * Apple was the way into.
 *
 * Only a session that *started* with Apple on this phone is checked —
 * the id is remembered at that sign-in and forgotten at the next one by
 * any other method. Somebody who signs in with a password and happens to
 * have Apple connected is not signed out because they tidied their Apple
 * settings. iOS only: Android's web flow has no credential to ask about.
 */

const KEY = 'vokve.apple.user';
const storage = () => getMMKV();

export type AppleCredential = 'authorized' | 'revoked' | 'not_found' | 'transferred' | 'unknown';

/** Remembers the Apple id this session signed in with, or forgets it on null. */
export function rememberAppleUser(appleUser: string | null): void {
  try {
    if (appleUser) storage().set(KEY, appleUser);
    else storage().remove(KEY);
  } catch (error) {
    logger.warn('appleCredential', 'Could not store the Apple user id', error);
  }
}

export function forgetAppleUser(): void {
  rememberAppleUser(null);
}

export function rememberedAppleUser(): string | null {
  try {
    return storage().getString(KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Apple's answer for the remembered id, or null when there is nothing to
 * ask (not iOS, or the session did not start with Apple). Never throws: a
 * simulator with no Apple ID, or Apple not answering, is `unknown` — and
 * an unknown never signs anybody out.
 */
export async function appleCredentialState(): Promise<AppleCredential | null> {
  if (Platform.OS !== 'ios') return null;
  const appleUser = rememberedAppleUser();
  if (!appleUser) return null;
  try {
    const state = await appleAuth.getCredentialStateForUser(appleUser);
    switch (state) {
      case appleAuth.State.AUTHORIZED:
        return 'authorized';
      case appleAuth.State.REVOKED:
        return 'revoked';
      case appleAuth.State.NOT_FOUND:
        return 'not_found';
      case appleAuth.State.TRANSFERRED:
        return 'transferred';
      default:
        return 'unknown';
    }
  } catch (error) {
    logger.warn('appleCredential', 'Apple credential state could not be read', error);
    return 'unknown';
  }
}

/** Apple's revocation event, while the app is running. Returns the unsubscribe. */
export function onAppleCredentialRevoked(listener: () => void): () => void {
  if (Platform.OS !== 'ios') return () => {};
  try {
    const off = appleAuth.onCredentialRevoked(listener);
    return () => {
      off?.();
    };
  } catch (error) {
    logger.warn('appleCredential', 'Could not listen for Apple revocations', error);
    return () => {};
  }
}
