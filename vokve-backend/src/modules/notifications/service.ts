import {
  appNotificationSchema,
  type AppNotification,
  type NotificationCategory,
  type NotificationTopic,
} from '../../contracts/index.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { sendPush } from '../../lib/push.js';
import { DeviceModel } from '../devices/models.js';
import { privacyAllows } from '../account/service.js';
import { NotificationPreferencesModel, UserModel } from '../identity/models.js';
import { NotificationModel } from './models.js';

/**
 * Which filter chip a topic answers to — the client's `NOTIFICATION_CATEGORY`,
 * kept identical so the counts the server returns match the rows the client
 * files under each chip.
 */
export const FEED_CATEGORY: Record<NotificationTopic, NotificationCategory> = {
  steps: 'activity',
  workout: 'activity',
  streak: 'activity',
  hydration: 'activity',
  coins: 'reward',
  challenge: 'reward',
  reward: 'reward',
  health: 'system',
  system: 'system',
};

export type PreferenceSwitch = 'activity' | 'coins' | 'challenges' | 'orders' | 'offers' | 'announcements' | 'referrals' | 'health';

/**
 * Which of the eight consent switches governs a topic's push. Coarser than
 * the topics on purpose: the settings screen asks about kinds of message,
 * and a user who turned "coins" off meant the expiry warning too.
 */
const PREFERENCE_OF: Record<NotificationTopic, PreferenceSwitch> = {
  steps: 'activity',
  workout: 'activity',
  streak: 'activity',
  hydration: 'health',
  coins: 'coins',
  challenge: 'challenges',
  reward: 'coins',
  health: 'health',
  system: 'announcements',
};

const MINUTES_PER_DAY = 24 * 60;

/** Minutes since local midnight, in the user's zone. */
function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}

function parseHHmm(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h % 24) * 60 + (m % 60);
}

/**
 * How long a push has to wait for the quiet window to end, or 0 when it can
 * go now. Windows wrap midnight (22:00–07:00 is the default), so the test is
 * "between start and end going forwards", and the wait is measured the same
 * way — no zoned date arithmetic, only minutes on a clock face.
 */
