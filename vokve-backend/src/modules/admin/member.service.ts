import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { isValidTimeZone, localDayOf } from '../../lib/dates.js';
import { Errors } from '../../lib/errors.js';
import { isPushConfigured, sendPush } from '../../lib/push.js';
import { notificationTopicSchema } from '../../contracts/index.js';
import { getStepGoal } from '../activity/goal.service.js';
import { DeviceModel } from '../devices/models.js';
import { NotificationPreferencesModel, UserModel, UserSettingsModel } from '../identity/models.js';
import { NotificationModel } from '../notifications/models.js';
import { notify, quietHoursDelayMs } from '../notifications/service.js';
import { AuditLogModel } from '../platform/models.js';
import { DevicePermissionsModel } from '../telemetry/models.js';
import type { StoredPermission } from '../telemetry/service.js';

/**
 * One member's own settings — the half of the step pipeline that is theirs
 * rather than everybody's (RULES P15, A28, Y-series consent).
 *
 * The config page answers "what do we do with everyone's steps"; this
 * answers "and what does that mean for this member": the goal they set, the
 * ceiling their trust tier puts on a day, when each of their phones last
 * reported, whether anything can be said to them at all — and the two
 * things support actually needs to *do*, which are telling a phone to sync
 * now and telling the member something in as many words.
 *
 * What may be written here is deliberately narrow:
 *
 *   - **The step goal and the timezone**, because both are things a member
 *     can get into a state they cannot get out of (a goal saved on a phone
 *     that then broke; a zone set on a flight), and both are visible to
 *     them afterwards.
 *   - **A notification switch may be turned off, never on.** "Stop sending
 *     me this" is a support request; "start sending them this" is consent,
 *     and consent is not an operator's to give. The member turns it back on
 *     in the app, where they can see what they are agreeing to.
 *
 * Everything else about the account stays read-only, as the rest of the
 * operator surface is.
 */

const HOUR_MS = 3_600_000;
const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

/** The schema's own defaults, without writing a document for a member who has never opened the screen. */
function defaultPreferences(userId: string) {
  return new NotificationPreferencesModel({ _id: userId }).toObject() as {
    categories: Record<string, boolean>;
    quietHours: { enabled: boolean; start: string; end: string };
    sms: boolean;
    email: boolean;
  };
}

const permissionState = (rows: StoredPermission[] | undefined, key: string): string | null =>
  rows?.find(row => row.key === key)?.state ?? null;

/** Has the member moved any of these away from what they were created with? */
function differsFromDefault(
  preferences: ReturnType<typeof defaultPreferences>,
  defaults: ReturnType<typeof defaultPreferences>,
): boolean {
  for (const [key, value] of Object.entries(defaults.categories)) {
    if (preferences.categories?.[key] !== value) return true;
  }
  const quiet = preferences.quietHours ?? defaults.quietHours;
  return (
    quiet.enabled !== defaults.quietHours.enabled ||
    quiet.start !== defaults.quietHours.start ||
    quiet.end !== defaults.quietHours.end ||
    preferences.sms !== defaults.sms ||
    preferences.email !== defaults.email
  );
}

// ─── What this member's steps are subject to ───────────────────────────────

