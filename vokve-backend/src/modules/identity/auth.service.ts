import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { getConfig } from '../../config/remote.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { hashToken, newRefreshToken, signAccessToken } from '../../lib/tokens.js';
import { authResponseSchema, genderSchema, type AuthResponse } from '../../contracts/index.js';
import { CoinBalanceModel } from '../economy/models.js';
import { AuditLogModel } from '../platform/models.js';
import { NotificationPreferencesModel, RefreshTokenModel, UserModel, UserSettingsModel, type UserDoc } from './models.js';
import { consumeChallenge, createChallenge, findLiveChallenge, isChannelDeliverable, isChannelUsable } from './otp.service.js';
import { toUser } from './serialize.js';

// ─── Request shapes (mirror src/types/forms.ts on the client) ───────────────

export const signUpBody = z.object({
  email: z.string().trim().toLowerCase().email('That does not look like an email address'),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Enter a valid phone number'),
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(72, 'Passwords cannot be longer than 72 characters')
    .regex(/[A-Za-z]/, 'Include at least one letter')
    .regex(/\d/, 'Include at least one number'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Select your date of birth'),
  gender: genderSchema,
});
export type SignUpBody = z.infer<typeof signUpBody>;

export const signInBody = z.object({
  /** The client's field is called `email` but holds an email or a phone. */
  email: z.string().trim().min(1, 'Enter your email or phone number'),
  password: z.string().min(1, 'Enter your password'),
});

export const verifyOtpBody = z.object({ verificationId: z.string().min(1), code: z.string().regex(/^\d{4,8}$/) });
export const resendOtpBody = z.object({ verificationId: z.string().min(1) });
export const refreshBody = z.object({ refreshToken: z.string().min(1) });
export const otpRequestBody = z.object({ identifier: z.string().trim().min(1), purpose: z.enum(['login', 'reset_password']) });
export const resetPasswordBody = z.object({ verificationId: z.string().min(1), code: z.string().regex(/^\d{4,8}$/), password: signUpBody.shape.password });

interface Meta { deviceId?: string; ip?: string }

// ─── Sign-up → phone OTP → (account) → email OTP ───────────────────────────

export async function signUp(body: SignUpBody, meta: Meta) {
  const [byEmail, byPhone] = await Promise.all([
    UserModel.exists({ email: body.email }).collation({ locale: 'en', strength: 2 }),
    UserModel.exists({ phone: body.phone }),
  ]);
  const details: Record<string, string> = {};
  if (byEmail) details.email = 'That email address is already registered.';
  if (byPhone) details['phone.number'] = 'That phone number is already registered.';
  if (Object.keys(details).length) throw Errors.validation(details);

  // The account does not exist until one contact is proven; the payload
  // rides on the challenge (RULES O3). The hash is computed now so a verified
  // challenge can create the user without the password in the document.
  //
  // Which contact goes first is config: email while there is no SMS
  // provider, phone once there is. If the configured channel cannot deliver
  // at all, the other one is used rather than sending nothing.
  const { otp } = await getConfig();
  const channel = isChannelUsable(otp.signupChannel) ? otp.signupChannel : otp.signupChannel === 'email' ? 'sms' : 'email';
  const passwordHash = await bcrypt.hash(body.password, 12);
  return createChallenge({
    channel,
    purpose: 'signup',
    target: channel === 'email' ? body.email : body.phone,
    payload: { email: body.email, phone: body.phone, passwordHash, dateOfBirth: body.dateOfBirth, gender: body.gender },
    deviceId: meta.deviceId,
    ip: meta.ip,
  });
}

export async function resendOtp(verificationId: string, meta: Meta) {
  const previous = await findLiveChallenge(verificationId);
  return createChallenge({
    channel: previous.channel as 'sms' | 'email',
    purpose: previous.purpose as never,
    target: previous.target,
    userId: previous.userId,
    payload: previous.payload,
    deviceId: meta.deviceId,
    ip: meta.ip,
    previous: { _id: previous._id, resends: previous.resends, resendAfter: previous.resendAfter, decoy: previous.decoy },
  });
}

/**
 * One endpoint, polymorphic on purpose (RULES O2). Every branch ends in a
 * session so the client has one screen and one call.
 */
export async function verifyOtp(verificationId: string, code: string, meta: Meta): Promise<AuthResponse> {
  const challenge = await consumeChallenge(verificationId, code);

  switch (challenge.purpose) {
    case 'signup': {
      const p = challenge.payload as { email: string; phone: string; passwordHash: string; dateOfBirth: string; gender: string };
      const config = await getConfig();
      const userId = newId('usr');
      const provenEmail = challenge.channel === 'email';
      try {
        await UserModel.create({
          _id: userId, email: p.email, phone: p.phone, passwordHash: p.passwordHash,
          dateOfBirth: p.dateOfBirth, gender: p.gender,
          emailVerifiedAt: provenEmail ? new Date() : null,
          phoneVerifiedAt: provenEmail ? null : new Date(),
          country: config.locale.country, timezone: config.locale.timezone,
          trust: { score: config.trust.newAccountScore, tier: 'normal', updatedAt: new Date() },
        });
      } catch (error) {
        if ((error as { code?: number }).code === 11000) {
          throw new ApiError(409, 'ALREADY_REGISTERED', 'This number or email was registered a moment ago. Try signing in.');
        }
        throw error;
      }
      await Promise.all([
        UserSettingsModel.create({ _id: userId }),
        NotificationPreferencesModel.create({ _id: userId }),
        CoinBalanceModel.create({ _id: userId }),
        AuditLogModel.create({ actorType: 'user', actorId: userId, deviceId: meta.deviceId, action: 'user.signup', subjectType: 'user', subjectId: userId }),
      ]);
      const user = (await UserModel.findById(userId))!;
      const session = await issueSession(user, meta);
      // The other contact is proven the same way, right after (RULES O4) —
      // sent now so the app can ask for it without another round-trip. Only
      // if that channel can actually deliver: a code nobody can receive is
      // worse than none, and the banner asks again once it can.
      const secondary: 'sms' | 'email' = provenEmail ? 'sms' : 'email';
      if (!isChannelDeliverable(secondary)) {
        return session;
      }
      const nextVerification = await createChallenge({
        channel: secondary, purpose: provenEmail ? 'verify_phone' : 'verify_email',
        target: provenEmail ? user.phone : user.email, userId, deviceId: meta.deviceId, ip: meta.ip,
      });
      return { ...session, nextVerification };
    }
    case 'verify_phone': {
      const user = await UserModel.findById(challenge.userId);
      if (!user) throw Errors.unauthorized();
      if (user.phone !== challenge.target) throw new ApiError(409, 'PHONE_CHANGED', 'Your number changed since this code was sent. Request a new one.');
      user.phoneVerifiedAt = new Date();
      await user.save();
      await AuditLogModel.create({ actorType: 'user', actorId: user._id, deviceId: meta.deviceId, action: 'user.phone_verified', subjectType: 'user', subjectId: user._id });
      return issueSession(user, meta);
    }
    case 'verify_email': {
      const user = await UserModel.findById(challenge.userId);
      if (!user) throw Errors.unauthorized();
      if (user.email !== challenge.target) throw new ApiError(409, 'EMAIL_CHANGED', 'Your email changed since this code was sent. Request a new one.');
      user.emailVerifiedAt = new Date();
      await user.save();
      await AuditLogModel.create({ actorType: 'user', actorId: user._id, deviceId: meta.deviceId, action: 'user.email_verified', subjectType: 'user', subjectId: user._id });
      return issueSession(user, meta);
    }
    case 'login': {
      const user = await UserModel.findById(challenge.userId);
      if (!user || user.deletedAt) throw Errors.unauthorized();
      return issueSession(user, meta);
    }
    case 'change_phone':
    case 'change_email': {
      const user = await UserModel.findById(challenge.userId);
      if (!user) throw Errors.unauthorized();
      const next = (challenge.payload as { next: string }).next;
      if (challenge.purpose === 'change_email') {
        user.email = next;
        user.emailVerifiedAt = new Date();
      } else {
        user.phone = next;
        user.phoneVerifiedAt = new Date();
      }
      try {
        await user.save();
      } catch (error) {
        if ((error as { code?: number }).code === 11000) throw Errors.validation({ [challenge.purpose === 'change_email' ? 'email' : 'phone']: 'That is already registered.' });
        throw error;
      }
      await AuditLogModel.create({ actorType: 'user', actorId: user._id, deviceId: meta.deviceId, action: `user.${challenge.purpose}`, subjectType: 'user', subjectId: user._id, after: { [challenge.purpose === 'change_email' ? 'email' : 'phone']: next } });
      return issueSession(user, meta);
    }
    default:
      throw new ApiError(400, 'OTP_WRONG_PURPOSE', 'This code cannot be used here.');
  }
}

// ─── Password sign-in ───────────────────────────────────────────────────────

export async function signIn(identifier: string, password: string, meta: Meta): Promise<AuthResponse> {
  const user = await findByIdentifier(identifier);
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : await bcrypt.compare(password, DUMMY_HASH);
  if (!user || !ok || user.deletedAt) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'That email or phone and password do not match.');
  }
  // One proven contact is enough to sign in; both are needed to spend (RULES O5).
  if (!user.phoneVerifiedAt && !user.emailVerifiedAt) {
    throw new ApiError(403, 'CONTACT_NOT_VERIFIED', 'Verify your email or phone number to continue.');
  }
  return issueSession(user, meta);
}