export function quietHoursDelayMs(at: Date, timeZone: string, window: { enabled: boolean; start: string; end: string }): number {
  if (!window.enabled) return 0;
  const now = localMinutes(at, timeZone);
  const start = parseHHmm(window.start);
  const end = parseHHmm(window.end);
  if (start === end) return 0;
  const sinceStart = (now - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const length = (end - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (sinceStart >= length) return 0;
  return (length - sinceStart) * 60_000;
}

export interface NotifyInput {
  userId: string;
  topic: NotificationTopic;
  title: string;
  message: string;
  /** Names the event, so a producer that runs twice writes one row. */
  dedupeKey?: string;
  /**
   * Which consent switch to honour instead of the topic's own. The feed's
   * topics are a closed enum with no "order", so an order message files
   * under `reward` for the chips but asks the `orders` switch for its push.
   */
  preference?: PreferenceSwitch;
  /** OTP-grade messages that quiet hours must not hold back (BACKEND §5). */
  exemptFromQuietHours?: boolean;
  /**
   * A message aimed at this member rather than sent to everyone — a deal
   * picked from what they browse. Honours the privacy switch as well as the
   * notification one (RULES P7): opted out, nothing is written at all,
   * because a feed row is targeting too.
   */
  personalised?: boolean;
  now?: Date;
}

export interface NotifyResult {
  id: string | null;
  /** `suppressed` is a targeted message the member has opted out of (RULES P7). */
  status: 'created' | 'duplicate' | 'suppressed';
  /** Where the push went: sent now, held for quiet hours, or not wanted. */
  push: 'sent' | 'deferred' | 'no_provider' | 'category_off' | 'no_device' | 'skipped';
}

/**
 * Tells the user something (ARCHITECTURE §5.7). The feed row is written first
 * and always — it is the channel the user can go and look at — then the push
 * follows the user's consent: the category switch decides whether at all,
 * quiet hours decide when.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const now = input.now ?? new Date();
  if (input.personalised && !(await privacyAllows(input.userId, 'personalisedOffers'))) {
    return { id: null, status: 'suppressed', push: 'skipped' };
  }
  const id = newId('ntf');
  try {
    await NotificationModel.create({
      _id: id, userId: input.userId, topic: input.topic, title: input.title, message: input.message,
      dedupeKey: input.dedupeKey ?? null, createdAt: now,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return { id: null, status: 'duplicate', push: 'skipped' };
    throw err;
  }

  const [prefs, user] = await Promise.all([
    NotificationPreferencesModel.findById(input.userId).lean(),
    UserModel.findById(input.userId, { timezone: 1 }).lean(),
  ]);
  const categories = (prefs?.categories ?? {}) as Partial<Record<PreferenceSwitch, boolean>>;
  const preference = input.preference ?? PREFERENCE_OF[input.topic];
  const wanted = categories[preference] ?? preference !== 'health';
  if (!wanted) return { id, status: 'created', push: 'category_off' };

  const quiet = prefs?.quietHours ?? { enabled: true, start: '22:00', end: '07:00' };
  const delay = input.exemptFromQuietHours ? 0 : quietHoursDelayMs(now, user?.timezone ?? 'UTC', quiet);
  if (delay > 0) {
    await NotificationModel.updateOne({ _id: id }, { $set: { pushDeferredUntil: new Date(now.getTime() + delay) } });
    return { id, status: 'created', push: 'deferred' };
  }

  const push = await pushRow(id, input.userId, input.title, input.message, input.topic);
  return { id, status: 'created', push };
}

async function pushRow(id: string, userId: string, title: string, message: string, topic: NotificationTopic): Promise<NotifyResult['push']> {
  const devices = await DeviceModel.find({ userId, 'push.token': { $type: 'string' }, 'push.invalidAt': null }, { 'push.token': 1 }).lean();
  const tokens = devices.map(d => d.push?.token).filter((t): t is string => typeof t === 'string');
  if (tokens.length === 0) return 'no_device';

  const result = await sendPush(tokens, { title, body: message, data: { topic, notificationId: id } });
  if (result.invalid.length > 0) {
    await DeviceModel.updateMany({ 'push.token': { $in: result.invalid } }, { $set: { 'push.invalidAt': new Date() } });
  }
  if (result.sent === 0) return 'no_provider';
  await NotificationModel.updateOne({ _id: id }, { $set: { pushedAt: new Date(), pushDeferredUntil: null } });
  return 'sent';
}

/** Sends the pushes quiet hours held back, once their windows have ended. The hourly tick's job. */
export async function flushDeferredPushes(now = new Date()): Promise<number> {
  const due = await NotificationModel.find({ pushDeferredUntil: { $ne: null, $lte: now } }).lean();
  let sent = 0;
  for (const row of due) {
    // Cleared first so a failing provider cannot make the tick retry forever.
    await NotificationModel.updateOne({ _id: row._id }, { $set: { pushDeferredUntil: null } });
    const push = await pushRow(row._id, row.userId, row.title, row.message, row.topic as NotificationTopic);
    if (push === 'sent') sent += 1;
  }
  if (due.length > 0) logger.info({ due: due.length, sent }, 'notifications.flushed');
  return sent;
}

// ─── Reads ─────────────────────────────────────────────────────────────────

function toContract(row: { _id: string; topic: string; title: string; message: string; createdAt: Date; read: boolean }): AppNotification {
  return appNotificationSchema.parse({ id: row._id, topic: row.topic, title: row.title, message: row.message, createdAt: row.createdAt.toISOString(), read: row.read });
}

function topicsOf(category: NotificationCategory): NotificationTopic[] {
  return (Object.keys(FEED_CATEGORY) as NotificationTopic[]).filter(topic => FEED_CATEGORY[topic] === category);
}

export async function listNotifications(userId: string, category: NotificationCategory | undefined, cursor: string | undefined, limit = 20) {
  const filter: Record<string, unknown> = { userId };
  if (category) filter.topic = { $in: topicsOf(category) };
  if (cursor) filter._id = { $lt: cursor }; // uuid v7 ids sort by time
  const rows = await NotificationModel.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const page = rows.slice(0, limit);
  return { data: page.map(toContract), nextCursor: rows.length > limit ? page[page.length - 1]._id : null };
}

/** Totals per chip, plus the unread figure the bell's dot is drawn from. */
export async function countNotifications(userId: string) {
  const [byTopic, unread] = await Promise.all([
    NotificationModel.aggregate<{ _id: string; n: number }>([{ $match: { userId } }, { $group: { _id: '$topic', n: { $sum: 1 } } }]),
    NotificationModel.countDocuments({ userId, read: false }),
  ]);
  const counts = { all: 0, activity: 0, reward: 0, system: 0, unread };
  for (const { _id, n } of byTopic) {
    counts.all += n;
    counts[FEED_CATEGORY[_id as NotificationTopic]] += n;
  }
  return counts;
}

export async function markRead(userId: string, id: string): Promise<boolean> {
  const result = await NotificationModel.updateOne({ _id: id, userId, read: false }, { $set: { read: true, readAt: new Date() } });
  return result.matchedCount > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await NotificationModel.updateMany({ userId, read: false }, { $set: { read: true, readAt: new Date() } });
  return result.modifiedCount;
}