export async function memberConfig(userId: string) {
  const user = await UserModel.findById(userId)
    .select({ name: 1, email: 1, phone: 1, timezone: 1, trust: 1, flags: 1, activityLevel: 1, dateOfBirth: 1 })
    .lean();
  if (!user) throw Errors.notFound('That member');

  const timezone = user.timezone || 'Asia/Kolkata';
  const tier = (user.trust?.tier ?? 'normal') as keyof Awaited<ReturnType<typeof getConfig>>['trust']['stepCaps'];
  const now = new Date();

  const [config, goal, settings, devices, permissions, preferencesDoc, counts] = await Promise.all([
    getConfig(),
    // The same read the app's goal screen makes, so the figure here and the
    // figure they see are the same figure.
    getStepGoal(userId, timezone).catch(() => null),
    UserSettingsModel.findById(userId, { dailyStepGoal: 1, stepGoalSetAt: 1, units: 1 }).lean(),
    DeviceModel.find({ userId })
      .select({ platform: 1, info: 1, app: 1, push: 1, stepSync: 1, counting: 1, revokedAt: 1, lastSeenAt: 1 })
      .sort({ lastSeenAt: -1 })
      .lean(),
    DevicePermissionsModel.find({ userId }, { deviceId: 1, permissions: 1 }).lean(),
    NotificationPreferencesModel.findById(userId).lean(),
    NotificationModel.aggregate<{ _id: null; total: number; unread: number; lastAt: Date }>([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: 1 }, unread: { $sum: { $cond: ['$read', 0, 1] } }, lastAt: { $max: '$createdAt' } } },
    ]),
  ]);

  const preferences = (preferencesDoc as ReturnType<typeof defaultPreferences> | null) ?? defaultPreferences(userId);
  const permissionOf = new Map(permissions.map(row => [row.deviceId, row.permissions as StoredPermission[] | undefined]));
  const quietDelay = quietHoursDelayMs(now, timezone, preferences.quietHours);

  const installs = devices.map(device => {
    const allowed = permissionOf.get(device._id);
    const notifications = permissionState(allowed, 'notifications');
    const signedIn = (device.counting ?? []).some(period => period.to === null);
    const uploadedAt = device.stepSync?.uploadedAt ?? null;
    return {
      deviceId: device._id,
      platform: device.platform,
      label: [device.info?.brand, device.info?.model].filter(Boolean).join(' ') || device._id,
      appVersion: device.app?.version ?? null,
      revoked: Boolean(device.revokedAt),
      /** Steps are only counted while the account is signed in here (D-56). */
      signedIn,
      lastSeenAt: iso(device.lastSeenAt),
      stepSync: {
        uploadedAt: iso(uploadedAt),
        nudgedAt: iso(device.stepSync?.nudgedAt),
        remindedAt: iso(device.stepSync?.remindedAt),
        /** Hours since the newest accepted snapshot — what the nudge job measures. */
        quietHours: uploadedAt ? Math.floor((now.getTime() - uploadedAt.getTime()) / HOUR_MS) : null,
        /** Whether the job would push this install on its next tick. */
        dueForNudge:
          signedIn &&
          !device.revokedAt &&
          Boolean(device.push?.token) &&
          (!uploadedAt || now.getTime() - uploadedAt.getTime() >= config.activity.syncNudge.silentAfterHours * HOUR_MS),
      },
      push: {
        hasToken: Boolean(device.push?.token),
        invalidAt: iso(device.push?.invalidAt),
        /** The OS's answer, which decides whether anything may be *shown* here (A28b). */
        notifications,
        /** No token, or the OS refusing: either way nothing can be said on this phone. */
        canShow: Boolean(device.push?.token) && !device.push?.invalidAt && notifications !== 'denied' && notifications !== 'blocked',
      },
      permissions: {
        activityRecognition: permissionState(allowed, 'activityRecognition'),
        notifications,
        healthConnectReadSteps: permissionState(allowed, 'healthConnectReadSteps'),
        batteryUnrestricted: permissionState(allowed, 'batteryUnrestricted'),
      },
    };
  });

  const total = counts[0];
  return {
    account: {
      id: user._id,
      name: user.name ?? '',
      email: user.email,
      phone: user.phone,
      timezone,
      /** The day their steps are landing in right now, in their own zone. */
      localDay: localDayOf(now, timezone),
      trust: { score: user.trust?.score ?? null, tier: user.trust?.tier ?? null },
      frozen: user.flags?.frozen ?? false,
      activityLevel: user.activityLevel ?? null,
    },
    steps: {
      goal: {
        current: settings?.dailyStepGoal ?? goal?.goal ?? 10_000,
        /** Null while it is the one every account starts on — they have not chosen (D-55). */
        setAt: iso(settings?.stepGoalSetAt),
        recommended: goal?.recommended ?? null,
        basedOn: goal?.basedOn ?? null,
        min: config.activity.goal.min,
        max: config.activity.goal.max,
        increment: config.activity.goal.increment,
      },
      /** What their tier lets through, and what it would be worth if minting were on. */
      ceiling: {
        tier: user.trust?.tier ?? 'normal',
        dailySteps: config.trust.stepCaps[tier] ?? config.trust.stepCaps.normal,
        holdHours: config.trust.holdHours[tier as keyof typeof config.trust.holdHours] ?? null,
        trustShadow: config.trust.shadow,
      },
      coins: {
        enabled: config.coins.steps.enabled,
        per1000: Math.round((1000 / config.coins.steps.unitSteps) * config.coins.steps.coinsPerUnit * 1000) / 1000,
        sourceCap: config.coins.sourceCaps.steps,
        dailyCap: config.coins.dailyCap,
      },
      upload: {
        maxAgeDays: config.activity.maxAgeDays,
        nudge: config.activity.syncNudge,
        /** The newest accepted snapshot from any of their phones. */
        lastUploadAt: iso(
          devices.map(device => device.stepSync?.uploadedAt).filter((at): at is Date => Boolean(at)).sort((a, b) => b.getTime() - a.getTime())[0],
        ),
      },
      installs,
      signedIn: installs.filter(install => install.signedIn && !install.revoked).length,
    },
    notifications: {
      preferences: {
        categories: preferences.categories,
        quietHours: preferences.quietHours,
        sms: preferences.sms,
        email: preferences.email,
        /**
         * Whether any switch differs from the ones every account is created
         * with. Sign-up writes the document, so its existence says nothing —
         * what matters is whether the member has ever moved one.
         */
        changed: differsFromDefault(preferences, defaultPreferences(userId)),
      },
      /** Right now, in their zone: a push would be held this long. */
      quiet: { now: quietDelay > 0, endsInMinutes: quietDelay > 0 ? Math.round(quietDelay / 60_000) : 0 },
      /** How many of their phones could actually show one. */
      reachable: {
        installs: installs.filter(install => !install.revoked).length,
        withToken: installs.filter(install => install.push.hasToken && !install.revoked).length,
        canShow: installs.filter(install => install.push.canShow && !install.revoked).length,
        pushConfigured: isPushConfigured(),
      },
      feed: { total: total?.total ?? 0, unread: total?.unread ?? 0, lastAt: iso(total?.lastAt) },
    },
  };
}

