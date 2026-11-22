import { ApiError } from './errors.js';
import { firebaseAdminApp } from './firebaseAdmin.js';
import { logger } from './logger.js';

/**
 * Which phone number Firebase says somebody holds (RULES O14).
 *
 * This server has no SMS sender of its own. Firebase Phone Auth sends the
 * code and checks it on the phone, and what the phone brings back is a
 * Firebase ID token whose `phone_number` claim Firebase has proved. This
 * file believes that claim only after firebase-admin has checked the
 * token's signature, issuer, audience (our Firebase project) and expiry —
 * the same rule as Google and Apple sign-in: the token is the statement,
 * nothing beside it.
 *
 * Firebase is used as an SMS service and nothing more. The Firebase user
 * that phone sign-in leaves behind is not an account here; the caller
 * deletes it once the number has been taken (`forgetFirebaseUser`), so
 * Firebase does not keep a second list of our members' numbers.
 */

/** How old a phone confirmation may be. A token from yesterday proves nothing about today. */
const MAX_AGE_SECONDS = 10 * 60;

export interface VerifiedPhone {
  /** E.164, exactly as Firebase proved it. */
  phone: string;
  /** The throwaway Firebase user phone sign-in created. */
  firebaseUid: string;
}

let verifier: ((idToken: string) => Promise<VerifiedPhone>) | null = null;
let forgetter: ((uid: string) => Promise<void>) | null = null;

/** Tests swap these for ones that do not reach Google. */
export function setFirebasePhoneVerifier(next: ((idToken: string) => Promise<VerifiedPhone>) | null): void {
  verifier = next;
}
export function setFirebaseUserForgetter(next: ((uid: string) => Promise<void>) | null): void {
  forgetter = next;
}

const rejected = () =>
  new ApiError(401, 'PHONE_TOKEN_INVALID', 'That number could not be confirmed. Please send a new code.');

export async function verifyFirebasePhoneToken(idToken: string): Promise<VerifiedPhone> {
  if (verifier) return verifier(idToken);

  const firebase = await firebaseAdminApp();
  if (!firebase) {
    throw new ApiError(503, 'PHONE_VERIFICATION_UNAVAILABLE', 'Phone verification is not set up on this server.');
  }

  let decoded;
  try {
    decoded = await firebase.app.auth().verifyIdToken(idToken);
  } catch (error) {
    logger.warn({ err: error }, 'phone.firebase_token_rejected');
    throw rejected();
  }

  // A token from any other kind of Firebase sign-in carries no proved number.
  if (decoded.firebase?.sign_in_provider !== 'phone' || typeof decoded.phone_number !== 'string') {
    throw rejected();
  }
  if (Date.now() / 1000 - decoded.auth_time > MAX_AGE_SECONDS) {
    throw new ApiError(401, 'PHONE_TOKEN_STALE', 'That code was confirmed too long ago. Please send a new one.');
  }

  return { phone: decoded.phone_number, firebaseUid: decoded.uid };
}

/**
 * Deletes the Firebase user phone sign-in made. Best effort: the number is
 * already ours by now, and a Firebase hiccup must not undo that.
 */
export async function forgetFirebaseUser(uid: string): Promise<void> {
  try {
    if (forgetter) return await forgetter(uid);
    const firebase = await firebaseAdminApp();
    await firebase?.app.auth().deleteUser(uid);
  } catch (error) {
    logger.warn({ err: error, uid }, 'phone.firebase_user_not_deleted');
  }
}
