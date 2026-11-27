import { AuditLogModel } from '../platform/models.js';
import { UserModel } from './models.js';

/**
 * Who a phone number belongs to (RULES O14).
 *
 * A number typed into a form proves nothing — sign-up takes one without a
 * code while email is the channel that delivers — so an *unverified*
 * number reserves nothing. It used to: the unique index held it for
 * whoever typed it first, and anybody could sign up with somebody else's
 * number and leave its owner unable to sign up, add or verify it, and so
 * unable to ever redeem (security audit 2026-11-27, M-1).
 *
 * The rule now: only a verified number blocks another account. A number
 * held unverified is released from that account when somebody else proves
 * it (Firebase, a code), or claims it at sign-up — and the release is
 * written to the audit log. Proof is final: once verified, nobody can take
 * it without the owner changing it.
 */

/** Whether another account holds this number *verified*. */
export async function phoneProvenElsewhere(phone: string, userId?: string | null): Promise<boolean> {
  return Boolean(await UserModel.exists({ phone, phoneVerifiedAt: { $ne: null }, ...(userId ? { _id: { $ne: userId } } : {}) }));
}

/**
 * Takes the number off every other account that holds it unverified, so
 * `userId` can have it. Returns how many let go.
 */
export async function releaseUnprovenPhone(phone: string, userId: string | null, reason: 'signup' | 'verified' | 'changed'): Promise<number> {
  const holders = await UserModel.find(
    { phone, phoneVerifiedAt: null, ...(userId ? { _id: { $ne: userId } } : {}) },
    { _id: 1 },
  ).lean();
  if (holders.length === 0) return 0;
  const ids = holders.map(holder => holder._id);
  await UserModel.updateMany({ _id: { $in: ids }, phone, phoneVerifiedAt: null }, { $unset: { phone: 1 } });
  await AuditLogModel.insertMany(ids.map(id => ({
    actorType: 'system', action: 'user.phone_released', subjectType: 'user', subjectId: id,
    before: { phone }, after: { claimedBy: userId, reason },
  })));
  return ids.length;
}
