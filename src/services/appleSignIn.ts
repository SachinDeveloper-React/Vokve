import { Platform } from 'react-native';
import {
  appleAuth,
  appleAuthAndroid,
} from '@invertase/react-native-apple-authentication';
import { config } from '../constants/config';
import { logger } from '../utils/logger';

/**
 * Signing in with Apple, as far as the phone is concerned (RULES O13).
 *
 * Google's rule (O12): the phone's job is to come back with a token, and
 * only the server reads who it names. Apple adds two things the phone has
 * to carry beside the token:
 *
 *  - **The raw nonce.** Each attempt gets a fresh one, made by the native
 *    side from the platform's secure random source; Apple signs its SHA-256
 *    into the token and the server checks the two agree. The raw value
 *    never appears in the token, so a token found somewhere is useless on
 *    its own.
 *  - **The name, once.** Apple tells the app the member's name on their
 *    very first authorisation and never again, and never puts it in the
 *    token. It goes up with that first sign-in or it is lost.
 *
 * The two platforms get there differently. iOS signs in natively. Android
 * has no Apple sign-in of its own, so the library opens Apple's web flow
 * in a WebView, identified by the Services ID in `config.appleServiceId`.
 */

export interface AppleFullName {
  givenName: string | null;
  familyName: string | null;
}

export type AppleOutcome =
  | {
      kind: 'signed_in';
      idToken: string;
      nonce: string;
      /** Only on the member's first Apple sign-in to this app. */
      fullName: AppleFullName | null;
      /**
       * The one-time code Apple issues with the token, good for five
       * minutes. Only an account deletion or an Apple disconnect sends it:
       * the server trades it for a token and revokes that (RULES O16).
       */
      authorizationCode: string | null;
      /**
       * Apple's id for the member on iOS (the token's `sub`), which is what
       * the credential-state check asks about. Android's web flow does not
       * hand it over, and Android has no such check.
       */
      appleUser: string | null;
    }
  /** The member backed out. Nothing to say, nothing to log. */
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

const NOT_SET_UP = 'Apple sign-in is not set up for this build of the app.';
const DID_NOT_WORK = 'Apple sign-in did not work. Please try again.';

export async function signInWithApple(): Promise<AppleOutcome> {
  if (Platform.OS === 'ios') return signInOnIos();
  if (Platform.OS === 'android') return signInOnAndroid();
  return { kind: 'failed', message: 'Apple sign-in is not available on this device.' };
}

async function signInOnIos(): Promise<AppleOutcome> {
  if (!appleAuth.isSupported) {
    return { kind: 'failed', message: 'Sign in with Apple needs iOS 13 or later.' };
  }
  try {
    // No nonce passed: the library makes one from SecRandomCopyBytes,
    // sends Apple its SHA-256 and hands the raw value back.
    const response = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      // Name first: the library's own notes report the name going missing
      // on the first authorisation when the scopes are the other way round.
      requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
    });

    if (!response.identityToken || !response.nonce) {
      logger.warn('auth', 'Apple answered without an identity token or nonce');
      return { kind: 'failed', message: DID_NOT_WORK };
    }

    return {
      kind: 'signed_in',
      idToken: response.identityToken,
      nonce: response.nonce,
      fullName: nameOf(response.fullName?.givenName, response.fullName?.familyName),
      authorizationCode: response.authorizationCode ?? null,
      appleUser: response.user || null,
    };
  } catch (error) {
    return explainIos(error);
  }
}

async function signInOnAndroid(): Promise<AppleOutcome> {
  if (!appleAuthAndroid.isSupported) {
    return { kind: 'failed', message: 'Apple sign-in is not available on this phone.' };
  }
  if (!config.appleServiceId || !config.appleRedirectUri) {
    logger.error('auth', 'Apple sign-in on Android needs appleServiceId and appleRedirectUri');
    return { kind: 'failed', message: NOT_SET_UP };
  }

  try {
    // Configured on every attempt, not once: that is what gives each
    // attempt its own nonce and state. Neither is passed — the native side
    // makes both from a secure random UUID and returns the raw nonce.
    appleAuthAndroid.configure({
      clientId: config.appleServiceId,
      redirectUri: config.appleRedirectUri,
      responseType: appleAuthAndroid.ResponseType.ALL,
      scope: appleAuthAndroid.Scope.ALL,
    });
    const response = await appleAuthAndroid.signIn();

    if (!response.id_token || !response.nonce) {
      logger.warn('auth', 'Apple answered without an identity token or nonce');
      return { kind: 'failed', message: DID_NOT_WORK };
    }

    return {
      kind: 'signed_in',
      idToken: response.id_token,
      nonce: response.nonce,
      fullName: nameOf(response.user?.name?.firstName, response.user?.name?.lastName),
      authorizationCode: response.code ?? null,
      appleUser: null,
    };
  } catch (error) {
    return explainAndroid(error);
  }
}

function nameOf(
  given: string | null | undefined,
  family: string | null | undefined,
): AppleFullName | null {
  const givenName = given?.trim() || null;
  const familyName = family?.trim() || null;
  return givenName || familyName ? { givenName, familyName } : null;
}

const codeOf = (error: unknown): string | null =>
  error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
const messageOf = (error: unknown): string | null =>
  error instanceof Error ? error.message : null;

/**
 * iOS reports a cancel as error `1001`, which is also what a member who
 * dismisses the "sign in to your Apple ID" prompt gets — both are a
 * decision, not a failure. `1000` is the one worth its own log line: it is
 * what a build without the Sign in with Apple entitlement answers, on
 * every press, and what a simulator with no Apple ID answers too.
 */
function explainIos(error: unknown): AppleOutcome {
  switch (codeOf(error)) {
    case appleAuth.Error.CANCELED:
      return { kind: 'cancelled' };
    case appleAuth.Error.UNKNOWN:
      logger.error(
        'auth',
        'Apple sign-in failed with 1000 — check the Sign in with Apple capability and that the device has an Apple ID',
        error,
      );
      return {
        kind: 'failed',
        message: 'Apple sign-in is not available right now. Check that this iPhone is signed in to an Apple ID.',
      };
    default:
      logger.warn('auth', `Apple sign-in failed (${codeOf(error) ?? 'no code'})`, error);
      return { kind: 'failed', message: DID_NOT_WORK };
  }
}

/**
 * The Android module rejects a cancel with the constant as the *message*
 * (its code is left unset), and a failure with it as the code — so both
 * are read. A failure is mostly Apple refusing the Services ID or the
 * return URL, which shows on Apple's own page before the WebView closes.
 */
function explainAndroid(error: unknown): AppleOutcome {
  const said = [codeOf(error), messageOf(error)];
  if (said.includes(appleAuthAndroid.Error.SIGNIN_CANCELLED)) return { kind: 'cancelled' };
  if (said.includes(appleAuthAndroid.Error.NOT_CONFIGURED)) {
    logger.error('auth', 'Apple sign-in could not open on Android', error);
    return { kind: 'failed', message: NOT_SET_UP };
  }
  logger.warn('auth', 'Apple sign-in failed on Android', error);
  return { kind: 'failed', message: DID_NOT_WORK };
}
