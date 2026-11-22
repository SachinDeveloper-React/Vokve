import {
  getAuth,
  getIdToken,
  onAuthStateChanged,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
  type User as FirebaseUser,
} from '@react-native-firebase/auth';
import { logger } from '../utils/logger';

/**
 * Proving a phone number, as far as the phone is concerned (RULES O14).
 *
 * The backend has no SMS sender, so Firebase Phone Auth does the sending and
 * the checking. The phone's job is the same as with Google and Apple: come
 * back with a token — here a Firebase ID token carrying the proved number —
 * and hand it to the server, which alone decides whether that number goes
 * on the account.
 *
 * Firebase is used for the SMS and nothing else. Phone sign-in leaves a
 * Firebase session on the device; it is signed out the moment the token is
 * in hand, and the server deletes the Firebase user once it has the number.
 *
 * Two ways a number gets proved:
 *  - the member types the code from the SMS (`confirmCode`);
 *  - **Android only**, Google Play reads the SMS itself, or skips it, and
 *    Firebase signs in on its own. `sendCode` notices that straight away and
 *    `watchForAutoVerification` catches it later, while the code screen is up.
 */

export type SendOutcome =
  /** The SMS is on its way; ask for the code. */
  | { kind: 'sent' }
  /** Android proved the number without the member typing anything. */
  | { kind: 'verified'; idToken: string }
  | { kind: 'failed'; message: string };

export type ConfirmOutcome =
  | { kind: 'verified'; idToken: string }
  | { kind: 'failed'; message: string; codeRejected: boolean };

let pending: { phone: string; confirmation: ConfirmationResult } | null = null;
/**
 * The token once a number is proved, shared by whoever asks: on Android the
 * auto-verification watcher and a typed code can both see the same sign-in,
 * and the second must get the same answer rather than a session already
 * signed out.
 */
let settled: { phone: string; idToken: Promise<string> } | null = null;

/**
 * Asks Firebase to text a code to `phone` (E.164). Also the resend: Firebase
 * sends a fresh SMS once the previous request has timed out (a minute), which
 * is why the screen holds the resend button for that long.
 */
export async function sendCode(phone: string): Promise<SendOutcome> {
  const auth = getAuth();
  try {
    // A Firebase session left from an earlier attempt would read as this
    // number being proved already.
    if (auth.currentUser) await signOut(auth);
    settled = null;

    const confirmation = await signInWithPhoneNumber(auth, phone);
    pending = { phone, confirmation };

    // Android's instant verification signs in before this resolves.
    const tokenNow = await tokenFor(auth.currentUser, phone);
    return tokenNow ? { kind: 'verified', idToken: tokenNow } : { kind: 'sent' };
  } catch (error) {
    return { kind: 'failed', message: explain(error) };
  }
}

/** Checks the code the member typed. */
export async function confirmCode(code: string): Promise<ConfirmOutcome> {
  if (!pending) {
    return { kind: 'failed', message: 'That code has expired. Send a new one.', codeRejected: false };
  }
  // Read before the await: the sign-in it causes can finish the attempt
  // (and clear `pending`) from the auto-verification watcher.
  const { phone, confirmation } = pending;
  try {
    const credential = await confirmation.confirm(code);
    const idToken = await tokenFor(credential?.user ?? null, phone);
    if (!idToken) {
      return { kind: 'failed', message: 'That number could not be confirmed. Send a new code.', codeRejected: false };
    }
    return { kind: 'verified', idToken };
  } catch (error) {
    const firebaseCode = codeOf(error);
    return {
      kind: 'failed',
      message: explain(error),
      codeRejected: firebaseCode === 'auth/invalid-verification-code',
    };
  }
}

/**
 * Calls `onVerified` if Android proves the number by itself while the code
 * screen is open. Returns the unsubscribe.
 */
export function watchForAutoVerification(
  phone: string,
  onVerified: (idToken: string) => void,
): () => void {
  return onAuthStateChanged(getAuth(), user => {
    tokenFor(user, phone)
      .then(idToken => {
        if (idToken) onVerified(idToken);
      })
      .catch(error => logger.warn('phone', 'Auto-verified token not read', error));
  });
}

/** Drops the attempt and any Firebase session it left. Never throws. */
export async function abandon(): Promise<void> {
  pending = null;
  settled = null;
  const auth = getAuth();
  try {
    if (auth.currentUser) await signOut(auth);
  } catch (error) {
    logger.debug('phone', 'Firebase session not cleared', error);
  }
}

/**
 * The token for a Firebase user that holds `phone`, then signs Firebase out:
 * the session has done its job, and the app keeps no Firebase account.
 */
async function tokenFor(user: FirebaseUser | null, phone: string): Promise<string | null> {
  if (settled?.phone === phone) return settled.idToken;
  if (!user || user.phoneNumber !== phone) return null;
  const idToken = getIdToken(user, true).then(async token => {
    await signOut(getAuth()).catch(() => undefined);
    return token;
  });
  settled = { phone, idToken };
  pending = null;
  try {
    return await idToken;
  } catch (error) {
    settled = null;
    throw error;
  }
}

const codeOf = (error: unknown): string | null =>
  error && typeof error === 'object' && 'code' in error ? String(error.code) : null;

/**
 * What to put in front of the member. The configuration errors get a log
 * line of their own: they are what a first build hits (the SHA-256 missing
 * from Firebase, the Phone provider not switched on) and the member can do
 * nothing about them.
 */
function explain(error: unknown): string {
  switch (codeOf(error)) {
    case 'auth/invalid-phone-number':
      return 'That phone number does not look right. Check it and try again.';
    case 'auth/invalid-verification-code':
      return 'That code is not right. Check it and try again.';
    case 'auth/session-expired':
    case 'auth/code-expired':
      return 'That code has expired. Send a new one.';
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return 'Too many codes have been sent. Please wait a while and try again.';
    case 'auth/network-request-failed':
      return 'No connection. Check your internet and try again.';
    case 'auth/app-not-authorized':
    case 'auth/missing-client-identifier':
    case 'auth/operation-not-allowed':
    case 'auth/invalid-app-credential':
      logger.error('phone', 'Firebase phone verification is not set up for this build', error);
      return 'Phone verification is not set up for this build of the app.';
    default:
      logger.warn('phone', `Phone verification failed (${codeOf(error) ?? 'no code'})`, error);
      return 'We could not send or check the code. Please try again.';
  }
}
