import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { verifyAppleIdToken } from '../../lib/appleIdentity.js';
import { revokeAppleAuthorization, type RevocationResult } from '../../lib/appleTokens.js';
import { ApiError } from '../../lib/errors.js';
import { verifyGoogleIdToken } from '../../lib/googleIdentity.js';
import type { DeletionConfirmation } from '../../contracts/index.js';
import { hasPassword } from './password.js';
import type { UserDoc } from './models.js';

/**
 * Proving it is the member, again, before something nothing can undo —
 * deleting the account, or taking Apple off it (RULES O16).
 *
 * A password asked for again was the only proof there was, and an account
 * made with Google or Apple has none: it could not be deleted at all. Now
 * the proof is the account's own way in. Apple comes first wherever it is
 * connected, because that confirmation is also what lets the server revoke
 * the member's Apple authorisation, which Apple requires on deletion: the
 * fresh sign-in carries an authorisation code, and only a code yields a
 * token Apple will revoke.
 */

const appleConfirmation = z
  .object({
    idToken: z.string().trim().min(1).max(4000),
    nonce: z.string().trim().min(16).max(128),
    /** The one-time code that came with the token; five minutes to live. */
    authorizationCode: z.string().trim().min(1).max(2000),
  })
  .strict();
const googleConfirmation = z.object({ idToken: z.string().trim().min(1).max(4000) }).strict();

/** The proof fields a body may carry, one of which the account's method needs. */
export const confirmationFields = {
  password: z.string().min(1, 'Enter your password').max(200).optional(),
  apple: appleConfirmation.optional(),
  google: googleConfirmation.optional(),
};
export type Confirmation = {
  password?: string;
  apple?: z.infer<typeof appleConfirmation>;
  google?: z.infer<typeof googleConfirmation>;
};

/**
 * What the proof is for. A deletion takes Apple first wherever it is
 * connected, because only an Apple confirmation can also revoke; a change
 * to the account (its email) takes the password first and an Apple or
 * Google sign-in only where there is none — and never revokes anything.
 */
export type ProofPurpose = 'delete' | 'change';

/** Which proof this account gives, for this purpose. */
export function confirmationFor(user: UserDoc, purpose: ProofPurpose = 'delete'): DeletionConfirmation {
  if (purpose === 'delete' && user.appleId) return 'apple';
  if (hasPassword(user)) return 'password';
  if (user.appleId) return 'apple';
  if (user.googleId) return 'google';
  return 'password';
}

export interface Confirmed {
  method: DeletionConfirmation;
  /** Whether Apple was told to forget us; null when Apple was not the proof. */
  appleRevocation: RevocationResult | null;
}

/**
 * Checks the proof the account's method needs, and revokes Apple when Apple
 * was it. Only a wrong or missing proof refuses: a revocation that fails on
 * Apple's side is reported (`appleRevocation`) rather than keeping somebody
 * in an account they asked to leave.
 */
export async function confirmMember(
  user: UserDoc,
  proof: Confirmation,
  meta: { platform?: string },
  purpose: ProofPurpose = 'delete',
): Promise<Confirmed> {
  const method = confirmationFor(user, purpose);

  if (method === 'password') {
    if (!proof.password) throw Errors422('password', 'Enter your password');
    if (!(await bcrypt.compare(proof.password, user.passwordHash))) {
      throw new ApiError(422, 'PASSWORD_INCORRECT', 'That is not your password.', { password: 'That is not your password.' });
    }
    return { method, appleRevocation: null };
  }

  if (method === 'google') {
    if (!proof.google) throw confirmationRequired(method);
    const identity = await verifyGoogleIdToken(proof.google.idToken);
    if (identity.googleId !== user.googleId) {
      throw new ApiError(403, 'GOOGLE_ACCOUNT_MISMATCH', 'That is a different Google account from the one on this VOKVE account.');
    }
    return { method, appleRevocation: null };
  }

  if (!proof.apple) throw confirmationRequired(method);
  const identity = await verifyAppleIdToken(proof.apple.idToken, proof.apple.nonce);
  if (identity.appleId !== user.appleId) {
    throw new ApiError(403, 'APPLE_ID_MISMATCH', 'That is a different Apple ID from the one on this VOKVE account.');
  }
  if (purpose === 'change') return { method, appleRevocation: null };
  const appleRevocation = await revokeAppleAuthorization({
    code: proof.apple.authorizationCode,
    clientId: identity.audience,
    webFlow: meta.platform === 'android',
    userId: user._id,
  });
  return { method, appleRevocation };
}

const Errors422 = (field: string, message: string) =>
  new ApiError(422, 'VALIDATION_FAILED', 'Check the highlighted fields.', { [field]: message });

const confirmationRequired = (method: DeletionConfirmation) =>
  new ApiError(
    422,
    'CONFIRMATION_REQUIRED',
    `Confirm with ${method === 'apple' ? 'Apple' : 'Google'} — it is how this account signs in.`,
    { confirmWith: method },
  );