// ─── Changing the little that may be changed ───────────────────────────────

export const memberConfigBody = z
  .object({
    dailyStepGoal: z.number().int().min(100).max(100_000).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    /**
     * Switches to turn **off**. There is no way to turn one on from here on
     * purpose: silencing a member who asked to be silenced is support;
     * speaking to one who asked not to be is not.
     */
    silence: z
      .array(z.enum(['activity', 'coins', 'challenges', 'orders', 'offers', 'announcements', 'referrals', 'health']))
      .max(8)
      .optional(),
    quietHours: z
      .object({
        enabled: z.boolean().optional(),
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
      })
      .strict()
      .optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine(
    body => body.dailyStepGoal !== undefined || body.timezone !== undefined || body.silence !== undefined || body.quietHours !== undefined,
    'Change something',
  );
export type MemberConfigBody = z.infer<typeof memberConfigBody>;

export async function updateMemberConfig(actor: string, userId: string, body: MemberConfigBody) {
  const user = await UserModel.findById(userId).select({ timezone: 1 }).lean();
  if (!user) throw Errors.notFound('That member');
  const config = await getConfig();

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (body.dailyStepGoal !== undefined) {
    const { min, max } = config.activity.goal;
    if (body.dailyStepGoal < min || body.dailyStepGoal > max) {
      // The same range the member's own screen enforces (D-55): an operator
      // setting a goal the app would refuse would leave them unable to save
      // their own screen.
      throw Errors.validation({
        dailyStepGoal: `The goal range is ${min.toLocaleString('en-IN')}–${max.toLocaleString('en-IN')} steps; change it on the steps config page first.`,
      });
    }
    const current = await UserSettingsModel.findById(userId, { dailyStepGoal: 1 }).lean();
    before.dailyStepGoal = current?.dailyStepGoal ?? null;
    after.dailyStepGoal = body.dailyStepGoal;
    await UserSettingsModel.updateOne(
      { _id: userId },
      { $set: { dailyStepGoal: body.dailyStepGoal, stepGoalSetAt: new Date() } },
      { upsert: true },
    );
  }

  if (body.timezone !== undefined) {
    if (!isValidTimeZone(body.timezone)) {
      throw Errors.validation({ timezone: `'${body.timezone}' is not a zone the server knows.` });
    }
    before.timezone = user.timezone ?? null;
    after.timezone = body.timezone;
    // Days already scored keep the zone they were scored in (D-18): this
    // changes which day the *next* snapshot lands in, and nothing behind it.
    await UserModel.updateOne({ _id: userId }, { $set: { timezone: body.timezone } });
  }

  if (body.silence?.length || body.quietHours) {
    const current = (await NotificationPreferencesModel.findById(userId).lean()) ?? defaultPreferences(userId);
    const set: Record<string, unknown> = {};
    for (const category of body.silence ?? []) set[`categories.${category}`] = false;
    for (const [key, value] of Object.entries(body.quietHours ?? {})) {
      if (value !== undefined) set[`quietHours.${key}`] = value;
    }
    before.preferences = { categories: current.categories, quietHours: current.quietHours };
    after.preferences = set;
    await NotificationPreferencesModel.updateOne({ _id: userId }, { $set: set }, { upsert: true });
  }

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'member.config',
    subjectType: 'user',
    subjectId: userId,
    before,
    after: { ...after, note: body.note ?? null },
  });

  return memberConfig(userId);
}

