import { getKV } from '../../db/redis.js';
import { logger } from '../../lib/logger.js';
import { heartbeatKey } from '../../middleware/device.js';
import { DeviceModel } from '../devices/models.js';
import { stopCounting } from '../devices/service.js';
import { notify } from '../notifications/service.js';
import { AuditLogModel } from '../platform/models.js';
import { signInWaysOf } from './linking.service.js';
import { RefreshTokenModel, type UserDoc } from './models.js';

/**
 * An account whose email nobody had proved, claimed by whoever just proved
 * it (security audit 2026-11-27, H-1).
 *
 * An account can exist with an address its maker never showed they read: a
 * Facebook sign-up (Facebook does not say it checked the address, O18), or
 * — once sign-up proves the phone first — any sign-up at all. When the
 * address's real owner later proves it — Google or Apple with the same
 * verified email, a reset code, a sign-in code — the server used to hand
 * them that account *and keep every way in its maker had*: the maker went
 * on signing in with Facebook to an account the owner was now using.
 *
 * Proof of the address decides whose the account is, the way Firebase Auth
 * treats an unverified account when a trusted provider proves its email.
 * Everything that got in without proving it goes: the password, every
 * provider id, the phone, every session and every registered phone. The
 * member is told, so somebody who simply never confirmed their own address
 * knows to connect Facebook again.
 *
 * Changes the document in place; the caller sets what proved it and saves.
 */
export async function claimUnprovenAccount(
  user: UserDoc,
  provedBy: 'google' | 'apple' | 'password_reset' | 'email_code',
  meta: { deviceId?: string } = {},
): Promise<void> {
  if (user.emailVerifiedAt) return;
  const before = {
    ways: signInWaysOf(user),
    phone: user.phone ?? null,
    phoneVerified: Boolean(user.phoneVerifiedAt),
  };
  const now = new Date();

  // A string bcrypt never matches, as a provider account's is.
  user.passwordHash = `claimed:${user._id}:${now.getTime()}`;
  user.set('googleId', undefined);
  user.set('appleId', undefined);
  user.set('facebookId', undefined);
  user.set('phone', undefined);
  user.phoneVerifiedAt = null;
  user.emailVerifiedAt = now;

  await RefreshTokenModel.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: now } });
  const devices = await DeviceModel.find({ userId: user._id, revokedAt: null }, { _id: 1 }).lean();
  if (devices.length > 0) {
    await DeviceModel.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: now, 'push.token': null } });
    // The five-minute "checked a moment ago" marks go too, or an access
    // token still running would ride them past the device gate.
    await Promise.all(devices.map(device => getKV().del(heartbeatKey(device._id, user._id))));
    await stopCounting(user._id, {}, now);
  }

  await AuditLogModel.create({
    actorType: 'system', action: 'user.unproven_account_claimed', subjectType: 'user', subjectId: user._id,
    deviceId: meta.deviceId, before, after: { provedBy },
  });
  logger.warn({ userId: user._id, provedBy, removed: before.ways }, 'identity.unproven_account_claimed');

  if (before.ways.length > 0 || before.phone) {
    try {
      await notify({
        userId: user._id,
        topic: 'system',
        title: 'Your account is secured to your email',
        message:
          'This account’s email had never been confirmed, so the sign-in methods and phone number added before you confirmed it were removed. ' +
          'If they were yours, add them again under Account → Security.',
        exemptFromQuietHours: true,
      });
    } catch (error) {
      logger.warn({ err: error, userId: user._id }, 'identity.claim_notify_failed');
    }
  }
}