/** Constant-time-ish: always run one bcrypt compare so a missing user is not faster. */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5aKq3wHjJ7a1pQd9dfZKQv0Xw1ZbUeq';

export async function findByIdentifier(identifier: string): Promise<UserDoc | null> {
  const value = identifier.trim();
  if (value.includes('@')) {
    return UserModel.findOne({ email: value.toLowerCase() }).collation({ locale: 'en', strength: 2 });
  }
  const digits = value.replace(/[\s-]/g, '');
  return UserModel.findOne({ phone: digits.startsWith('+') ? digits : `+${digits}` });
}

// ─── Passwordless / reset ───────────────────────────────────────────────────

export async function requestOtp(identifier: string, purpose: 'login' | 'reset_password', meta: Meta) {
  const user = await findByIdentifier(identifier);
  const channel = identifier.includes('@') ? 'email' : 'sms';
  // Never reveal whether an account exists (RULES O9): an unknown identifier
  // gets a decoy challenge — stored, rate-limited and masked exactly like a
  // real one, but never delivered — so the response and every later error
  // are the same either way.
  const target = user ? (channel === 'email' ? user.email : user.phone) : normaliseIdentifier(identifier, channel);
  return createChallenge({
    channel, purpose, target, userId: user?._id ?? null, deviceId: meta.deviceId, ip: meta.ip, decoy: !user,
  });
}

