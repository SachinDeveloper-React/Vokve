import { z } from 'zod';
import { ApiError, Errors } from '../../lib/errors.js';
import { DeviceDayModel } from '../activity/models.js';
import { rollupDay } from '../activity/rollup.service.js';
import { DeviceModel } from '../devices/models.js';
import { UserModel } from '../identity/models.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * Which of a member's phones a day is allowed to count (D-88, RULES A27).
 *
 * The scoring already settles the ordinary case by itself: each minute goes
 * to the phone that counted the most in it and the others' steps for that
 * minute are dropped (D-53), so a walk two phones both saw counts once and
 * walks on different phones at different times both count. What it cannot
 * settle is whose leg the phone was on — an install lent to somebody, a
 * watch left running on a treadmill, two accounts sharing one handset. That
 * is a judgement, so it is an operator's to make, and this is where they
 * make it.
 *
 * Two rules hold it honest:
 *
 *   - **A day keeps at least one phone.** Rejecting all of them would leave
 *     a scored day with no evidence behind it, and the rollup would have
 *     nothing to re-score from. "Pick one, reject the rest" is the whole
 *     shape of the decision, so the last one standing cannot be taken away.
 *   - **It is never one-way.** The set is replaced on every call, so lifting
 *     a rejection is the same call with that id left out, and the day is
 *     re-scored either way. Every call leaves an audit row naming the actor.
 */

export const rejectionBody = z.object({
  /**
   * The exact set of this day's installs that must not count. Replaces
   * whatever was rejected before, so `[]` lifts every rejection.
   */
  reject: z.array(z.string().min(1).max(128)).max(50),
  /** Why, in the operator's words. Kept on the audit row and on each device-day. */
  note: z.string().trim().max(300).optional(),
});
export type RejectionBody = z.infer<typeof rejectionBody>;

export async function setDayRejections(actor: string, userId: string, localDay: string, body: RejectionBody) {
  const user = await UserModel.findById(userId, { _id: 1 }).lean();
  if (!user) throw Errors.notFound('That member');

  const days = await DeviceDayModel.find({ userId, localDay }, { deviceId: 1, rejected: 1 }).lean();
  if (days.length === 0) throw Errors.notFound('Any phone data for that day');

  const present = new Set(days.map(row => row.deviceId));
  const reject = [...new Set(body.reject)];
  const unknown = reject.filter(id => !present.has(id));
  if (unknown.length > 0) {
    throw new ApiError(422, 'DEVICE_NOT_ON_DAY', 'Those phones did not send this day.', { deviceIds: unknown });
  }
  if (reject.length >= days.length) {
    throw new ApiError(
      422,
      'LAST_DEVICE_ON_DAY',
      'A day has to keep at least one phone. Leave the one it should count out of the list.',
      { devices: days.length, rejecting: reject.length },
    );
  }

  const before = days.filter(row => row.rejected).map(row => row.deviceId).sort();
  const rejecting = new Set(reject);
  const now = new Date();

  await Promise.all(
    days.map(row =>
      DeviceDayModel.updateOne(
        { _id: `${row.deviceId}:${localDay}` },
        rejecting.has(row.deviceId)
          ? { $set: { rejected: { at: now, by: actor, note: body.note ?? null } } }
          : { $unset: { rejected: 1 } },
      ),
    ),
  );

  // The day is only true once it has been judged again without them.
  const result = await rollupDay(userId, localDay);

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'activity.devices_rejected',
    subjectType: 'user',
    subjectId: userId,
    before: { localDay, rejected: before },
    after: { rejected: reject.sort(), note: body.note ?? null, steps: result.day.steps, verifiedSteps: result.day.verifiedSteps },
  });

  return { localDay, ...(await dayRejections(userId, localDay)), day: result.day };
}

/** Which of a day's phones are rejected, and by whom — what a screen draws. */
export async function dayRejections(userId: string, localDay: string) {
  const [days, devices] = await Promise.all([
    DeviceDayModel.find({ userId, localDay }, { deviceId: 1, rejected: 1 }).lean(),
    DeviceModel.find({ userId }, { info: 1 }).lean(),
  ]);
  const nameOf = new Map(
    devices.map(device => [
      device._id,
      [device.info?.brand, device.info?.model].filter(Boolean).join(' ').trim() || 'Phone',
    ]),
  );
  return {
    devices: days.map(row => ({
      deviceId: row.deviceId,
      name: nameOf.get(row.deviceId) ?? 'Phone',
      rejected: Boolean(row.rejected),
      rejectedAt: row.rejected?.at?.toISOString() ?? null,
      rejectedBy: row.rejected?.by ?? null,
      note: row.rejected?.note ?? null,
    })),
  };
}
