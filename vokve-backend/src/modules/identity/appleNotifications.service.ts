import type { AppleServerEvent } from '../../lib/appleIdentity.js';
import { logger } from '../../lib/logger.js';
import { clearPushToken, stopCounting } from '../devices/service.js';
import { notify } from '../notifications/service.js';
import { AuditLogModel } from '../platform/models.js';
import { hasPassword } from './password.js';
import { RefreshTokenModel, UserModel, type UserDoc } from './models.js';

/**
 * What Apple tells the server about a member's Apple ID (RULES O17).
 *
 * Four things can change on Apple's side without the member opening the app,
 * and each one arrives as a signed notification:
 *
 *  - `consent-revoked` — they stopped using Sign in with Apple for VOKVE.
 *    Every session Apple was the way into ends, on every phone; the account
 *    and its Apple ID stay connected, and Apple simply asks for consent
 *    again the next time they press the button.
 *  - `account-delete` — they deleted the Apple ID itself. It will never sign
 *    in again, so it comes off the account as well, and its sessions end.
 *  - `email-disabled` / `email-enabled` — Hide My Email stopped (or started
 *    again) forwarding to the relay address. Marked on the account while
 *    that relay address is still its email, so the app can say why mail
 *    is not arriving and ask for another address.
 *
 * Nothing here throws on a member this server does not know: Apple sends
 * for the whole app group, and an account deleted here is still an Apple
 * authorisation there until it is revoked.
 */
export async function handleAppleNotification(event: AppleServerEvent): Promise<string> {
  const user = await UserModel.findOne({ appleId: event.appleId });
  if (!user || user.deletedAt) {
    logger.info({ type: event.type }, 'apple.notification_no_account');
    return 'no_account';
  }

  switch (event.type) {
    case 'consent-revoked': {
      const ended = await endAppleSessions(user._id);
      await record(user, 'user.apple_consent_revoked', { sessionsEnded: ended });
      if (ended > 0) {
        await tell(user._id, 'Signed out of Sign in with Apple',
          `You stopped using Sign in with Apple for VOKVE, so ${ended === 1 ? 'the device' : `the ${ended} devices`} that signed in with Apple ${ended === 1 ? 'was' : 'were'} signed out. Your account is untouched — sign in with Apple again any time.`);
      }
      return 'sessions_ended';
    }

    case 'account-delete': {
      const ended = await endAppleSessions(user._id);
      user.set('appleId', undefined);
      await user.save();
      await record(user, 'user.apple_id_deleted', { sessionsEnded: ended });
      const strandedEmail = user.email.endsWith('@privaterelay.appleid.com');
      const wayIn = hasPassword(user) || Boolean(user.googleId) || Boolean(user.facebookId);
      await tell(user._id, 'Your Apple ID no longer signs in',
        wayIn
          ? 'The Apple ID on this account was deleted, so it no longer signs in to VOKVE. Your other sign-in still works.'
          : strandedEmail
            ? 'The Apple ID on this account was deleted, and with it the email address Apple gave us. Contact support from the app to get back into your account.'
            : 'The Apple ID on this account was deleted. Use Forgot password with your email to set a password and keep signing in.');
      return 'unlinked';
    }

    case 'email-disabled':
    case 'email-enabled': {
      // Only the address the account actually uses: a member who has since
      // changed to a real address is not affected by their old relay.
      if (!event.email || event.email !== user.email.toLowerCase()) return 'other_address';
      const off = event.type === 'email-disabled';
      user.emailForwardingOffAt = off ? event.at ?? new Date() : null;
      await user.save();
      await record(user, off ? 'user.apple_email_disabled' : 'user.apple_email_enabled', {});
      return off ? 'forwarding_off' : 'forwarding_on';
    }
  }
}

/**
 * Ends every session that began with Apple, the way signing out does: the
 * refresh tokens go, the phone stops counting, and it stops receiving this
 * account's notifications. Sessions begun any other way are left alone.
 */
async function endAppleSessions(userId: string): Promise<number> {
  const rows = await RefreshTokenModel.find({ userId, method: 'apple', revokedAt: null }, { deviceId: 1 }).lean();
  if (rows.length === 0) return 0;
  await RefreshTokenModel.updateMany({ userId, method: 'apple', revokedAt: null }, { $set: { revokedAt: new Date() } });
  const devices = [...new Set(rows.map(row => row.deviceId).filter((id): id is string => Boolean(id)))];
  for (const deviceId of devices) {
    await stopCounting(userId, { deviceId });
    await clearPushToken(userId, deviceId);
  }
  return Math.max(devices.length, 1);
}

async function record(user: UserDoc, action: string, after: Record<string, unknown>): Promise<void> {
  await AuditLogModel.create({ actorType: 'system', actorId: 'apple', action, subjectType: 'user', subjectId: user._id, after });
}

async function tell(userId: string, title: string, message: string): Promise<void> {
  try {
    await notify({ userId, topic: 'system', title, message, exemptFromQuietHours: true });
  } catch (error) {
    logger.warn({ err: error, userId }, 'apple.notify_failed');
  }
}