// ─── What they have been told ──────────────────────────────────────────────

export const memberNotificationsQuery = z.object({
  cursor: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  topic: notificationTopicSchema.optional(),
});
export type MemberNotificationsQuery = z.infer<typeof memberNotificationsQuery>;

/**
 * Their notification centre, with the one thing the member's own copy does
 * not show: what happened to the push. A row that was written and never
 * pushed is the commonest answer to "I never got told".
 */
export async function memberNotifications(userId: string, query: MemberNotificationsQuery) {
  const filter: Record<string, unknown> = { userId };
  if (query.topic) filter.topic = query.topic;
  if (query.cursor) filter._id = { $lt: query.cursor };

  const rows = await NotificationModel.find(filter).sort({ _id: -1 }).limit(query.limit + 1).lean();
  const page = rows.slice(0, query.limit);
  return {
    data: page.map(row => ({
      id: row._id,
      topic: row.topic,
      title: row.title,
      message: row.message,
      read: row.read,
      readAt: iso(row.readAt),
      createdAt: iso(row.createdAt),
      /** Sent, held for quiet hours, or never pushed at all. */
      pushedAt: iso(row.pushedAt),
      pushDeferredUntil: iso(row.pushDeferredUntil),
      dedupeKey: row.dedupeKey ?? null,
    })),
    nextCursor: rows.length > query.limit ? page[page.length - 1]._id : null,
  };
}

export const sendNotificationBody = z
  .object({
    topic: notificationTopicSchema,
    title: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(500),
    /**
     * Send it now even inside the member's quiet window. For something that
     * is only worth anything at once — an account action they asked for —
     * not for the message that could have waited until morning.
     */
    exemptFromQuietHours: z.boolean().default(false),
    /** Write the feed row and send no push: say it, without ringing. */
    suppressPush: z.boolean().default(false),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type SendNotificationBody = z.infer<typeof sendNotificationBody>;

/**
 * Tells one member something, through the same path every job uses: the feed
 * row first and always, then the push, subject to their category switch and
 * their quiet hours.
 *
 * An operator cannot bypass the switch — a member who turned "activity" off
 * will get the row in their notification centre and no push, and the answer
 * says so.
 */
export async function sendMemberNotification(actor: string, userId: string, body: SendNotificationBody) {
  const user = await UserModel.findById(userId).select({ _id: 1 }).lean();
  if (!user) throw Errors.notFound('That member');

  const result = await notify({
    userId,
    topic: body.topic,
    title: body.title,
    message: body.message,
    exemptFromQuietHours: body.exemptFromQuietHours,
    suppressPush: body.suppressPush,
  });

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'member.notify',
    subjectType: 'user',
    subjectId: userId,
    before: null,
    after: {
      topic: body.topic,
      title: body.title,
      message: body.message,
      status: result.status,
      push: result.push,
      exemptFromQuietHours: body.exemptFromQuietHours,
      suppressPush: body.suppressPush,
      note: body.note ?? null,
    },
  });

  return result;
}

