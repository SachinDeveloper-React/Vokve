import { getConfig } from '../../config/remote.js';
import { localDayOf } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';
import { isPushConfigured, sendPush } from '../../lib/push.js';
import { UserModel } from '../identity/models.js';
import { DeviceModel } from '../devices/models.js';
import { notify } from '../notifications/service.js';

/**
 * The upload floor (RULES A28, BACKEND §9).
 *
 * Steps are counted by a native service that survives the app being closed,
 * but they only ever *leave* the phone from the foreground: the periodic
 * sync asks for an active app, and the other triggers are a foreground
 * transition and a network coming back while the app runs. So an install
 * that is faithfully counting can be completely silent, and every day it
 * stays silent past `activity.maxAgeDays` is a day of real walking the
 * server will refuse for good.
 *
 * This job is the server asking. For each install that is signed in, can be
 * pushed, and whose newest accepted snapshot has gone stale, it sends a
 * **silent** data push the app's background handler answers by syncing — no
 * tray entry, no feed row, and quiet hours do not apply, because nothing
 * rings. A push that goes undelivered (force-stopped app, no network, FCM
 * not configured) is why there is a second rung: after
 * `syncNudge.remindAfterHours` the member is told in as many words, at most
 * once a day, through the ordinary notification path where quiet hours and
 * the activity switch do apply.
 *
 * Two installs of one account that are both stale get one silent push each —
 * each has its own days to send — but the member is only told once: the
 * message is about the account, and `dedupeKey` is what makes that true.
 */
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface NudgeResult {
  /** Installs the silent "sync now" push went to. */
  pushed: number;
  /** Members told in as many words. */
  reminded: number;
  /** Installs whose push the provider would not take. */
  failed: number;
}

const NOTHING: NudgeResult = { pushed: 0, reminded: 0, failed: 0 };

export async function nudgeStaleSyncs(now = new Date()): Promise<NudgeResult> {
  const config = await getConfig();
  const nudge = config.activity.syncNudge;
  if (!nudge.enabled) return NOTHING;
  // The whole job is a push: with no provider wired there is nothing it can
  // do but spend its own cooldowns, and the member it is for is not opening
  // the app to read a feed row either.
  if (!isPushConfigured()) return NOTHING;

  const stale = new Date(now.getTime() - nudge.silentAfterHours * HOUR_MS);
  const cooled = new Date(now.getTime() - nudge.cooldownHours * HOUR_MS);
  const floor = new Date(now.getTime() - nudge.giveUpAfterDays * DAY_MS);

  const devices = await DeviceModel.find(
    {
      revokedAt: null,
      'push.token': { $type: 'string' },
      'push.invalidAt': null,
      // Signed in on this install right now (D-56): a signed-out phone has
      // no days of this account's to send, and the app would refuse to send
      // them if it were woken.
      counting: { $elemMatch: { to: null } },
      $and: [
        { $or: [{ 'stepSync.uploadedAt': null }, { 'stepSync.uploadedAt': { $lte: stale } }] },
        { $or: [{ 'stepSync.nudgedAt': null }, { 'stepSync.nudgedAt': { $lte: cooled } }] },
        // Given up on: silent for longer than the job will chase. An install
        // that has never uploaded is measured from when it was registered.
        { $or: [{ 'stepSync.uploadedAt': { $gte: floor } }, { 'stepSync.uploadedAt': null, firstSeenAt: { $gte: floor } }] },
      ],
    },
    { userId: 1, 'push.token': 1, stepSync: 1, firstSeenAt: 1 },
  )
    // Nulls first: an install whose very first sync never happened is the one
    // with everything still to lose.
    .sort({ 'stepSync.uploadedAt': 1 })
    .limit(nudge.batch)
    .lean();

  if (devices.length === 0) return NOTHING;

  const result: NudgeResult = { pushed: 0, reminded: 0, failed: 0 };
  const told = new Set<string>();

  for (const device of devices) {
    const token = device.push?.token;
    if (!token) continue;

    // Stamped before the send, not after: a provider that times out must not
    // leave this install to be pushed again on the next tick.
    await DeviceModel.updateOne({ _id: device._id }, { $set: { 'stepSync.nudgedAt': now } });

    const push = await sendPush([token], { silent: true, data: { type: 'activity_sync' } });
    if (push.invalid.length > 0) {
      await DeviceModel.updateOne({ _id: device._id }, { $set: { 'push.invalidAt': now } });
    }
    if (push.sent > 0) result.pushed += 1;
    else result.failed += 1;

    const silentSince = device.stepSync?.uploadedAt ?? device.firstSeenAt ?? now;
    const hoursQuiet = (now.getTime() - silentSince.getTime()) / HOUR_MS;
    if (hoursQuiet < nudge.remindAfterHours || told.has(device.userId)) continue;

    const remindedAt = device.stepSync?.remindedAt;
    if (remindedAt && now.getTime() - remindedAt.getTime() < DAY_MS) continue;

    told.add(device.userId);
    const user = await UserModel.findById(device.userId, { timezone: 1 }).lean();
    const sent = await notify({
      userId: device.userId,
      topic: 'steps',
      title: 'Your steps are not reaching us',
      message: `We have had nothing from your phone for ${Math.floor(hoursQuiet / 24)} days. Open Vokve to send what you have walked — after ${config.activity.maxAgeDays} days a day can no longer be counted.`,
      // One a day per account, whichever install triggered it.
      dedupeKey: `steps.not_syncing:${localDayOf(now, user?.timezone ?? config.locale.timezone)}`,
      now,
    });
    if (sent.status === 'created') result.reminded += 1;
    // Stamped across the account, not just the install that triggered it:
    // the message was about the account, so the restraint has to be too, or
    // the member's second quiet phone would tell them the same thing again
    // on the next tick.
    await DeviceModel.updateMany({ userId: device.userId }, { $set: { 'stepSync.remindedAt': now } });
  }

  logger.info({ ...result, looked: devices.length }, 'activity.sync_nudged');
  return result;
}
