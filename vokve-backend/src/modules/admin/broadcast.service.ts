import { z } from 'zod';
import { notificationPreferenceSchema, notificationTopicSchema } from '../../contracts/index.js';
import { Errors } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { DeviceModel } from '../devices/models.js';
import { UserModel } from '../identity/models.js';
import { notify } from '../notifications/service.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * Telling more than one member something (RULES O-series consent).
 *
 * The one admin verb that cannot be taken back: a message in ten thousand
 * notification centres is ten thousand people's screens. So it is built to
 * be hard to do by accident and easy to do deliberately.
 *
 *   - **The count comes first.** `preview` answers "how many" without
 *     sending anything, and the send refuses a segment whose size has
 *     changed by more than a tenth since the preview was taken — a filter
 *     typed wrong is caught by the number it returns, not by the apology
 *     afterwards.
 *   - **`confirm` is a separate field**, and the reason is required.
 *   - **Consent still decides the push.** Every message goes through
 *     `notify()` like any job, so a member who switched that category off
 *     gets the feed row and no push. There is no bypass, and the result
 *     reports how many that was.
 *   - **A ceiling.** One call will not send more than `MAX_RECIPIENTS`:
 *     past that it is a campaign, and a campaign is a decision somebody
 *     makes with a plan rather than a form.
 */

const MAX_RECIPIENTS = 5000;
const BATCH = 50;

export const segmentSchema = z
  .object({
    tier: z.enum(['trusted', 'normal', 'watch', 'restricted', 'banned']).optional(),
    platform: z.enum(['ios', 'android']).optional(),
    /** Seen by the heartbeat inside this many days (RULES DV1). */
    seenWithinDays: z.coerce.number().int().min(1).max(365).optional(),
    /** And the other way: quiet for at least this long — the win-back segment. */
    notSeenForDays: z.coerce.number().int().min(1).max(365).optional(),
    /** Only accounts with a phone that could show a push at all. */
    pushableOnly: z.coerce.boolean().optional(),
  })
  .strict();
export type Segment = z.infer<typeof segmentSchema>;

const DAY_MS = 86_400_000;

/**
 * Who the segment is, as a list of ids.
 *
 * Deliberately resolved to ids rather than streamed: the count is the thing
 * an operator checks before sending, and a count that came from a different
 * query than the send did is not a check.
 */
async function resolve(segment: Segment, limit = MAX_RECIPIENTS): Promise<string[]> {
  const filter: Record<string, unknown> = { deletedAt: null };
  if (segment.tier) filter['trust.tier'] = segment.tier;

  const deviceFilter: Record<string, unknown> = { revokedAt: null };
  let needsDevices = false;
  if (segment.platform) {
    deviceFilter.platform = segment.platform;
    needsDevices = true;
  }
  if (segment.pushableOnly) {
    deviceFilter['push.token'] = { $type: 'string' };
    deviceFilter['push.invalidAt'] = null;
    needsDevices = true;
  }
  if (segment.seenWithinDays) {
    deviceFilter.lastSeenAt = { $gte: new Date(Date.now() - segment.seenWithinDays * DAY_MS) };
    needsDevices = true;
  }
  if (needsDevices) {
    const ids = await DeviceModel.distinct('userId', deviceFilter);
    filter._id = { $in: ids };
  }

  let users = await UserModel.find(filter, { _id: 1 }).limit(limit + 1).lean();

  if (segment.notSeenForDays) {
    // "Quiet" is the absence of a recent heartbeat, which cannot be asked of
    // the user row: the accounts seen lately are subtracted instead.
    const since = new Date(Date.now() - segment.notSeenForDays * DAY_MS);
    const seen = new Set(await DeviceModel.distinct('userId', { revokedAt: null, lastSeenAt: { $gte: since } }));
    users = users.filter(user => !seen.has(user._id));
  }

  return users.map(user => user._id);
}

export async function previewBroadcast(segment: Segment) {
  const ids = await resolve(segment);
  return {
    matched: Math.min(ids.length, MAX_RECIPIENTS),
    /** True when the segment is bigger than one call will send. */
    overflow: ids.length > MAX_RECIPIENTS,
    ceiling: MAX_RECIPIENTS,
    sample: ids.slice(0, 5),
  };
}

export const broadcastBody = z
  .object({
    segment: segmentSchema.default({}),
    topic: notificationTopicSchema,
    /**
     * Which of the eight consent switches governs this send (RULES P14).
     *
     * Left out, the topic decides, as it does for every job. Named, it
     * overrides — which is the only way `offers` ever means anything: no
     * topic maps to it, so a promotion sent on `system` was governed by
     * `announcements`, and a member who had switched offers off was pushed
     * it anyway. The switch existed on their screen and silenced nothing.
     */
    preference: notificationPreferenceSchema.optional(),
    title: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(500),
    /** Quiet hours hold a push rather than dropping it; nothing bypasses them here. */
    suppressPush: z.boolean().default(false),
    /** What the preview said. A segment that has moved a lot since is refused. */
    expected: z.number().int().min(0).max(MAX_RECIPIENTS),
    confirm: z.literal(true),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export type BroadcastBody = z.infer<typeof broadcastBody>;

export async function sendBroadcast(actor: string, body: BroadcastBody) {
  const ids = await resolve(body.segment);
  const recipients = ids.slice(0, MAX_RECIPIENTS);

  // A tenth either way. The segment is live — somebody signs up while the
  // form is open — but a filter that has changed shape is not the one the
  // operator read a number for.
  const drift = Math.abs(recipients.length - body.expected);
  if (drift > Math.max(5, Math.ceil(body.expected * 0.1))) {
    throw Errors.conflict(
      'SEGMENT_MOVED',
      `That segment now matches ${recipients.length} members, not ${body.expected}. Take the count again and read it before sending.`,
      { expected: body.expected, matched: recipients.length },
    );
  }

  const started = Date.now();
  const tally = { created: 0, duplicate: 0, suppressed: 0, pushed: 0, deferred: 0, notPushed: 0 };
  // One dedupe key for the whole send, so a retry of this call cannot write a
  // second row in anybody's feed.
  const stamp = `admin_broadcast:${started}`;

  for (let index = 0; index < recipients.length; index += BATCH) {
    const batch = recipients.slice(index, index + BATCH);
    const results = await Promise.all(
      batch.map(userId =>
        notify({
          userId,
          topic: body.topic,
          preference: body.preference,
          title: body.title,
          message: body.message,
          suppressPush: body.suppressPush,
          dedupeKey: stamp,
        }).catch(error => {
          logger.error({ err: error, userId }, 'admin.broadcast_failed');
          return null;
        }),
      ),
    );
    for (const result of results) {
      if (!result) continue;
      if (result.status === 'created') tally.created += 1;
      if (result.status === 'duplicate') tally.duplicate += 1;
      if (result.status === 'suppressed') tally.suppressed += 1;
      if (result.push === 'sent') tally.pushed += 1;
      else if (result.push === 'deferred') tally.deferred += 1;
      else tally.notPushed += 1;
    }
  }

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'notifications.broadcast',
    subjectType: 'broadcast',
    subjectId: stamp,
    before: null,
    after: {
      segment: body.segment,
      topic: body.topic,
      preference: body.preference ?? null,
      title: body.title,
      message: body.message,
      recipients: recipients.length,
      ...tally,
      reason: body.reason,
    },
  });

  logger.info({ actor, recipients: recipients.length, ...tally }, 'admin.broadcast');
  return {
    id: stamp,
    recipients: recipients.length,
    ...tally,
    tookMs: Date.now() - started,
  };
}
