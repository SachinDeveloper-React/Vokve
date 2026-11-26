import { Platform } from 'react-native';
import { AccessToken, AuthenticationToken, LoginManager } from 'react-native-fbsdk-next';
import { logger } from '../utils/logger';

/**
 * Logging in with Facebook, as far as the phone is concerned (RULES O18).
 *
 * The phone's whole job is to come back with a **proof** from Facebook. It
 * does not decide who the member is: the server checks the proof and reads
 * the id, name and email from Facebook's answer. Anything this file
 * returned about the user beyond the proof would be a fact nobody had
 * checked.
 *
 * The two platforms prove it differently:
 *  - **Android**: the classic access token, which the server checks by
 *    asking Facebook (`debug_token`, then `/me`).
 *  - **iPhone**: **Limited Login**. No App Tracking Transparency prompt
 *    ("Allow VOKVE to track you?") — VOKVE does not track — and Facebook
 *    answers with a signed OIDC token instead, checked on the server
 *    against Facebook's public keys, with the nonce the SDK made for this
 *    login. Its id is the same one Android's token names, so one person is
 *    one account on both phones.
 *
 * The phone keeps no Facebook session. The proof is read once and the SDK
 * forgets it straight away, so the next press — a second member on a
 * shared phone, or a confirmation before deleting the account — always
 * goes through Facebook again rather than quietly reusing the last one.
 */

/** What the server takes — the same shape as `FacebookProof` there. */
export type FacebookProof =
  | { accessToken: string }
  | { authenticationToken: string; nonce: string };

export type FacebookOutcome =
  | { kind: 'signed_in'; proof: FacebookProof }
  /** The member backed out. Nothing to say, nothing to log. */
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

const PERMISSIONS = ['public_profile', 'email'];

export function isFacebookSignInAvailable(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

export async function signInWithFacebook(): Promise<FacebookOutcome> {
  if (!isFacebookSignInAvailable()) {
    return { kind: 'failed', message: 'Facebook sign-in is not available on this device.' };
  }
  try {
    // A login left from earlier (another member, an old confirmation)
    // must not stand in for this one.
    LoginManager.logOut();
    // `limited` is read on iOS only; no nonce is passed, so the SDK makes
    // one natively for this login and hands it back with the token.
    const result = await LoginManager.logInWithPermissions(PERMISSIONS, 'limited');
    if (result.isCancelled) {
      return { kind: 'cancelled' };
    }
    const proof = await readProof();
    LoginManager.logOut();
    if (!proof) {
      return { kind: 'failed', message: 'Facebook did not complete the sign-in. Please try again.' };
    }
    return { kind: 'signed_in', proof };
  } catch (error) {
    return { kind: 'failed', message: explain(error) };
  }
}

/** The proof the login just produced, read before the SDK is told to forget it. */
async function readProof(): Promise<FacebookProof | null> {
  if (Platform.OS === 'ios') {
    const token = await AuthenticationToken.getAuthenticationTokenIOS();
    return token?.authenticationToken && token.nonce
      ? { authenticationToken: token.authenticationToken, nonce: token.nonce }
      : null;
  }
  const token = await AccessToken.getCurrentAccessToken();
  return token?.accessToken ? { accessToken: token.accessToken } : null;
}

/**
 * What to put in front of the member.
 *
 * The key-hash error is the one worth its own words: it means this build
 * is signed with a key Meta has not been told about — the Play App
 * Signing key, the first time a Play-installed copy tries — and "try
 * again" would send somebody hunting for a fault that is in the Meta
 * dashboard (App settings → Basic → Android → Key hashes).
 */
function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/key hash/i.test(message)) {
    logger.error('auth', 'Facebook login: this build’s key hash is not registered with Meta', error);
    return 'Facebook sign-in is not set up for this build of the app.';
  }
  if (/net::|network|connection/i.test(message)) {
    return 'Facebook could not be reached. Check your connection and try again.';
  }
  logger.warn('auth', 'Facebook login failed', error);
  return 'Facebook sign-in did not work. Please try again.';
}
