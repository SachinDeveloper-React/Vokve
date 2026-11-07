import {
  GoogleOneTapSignIn,
  isCancelledResponse,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from 'react-native-nitro-google-signin';
import { config } from '../constants/config';
import { logger } from '../utils/logger';

/**
 * Signing in with Google, as far as the phone is concerned (RULES O12).
 *
 * The phone's whole job is to come back with an **ID token**. It does not
 * decide who the member is: the email, the name and the id in that token
 * are Google's statement, and only the server — which can check Google's
 * signature — is allowed to read them. Anything this file returned about
 * the user beyond the token would be a fact nobody had verified.
 *
 * `configure` is required before any other call and is cheap and
 * synchronous, so it runs lazily here rather than at launch: a member who
 * never presses the button should not pay for the native SDK waking up,
 * and a build with no client id should fail when somebody asks for Google
 * rather than while the splash screen is up.
 *
 * Cancelling is not an error. The library returns it as a *response*
 * (`type: 'cancelled'`), and the one thing the screen must not do is show
 * a red message to somebody who simply changed their mind.
 */

export type GoogleOutcome =
  | { kind: 'signed_in'; idToken: string }
  /** The member backed out. Nothing to say, nothing to log. */
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

let configured = false;

/**
 * `autoDetect` reads the web client id the Google Services plugin wrote
 * into the Android resources, and the iOS plist on iOS, so the id lives
 * with the rest of the Firebase config rather than in two places that
 * can disagree. An explicit id from our own config wins where it is set,
 * which is what a build pointed at a different project needs.
 */
function ensureConfigured(): void {
  if (configured) return;
  GoogleOneTapSignIn.configure({
    webClientId: config.googleWebClientId ?? 'autoDetect',
    ...(config.googleIosClientId ? { iosClientId: config.googleIosClientId } : {}),
  });
  configured = true;
}

/**
 * Asks Google who this is, and hands back the token for the server.
 *
 * Two prompts rather than one. `signIn` is the quiet path — on Android it
 * offers accounts the member has already used here, on iOS it can restore
 * the previous session — and when there is nothing saved it answers
 * `noSavedCredentialFound` rather than failing. That is the moment to
 * show the full account sheet, and doing it in one call is what makes the
 * first sign-in on a phone work without the member pressing twice.
 */
export async function signInWithGoogle(): Promise<GoogleOutcome> {
  try {
    ensureConfigured();
    // Android only; a no-op on iOS. Without it a phone with no Play
    // Services fails inside the sign-in with a less useful error.
    await GoogleOneTapSignIn.checkPlayServices();

    let response = await GoogleOneTapSignIn.signIn();
    if (!isSuccessResponse(response) && !isCancelledResponse(response)) {
      // Nothing saved on this phone: ask properly rather than reporting
      // "no credential", which is not a failure the member can act on.
      response = await GoogleOneTapSignIn.presentExplicitSignIn();
    }

    if (isCancelledResponse(response)) return { kind: 'cancelled' };
    if (!isSuccessResponse(response)) {
      return { kind: 'failed', message: 'Google did not complete the sign-in. Please try again.' };
    }

    return { kind: 'signed_in', idToken: response.data.idToken };
  } catch (error) {
    return { kind: 'failed', message: explain(error) };
  }
}

/**
 * Forgets the Google session on this phone.
 *
 * Called on sign-out so the next member on a shared phone is asked which
 * account to use, rather than being signed straight back into the last
 * one. Never throws: a sign-out that failed because Google would not
 * answer is still a sign-out.
 */
export async function forgetGoogleSession(): Promise<void> {
  if (!configured) return;
  try {
    await GoogleOneTapSignIn.signOut();
  } catch (error) {
    logger.debug('auth', 'Google session not cleared', error);
  }
}

/**
 * What to put in front of the member.
 *
 * `DEVELOPER_ERROR` is the one worth its own words. It means the SHA-1,
 * the package name or the client id do not match what Google has, and it
 * is the error every first integration hits — on a release build, after
 * the debug one worked. A generic "try again" there sends somebody
 * hunting through their own network settings for a fault that is in the
 * console.
 */
function explain(error: unknown): string {
  if (!isErrorWithCode(error)) {
    logger.warn('auth', 'Google sign-in failed', error);
    return 'Google sign-in did not work. Please try again.';
  }

  switch (error.code) {
    case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
      return 'This phone needs Google Play services to sign in with Google.';
    case statusCodes.SIGN_IN_CANCELLED:
      return 'Google sign-in was cancelled.';
    case statusCodes.IN_PROGRESS:
      return 'A Google sign-in is already open.';
    case statusCodes.DEVELOPER_ERROR:
      logger.error('auth', 'Google sign-in is misconfigured for this build', error);
      return 'Google sign-in is not set up for this build of the app.';
    default:
      logger.warn('auth', `Google sign-in failed (${error.code})`, error);
      return 'Google sign-in did not work. Please try again.';
  }
}