// ─── Asking a phone to send what it has ────────────────────────────────────

export const nudgeBody = z
  .object({
    /** Also tell the member in as many words, as the job's second rung does. */
    remind: z.boolean().default(false),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type NudgeBody = z.infer<typeof nudgeBody>;

/**
 * The hourly job's silent push (RULES A28), sent now, to this member's
 * phones — the support answer to "my steps are stuck".
 *
 * Deliberately not the whole job: no cooldown is consulted and no install is
 * skipped for being too far behind, because an operator pressing this has a
 * member on the phone and a reason. `nudgedAt` is still stamped, so the job
 * does not immediately push the same install again.
 */
export async function nudgeMemberSync(actor: string, userId: string, body: NudgeBody) {
  const user = await UserModel.findById(userId).select({ timezone: 1 }).lean();
  if (!user) throw Errors.notFound('That member');
  const config = await getConfig();
  const now = new Date();

  const devices = await DeviceModel.find({ userId, revokedAt: null }, { push: 1, stepSync: 1, counting: 1, info: 1 }).lean();
  const results: { deviceId: string; label: string; outcome: 'pushed' | 'no_token' | 'signed_out' | 'refused' | 'no_provider' }[] = [];

  for (const device of devices) {
    const label = [device.info?.brand, device.info?.model].filter(Boolean).join(' ') || device._id;
    const signedIn = (device.counting ?? []).some(period => period.to === null);
    if (!signedIn) {
      results.push({ deviceId: device._id, label, outcome: 'signed_out' });
      continue;
    }
    const token = device.push?.token;
    if (!token) {
      results.push({ deviceId: device._id, label, outcome: 'no_token' });
      continue;
    }
    if (!isPushConfigured()) {
      results.push({ deviceId: device._id, label, outcome: 'no_provider' });
      continue;
    }
    await DeviceModel.updateOne({ _id: device._id }, { $set: { 'stepSync.nudgedAt': now } });
    const push = await sendPush([token], { silent: true, data: { type: 'activity_sync' } });
    if (push.invalid.length > 0) await DeviceModel.updateOne({ _id: device._id }, { $set: { 'push.invalidAt': now } });
    results.push({ deviceId: device._id, label, outcome: push.sent > 0 ? 'pushed' : 'refused' });
  }

  let reminded: 'created' | 'duplicate' | 'suppressed' | 'not_sent' = 'not_sent';
  if (body.remind) {
    const sent = await notify({
      userId,
      topic: 'steps',
      title: 'Your steps are not reaching us',
      message: `Open Vokve to send what you have walked — after ${config.activity.maxAgeDays} days a day can no longer be counted.`,
      // The same key the job uses, so an operator and the job cannot tell
      // the same member the same thing twice on one day.
      dedupeKey: `steps.not_syncing:${localDayOf(now, user.timezone || config.locale.timezone)}`,
      now,
    });
    reminded = sent.status;
    await DeviceModel.updateMany({ userId }, { $set: { 'stepSync.remindedAt': now } });
  }

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'member.sync_nudge',
    subjectType: 'user',
    subjectId: userId,
    before: null,
    after: { results, reminded, note: body.note ?? null },
  });

  return { at: now.toISOString(), pushed: results.filter(row => row.outcome === 'pushed').length, results, reminded };
}