function normaliseIdentifier(identifier: string, channel: 'sms' | 'email'): string {
  const value = identifier.trim();
  if (channel === 'email') return value.toLowerCase();
  const digits = value.replace(/[\s-]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}

/** Changing a contact detail proves the *new* one first (RULES O7). */
export async function requestContactChange(userId: string, kind: 'phone' | 'email', newValue: string, meta: Meta) {
  const user = await UserModel.findById(userId);
  if (!user) throw Errors.unauthorized();
  const channel = kind === 'email' ? 'email' : 'sms';
  const target = normaliseIdentifier(newValue, channel);
  if ((kind === 'email' && target === user.email) || (kind === 'phone' && target === user.phone)) {
    throw new ApiError(422, 'SAME_CONTACT', `That is already your ${kind}.`);
  }
  const taken = kind === 'email'
    ? await UserModel.exists({ email: target }).collation({ locale: 'en', strength: 2 })
    : await UserModel.exists({ phone: target });
  if (taken) throw Errors.validation({ [kind]: `That ${kind} is already registered.` });
  return createChallenge({
    channel, purpose: kind === 'email' ? 'change_email' : 'change_phone', target, userId, payload: { next: target },
    deviceId: meta.deviceId, ip: meta.ip,
  });
}

export async function resetPassword(verificationId: string, code: string, password: string) {
  const challenge = await consumeChallenge(verificationId, code, ['reset_password']);
  // A decoy can only reach here if its undelivered code was guessed — treat it as a wrong code, not a clue.
  const user = challenge.userId ? await UserModel.findById(challenge.userId) : null;
  if (!user) throw new ApiError(422, 'OTP_INVALID', 'That code is not right. Check it and try again.');
  user.passwordHash = await bcrypt.hash(password, 12);
  await user.save();
  await RefreshTokenModel.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return { ok: true };
}

// ─── Sessions ───────────────────────────────────────────────────────────────

export async function issueSession(user: UserDoc, meta: Meta): Promise<AuthResponse> {
  const access = signAccessToken({ sub: user._id, tier: user.trust?.tier ?? 'normal' });
  const refresh = newRefreshToken();
  await RefreshTokenModel.create({
    userId: user._id,
    deviceId: meta.deviceId ?? null,
    tokenHash: refresh.hash,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  return authResponseSchema.parse({
    user: toUser(user),
    tokens: { accessToken: access.token, refreshToken: refresh.token, expiresAt: access.expiresAt },
    emailVerification: null,
  });
}

/**
 * Rotation with a grace window (RULES Z1): the old token is marked superseded
 * rather than deleted, and is honoured for 30 s so a request that raced the
 * refresh can still replay. A token presented from a different device than
 * the one it was bound to is treated as theft (RULES DV7).
 */
export async function refreshSession(refreshToken: string, meta: Meta) {
  const hash = hashToken(refreshToken);
  const row = await RefreshTokenModel.findOne({ tokenHash: hash });
  if (!row || row.expiresAt < new Date()) throw Errors.unauthorized();
  if (row.revokedAt) throw Errors.unauthorized();
  if (row.supersededBy) {
    const graceUntil = (row.updatedAt?.getTime() ?? 0) + 30_000;
    if (Date.now() > graceUntil) {
      // Reuse after grace: revoke the whole family.
      await RefreshTokenModel.updateMany({ userId: row.userId, deviceId: row.deviceId }, { $set: { revokedAt: new Date() } });
      throw Errors.unauthorized();
    }
  }
  if (row.deviceId && meta.deviceId && row.deviceId !== meta.deviceId) {
    await RefreshTokenModel.updateOne({ _id: row._id }, { $set: { revokedAt: new Date() } });
    await AuditLogModel.create({ actorType: 'system', action: 'session.device_mismatch', subjectType: 'user', subjectId: row.userId, deviceId: meta.deviceId, before: { boundTo: row.deviceId } });
    throw Errors.unauthorized();
  }
  const user = await UserModel.findById(row.userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();

  const access = signAccessToken({ sub: user._id, tier: user.trust?.tier ?? 'normal' });
  const next = newRefreshToken();
  const created = await RefreshTokenModel.create({
    userId: user._id, deviceId: row.deviceId ?? meta.deviceId ?? null, tokenHash: next.hash,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  if (!row.supersededBy) {
    await RefreshTokenModel.updateOne({ _id: row._id }, { $set: { supersededBy: created._id.toString() } });
  }
  return { accessToken: access.token, refreshToken: next.token, expiresAt: access.expiresAt };
}

export async function signOut(userId: string, deviceId?: string) {
  const filter = deviceId ? { userId, deviceId, revokedAt: null } : { userId, revokedAt: null };
  await RefreshTokenModel.updateMany(filter, { $set: { revokedAt: new Date() } });
  return { ok: true };
}

export async function sendEmailOtp(userId: string, meta: Meta) {
  const user = await UserModel.findById(userId);
  if (!user) throw Errors.unauthorized();
  if (user.emailVerifiedAt) throw new ApiError(409, 'EMAIL_ALREADY_VERIFIED', 'Your email is already verified.');
  if (!isChannelUsable('email')) throw new ApiError(503, 'EMAIL_UNAVAILABLE', 'Email is not available right now.');
  return createChallenge({ channel: 'email', purpose: 'verify_email', target: user.email, userId, deviceId: meta.deviceId, ip: meta.ip });
}

export async function sendPhoneOtp(userId: string, meta: Meta) {
  const user = await UserModel.findById(userId);
  if (!user) throw Errors.unauthorized();
  if (user.phoneVerifiedAt) throw new ApiError(409, 'PHONE_ALREADY_VERIFIED', 'Your number is already verified.');
  if (!isChannelDeliverable('sms')) throw new ApiError(503, 'SMS_UNAVAILABLE', 'Text messages are not available yet. You can verify your number later.');
  return createChallenge({ channel: 'sms', purpose: 'verify_phone', target: user.phone, userId, deviceId: meta.deviceId, ip: meta.ip });
}
