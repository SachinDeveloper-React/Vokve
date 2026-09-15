import { getConfig } from '../../config/remote.js';
import { env } from '../../config/env.js';
import { Errors, ApiError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { generateOtp, hashOtp, maskTarget } from '../../lib/otp.js';
import { isEmailConfigured, sendOtpEmail, type OtpEmailPurpose } from '../../lib/mail.js';
import { isProduction } from '../../config/env.js';
import { verificationChallengeSchema, type VerificationChallenge } from '../../contracts/index.js';
import { OtpChallengeModel, type OtpPurpose } from './models.js';

interface CreateChallenge {
  channel: 'sms' | 'email';
  purpose: OtpPurpose;
  target: string;
  userId?: string | null;
  payload?: unknown;
  deviceId?: string;
  ip?: string;
  /** For resends: the challenge being replaced, to carry its resend count. */
  previous?: { _id: string; resends: number; resendAfter: Date; decoy?: boolean };
  /**
   * A decoy is a real challenge document whose code is never delivered. It
   * is what an unknown identifier gets from forgot-password or OTP login, so
   * the response — and every later error — is indistinguishable from a real
   * account's (RULES O9). The client can only ever fail it with OTP_INVALID.
   */
  decoy?: boolean;
}

/**
 * Creates and "sends" a code. Sending is a provider call in Phase 1 — until
 * MSG91 / Resend are wired (D-31) the code is logged and, with OTP_DEV_ECHO,
 * returned to the caller so the flow can be exercised end to end.
 */
export async function createChallenge(input: CreateChallenge): Promise<VerificationChallenge> {
  const { otp } = await getConfig();

  if (input.previous && input.previous.resendAfter > new Date()) {
    const wait = Math.ceil((input.previous.resendAfter.getTime() - Date.now()) / 1000);
    throw new ApiError(429, 'OTP_RESEND_TOO_SOON', `You can request a new code in ${wait} seconds.`, { retryAfterSeconds: wait });
  }
  const resends = (input.previous?.resends ?? 0) + (input.previous ? 1 : 0);
  if (resends > otp.maxResendsPerHour) {
    throw new ApiError(429, 'OTP_RESEND_LIMIT', 'Too many codes requested. Please try again in an hour.', { retryAfterSeconds: 3600 });
  }
  const sentToday = await OtpChallengeModel.countDocuments({ target: input.target, createdAt: { $gte: new Date(Date.now() - 86_400_000) } });
  if (sentToday >= otp.maxSendsPerDay) {
    throw new ApiError(429, 'OTP_DAILY_LIMIT', 'Daily code limit reached for this number or address. Try again tomorrow.', { retryAfterSeconds: 86_400 });
  }

  const id = newId('vrf');
  const code = generateOtp(otp.length);
  const now = Date.now();
  await OtpChallengeModel.create({
    _id: id,
    userId: input.userId ?? null,
    channel: input.channel,
    purpose: input.purpose,
    target: input.target,
    codeHash: hashOtp(code, id),
    resends,
    expiresAt: new Date(now + otp.ttlSeconds * 1000),
    resendAfter: new Date(now + otp.resendCooldownSeconds * 1000),
    payload: input.payload ?? null,
    deviceId: input.deviceId,
    ip: input.ip,
    decoy: input.decoy ?? input.previous?.decoy ?? false,
  });
  if (input.previous) {
    await OtpChallengeModel.updateOne({ _id: input.previous._id }, { $set: { consumedAt: new Date() } });
  }

  const isDecoy = input.decoy ?? input.previous?.decoy ?? false;
  if (!isDecoy) {
    await deliver(input.channel, input.target, code, input.purpose);
  }

  const challenge = verificationChallengeSchema.parse({
    verificationId: id,
    phone: input.channel === 'sms' ? input.target : '',
    channel: input.channel,
    target: maskTarget(input.target, input.channel),
    codeLength: otp.length,
    expiresInSeconds: otp.ttlSeconds,
    resendInSeconds: otp.resendCooldownSeconds,
  });
  // A decoy never echoes its code, even in dev — echoing it would make the
  // decoy verifiable, which is the one thing it must not be.
  return env.OTP_DEV_ECHO && !isDecoy ? { ...challenge, devCode: code } : { ...challenge, devCode: null };
}

/**
 * Whether a code sent on this channel can actually reach someone. Email is
 * live once SMTP is configured; SMS waits on a provider (D-31). In
 * development an undeliverable channel still "works" — the code is logged
 * and echoed — so the whole flow can be exercised; in production it is
 * refused rather than silently swallowed.
 */
export function isChannelDeliverable(channel: 'sms' | 'email'): boolean {
  if (channel === 'email') return isEmailConfigured();
  return Boolean(env.SMS_PROVIDER);
}

export function isChannelUsable(channel: 'sms' | 'email'): boolean {
  return isChannelDeliverable(channel) || !isProduction;
}

async function deliver(channel: 'sms' | 'email', target: string, code: string, purpose: OtpPurpose): Promise<void> {
  logger.info({ channel, target: maskTarget(target, channel), purpose, code: env.OTP_DEV_ECHO ? code : '******', deliverable: isChannelDeliverable(channel) }, 'otp.deliver');

  if (channel === 'email' && isEmailConfigured()) {
    const { otp } = await getConfig();
    try {
      await sendOtpEmail(target, code, purpose as OtpEmailPurpose, Math.round(otp.ttlSeconds / 60));
    } catch (error) {
      logger.error({ err: error, purpose }, 'mail.failed');
      throw new ApiError(503, 'EMAIL_UNAVAILABLE', 'We could not send the email right now. Please try again in a moment.');
    }
    return;
  }
  if (channel === 'sms' && env.SMS_PROVIDER) {
    // TODO(D-31): MSG91 / Twilio.
    return;
  }
  if (isProduction) {
    throw new ApiError(503, channel === 'sms' ? 'SMS_UNAVAILABLE' : 'EMAIL_UNAVAILABLE',
      channel === 'sms' ? 'Text messages are not available right now. Please use email.' : 'Email is not available right now.');
  }
}

/**
 * Checks a code against its challenge. A wrong code leaves the challenge
 * alive (attempts +1) so the user stays on the screen (RULES O6). Returns the
 * consumed challenge; the caller decides what passing it unlocks.
 */
export async function consumeChallenge(verificationId: string, code: string, expectedPurposes?: OtpPurpose[]) {
  const { otp } = await getConfig();
  const challenge = await OtpChallengeModel.findById(verificationId);
  if (!challenge || challenge.consumedAt) {
    throw new ApiError(404, 'OTP_NOT_FOUND', 'This code is no longer valid. Request a new one.');
  }
  if (expectedPurposes && !expectedPurposes.includes(challenge.purpose as OtpPurpose)) {
    throw new ApiError(400, 'OTP_WRONG_PURPOSE', 'This code cannot be used here.');
  }
  if (challenge.expiresAt < new Date()) {
    throw new ApiError(410, 'OTP_EXPIRED', 'This code has expired. Request a new one.');
  }
  if (challenge.attempts >= otp.maxAttempts) {
    throw new ApiError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Too many wrong attempts. Request a new code.', { attemptsRemaining: 0 });
  }
  if (hashOtp(code, challenge._id) !== challenge.codeHash) {
    challenge.attempts += 1;
    await challenge.save();
    throw new ApiError(422, 'OTP_INVALID', 'That code is not right. Check it and try again.', {
      attemptsRemaining: otp.maxAttempts - challenge.attempts,
    });
  }
  challenge.consumedAt = new Date();
  await challenge.save();
  return challenge;
}

export async function findLiveChallenge(verificationId: string) {
  const challenge = await OtpChallengeModel.findById(verificationId);
  if (!challenge || challenge.consumedAt) throw Errors.notFound('That verification');
  return challenge;
}
