import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { User } from '../../contracts/index.js';
import { Errors } from '../../lib/errors.js';
import { forgetFirebaseUser, verifyFirebasePhoneToken } from '../../lib/firebasePhone.js';
import { signUpBody } from '../identity/auth.service.js';
import { UserModel, type UserDoc } from '../identity/models.js';
import { toUser } from '../identity/serialize.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * Adding, verifying and changing the account's phone number (RULES O14).
 *
 * Firebase sends the code and checks it on the phone; this server has no
 * SMS sender. What arrives here is a Firebase token proving the number, and
 * the one decision left is whether this member may put that number on this
 * account:
 *
 *  - **The number already on file** — the member is proving the number they
 *    gave at sign-up. Nothing to ask.
 *  - **No number on file** — a Google or Apple account adding its first.
 *    Nothing to ask either: no existing contact is being replaced, and the
 *    new one has just proved itself.
 *  - **A different number than the one on file** — a change, which needs
 *    the password, exactly as `/me/phone` always has (O2): a number is a
 *    way back into the account (password reset), and somebody holding an
 *    unlocked phone must not be able to swap in their own. A Google or
 *    Apple account has no password to give and is told to set one first.
 *
 * `check` runs the same rules before the phone asks Firebase for an SMS, so
 * a taken number or a wrong password costs nothing and is said at once;
 * `verify` runs them again, and its answer is the one that counts.
 */

export const phoneCheckBody = z
  .object({
    phone: signUpBody.shape.phone,
    password: z.string().min(1).max(200).optional(),
  })
  .strict();

export const phoneVerifyBody = z
  .object({
    idToken: z.string().trim().min(1).max(4096),
    password: z.string().min(1).max(200).optional(),
  })
  .strict();

const TAKEN = 'That number is already registered to another account.';

/** A bcrypt hash; Google, Apple and deleted accounts carry strings that never are. */
const hasPassword = (user: UserDoc) => user.passwordHash.startsWith('$2');

async function problemsWith(
  user: UserDoc,
  phone: string,
  password: string | undefined,
): Promise<Record<string, string> | null> {
  if (user.phone === phone && user.phoneVerifiedAt) {
    return { phone: 'That is already your verified number.' };
  }
  if (await UserModel.exists({ phone, _id: { $ne: user._id } })) {
    return { phone: TAKEN };
  }
  const replacing = Boolean(user.phone) && user.phone !== phone;
  if (replacing) {
    if (!hasPassword(user)) {
      return {
        password:
          'Changing your number needs a password, and this account has none yet. Set one with "Forgot password" on the sign-in screen, then try again.',
      };
    }
    if (!password) return { password: 'Enter your password to change your number.' };
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      return { password: 'That is not your password.' };
    }
  }
  return null;
}

async function memberOf(userId: string): Promise<UserDoc> {
  const user = await UserModel.findById(userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();
  return user;
}

/** Before the SMS: may this number go on this account? */
export async function checkPhone(userId: string, body: z.infer<typeof phoneCheckBody>): Promise<{ ok: true }> {
  const problems = await problemsWith(await memberOf(userId), body.phone, body.password);
  if (problems) throw Errors.validation(problems);
  return { ok: true };
}

/** After the SMS: the number Firebase proved goes on the account, verified. */
export async function verifyPhone(
  userId: string,
  body: z.infer<typeof phoneVerifyBody>,
  meta: { deviceId?: string },
): Promise<User> {
  const { phone, firebaseUid } = await verifyFirebasePhoneToken(body.idToken);
  try {
    const user = await memberOf(userId);
    // A second tap, or a retry after a dropped answer: already done.
    if (user.phone === phone && user.phoneVerifiedAt) return toUser(user);

    const problems = await problemsWith(user, phone, body.password);
    if (problems) throw Errors.validation(problems);

    const previous = user.phone ?? null;
    user.phone = phone;
    user.phoneVerifiedAt = new Date();
    try {
      await user.save();
    } catch (error) {
      // Two accounts racing for one number: the unique index decides.
      if ((error as { code?: number }).code === 11000) throw Errors.validation({ phone: TAKEN });
      throw error;
    }
    await AuditLogModel.create({
      actorType: 'user', actorId: user._id, deviceId: meta.deviceId,
      action: 'user.phone_verified', subjectType: 'user', subjectId: user._id,
      before: { phone: previous }, after: { phone, via: 'firebase' },
    });
    return toUser(user);
  } finally {
    await forgetFirebaseUser(firebaseUid);
  }
}
