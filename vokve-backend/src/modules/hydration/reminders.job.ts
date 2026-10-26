import { getConfig } from '../../config/remote.js';
import { localDayOf, localTimeOf, weekdayOf } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';
import { DeviceModel } from '../devices/models.js';
import { UserModel } from '../identity/models.js';
import { notify } from '../notifications/service.js';
import { HydrationPlanModel } from './models.js';
import { getHydrationDay } from './service.js';

/**
 * Sending the hydration reminders (RULES Y6), once a minute.
 *
 * ## Who notifies
 *
 * The phone does, from a local alarm it schedules off the plan: it fires at
 * the minute, with no network, carrying the member's own sound. A push can
 * promise none of those — FCM batches in Doze, a plane turns it off, and a
 * sound belongs to a channel the server does not own. So an install that has
 * the plan scheduled says so on its heartbeat
 * (`PATCH /devices/:id { localReminders: true }`), and for an account where
 * some install has said it lately this sweep writes the feed row only.
 *
 * The push is the fallback, and it matters: a member who refused the
 * notification permission, or signed in on a second phone and has not opened
 * it since, has nothing scheduling for them. They still get reminded.
 *
 * ## Finding who is due
 *
 * A reminder's time is `HH:mm` on the member's own clock, so "who is due
 * now" is a different question in every zone. The plan carries the zone it
 * was saved on, which turns the sweep into one indexed query per distinct
 * zone — a handful, not one per member — asking for plans that are on, that
 * repeat today, and that hold this minute.
 *
 * ## Sending once
 *
 * The minute is claimed by a conditional write before anything is sent, so
 * two instances ticking together cannot both send it, a tick that runs twice
 * in the same minute sends once, and a plan holding 10:00 in two blocks
 * sends one reminder. The feed row's dedupe key is a second guard behind it.
 *
 * ## Sending on time
 *
 * Two things here are about lateness rather than delivery, because a
 * reminder that arrives at the wrong time is worse than one that does not
 * arrive at all — it is an app that cannot be trusted with a minute.
 *
 * `sweepReminders` sends the minutes *since the last sweep* as well as the
 * current one, up to ⚙ `hydration.reminderCatchUpMinutes`. The tick is a
 * timer, and a timer held up by a slow query, a deploy or a restart skips
 * the minute it should have run in — and nobody due in that minute was ever
 * told. Past the bound a missed minute is dropped rather than sent, for the
 * same reason quiet hours drop one (Y6).
 *
 * And the push carries ⚙ `hydration.reminderPushTtlSeconds`, so FCM and
 * APNs drop it instead of handing it to a phone that comes back online
 * hours later, next to the reminder that is actually due.
 */

const MINUTE_MS = 60_000;

/** The minute `now` falls in, as ms since the epoch. */
const minuteFloor = (now: Date) => Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;

/** `YYYY-MM-DDTHH:mm` on the member's clock: the minute a plan claims. */
function minuteKey(day: string, time: string): string {
  return `${day}T${time}`;
}

interface Due {
  userId: string;
  timeZone: string;
  day: string;
  time: string;
}

/**
 * Whether a push should go out as well as the feed row, or the phone has it.
 *
 * Any install that claimed the plan inside the trust window counts: it is
 * the member's own phone, and a second phone they never open is not a reason
 * to push the first one twice.
 */
async function wantsPush(userId: string, now: Date, trustDays: number): Promise<boolean> {
  const since = new Date(now.getTime() - trustDays * 86_400_000);
  const claimed = await DeviceModel.countDocuments({
    userId,
    revokedAt: null,
    remindersScheduledAt: { $gte: since },
  });
  return claimed === 0;
}

/** The reminder's wording, from the day so far. */
function bodyFor(
  config: Awaited<ReturnType<typeof getConfig>>,
  time: string,
  consumedMl: number,
  goalMl: number,
): string {
  const goal = `${(goalMl / 1000).toFixed(goalMl % 1000 === 0 ? 1 : 2)} L`;
  if (consumedMl >= goalMl) {
    return config.hydration.reminderGoalMetBody.replaceAll('{goal}', goal);
  }
  const remaining = `${goalMl - consumedMl} ml`;
  const bodies = config.hydration.reminderBodies;
  // By the minute rather than at random, so one account's two phones word
  // the same reminder the same way and a retry does not reword it.
  const [hours, minutes] = time.split(':').map(Number);
  const choice = bodies[(hours * 60 + minutes) % bodies.length];
  return choice.replaceAll('{remaining}', remaining).replaceAll('{goal}', goal);
}

/**
 * The plans due this minute in `timeZone`.
 *
 * `$elemMatch` rather than two conditions: a plan with 07:00 switched off
 * and 09:00 on must not match 07:00 because it holds the time somewhere and
 * has something enabled somewhere.
 */
async function dueInZone(timeZone: string, now: Date): Promise<Due[]> {
  const day = localDayOf(now, timeZone);
  const time = localTimeOf(now, timeZone);
  const rows = await HydrationPlanModel.find(
    {
      enabled: true,
      timezone: timeZone,
      repeatDays: weekdayOf(day),
      reminders: { $elemMatch: { time, enabled: true } },
    },
    { _id: 1 },
  ).lean();
  return rows.map(row => ({ userId: String(row._id), timeZone, day, time }));
}

/**
 * The same question for plans saved before the zone was kept on them, which
 * have to be matched against their member's own zone one at a time. They
 * convert on their next save; until then this keeps them ringing.
 */
async function dueWithoutZone(now: Date, fallbackZone: string): Promise<Due[]> {
  const rows = await HydrationPlanModel.find(
    { enabled: true, timezone: null },
    { _id: 1, reminders: 1, repeatDays: 1 },
  ).lean();
  if (rows.length === 0) return [];

  const users = await UserModel.find(
    { _id: { $in: rows.map(row => row._id) }, deletedAt: null },
    { timezone: 1 },
  ).lean();
  const zoneOf = new Map(users.map(user => [String(user._id), user.timezone ?? fallbackZone]));

  const due: Due[] = [];
  for (const row of rows) {
    const timeZone = zoneOf.get(String(row._id));
    if (!timeZone) continue;
    const day = localDayOf(now, timeZone);
    if (!row.repeatDays.includes(weekdayOf(day))) continue;
    const time = localTimeOf(now, timeZone);
    if (!row.reminders.some(reminder => reminder.time === time && reminder.enabled)) continue;
    due.push({ userId: String(row._id), timeZone, day, time });
  }
  return due;
}

export interface ReminderSweep {
  /** Plans whose minute this was. */
  due: number;
  /** Reminders told to the member — a feed row, with or without a push. */
  sent: number;
  /** Pushed as well, because no install of theirs is scheduling locally. */
  pushed: number;
}

/**
 * Sends every reminder due this minute. Safe to call again for the same
 * minute: the claim means the second call sends nothing.
 */
export async function sendDueReminders(now = new Date()): Promise<ReminderSweep> {
  const config = await getConfig();
  const zones: string[] = await HydrationPlanModel.distinct('timezone', { enabled: true });

  const due: Due[] = [];
  for (const zone of zones) {
    if (!zone) continue;
    due.push(...(await dueInZone(zone, now)));
  }
  due.push(...(await dueWithoutZone(now, config.locale.timezone)));

  const sweep: ReminderSweep = { due: due.length, sent: 0, pushed: 0 };

  for (const entry of due) {
    const key = minuteKey(entry.day, entry.time);
    // The claim: whoever writes the minute first is the one that sends it.
    const claimed = await HydrationPlanModel.updateOne(
      { _id: entry.userId, lastSentMinute: { $ne: key } },
      { $set: { lastSentMinute: key } },
    );
    if (claimed.modifiedCount === 0) continue;

    const [day, push] = await Promise.all([
      getHydrationDay(entry.userId, entry.day),
      wantsPush(entry.userId, now, config.hydration.localScheduleTrustDays),
    ]);

    const result = await notify({
      userId: entry.userId,
      topic: 'hydration',
      title: config.hydration.reminderTitle,
      message: bodyFor(config, entry.time, day.consumedMl, day.goalMl),
      dedupeKey: `hydration-reminder:${entry.userId}:${key}`,
      // A reminder is only worth its own minute (Y6) — which is as true of
      // the push in flight as it is of the hour it was sent in, so the
      // message carries its own lifetime and the provider drops it rather
      // than delivering it late.
      dropInQuietHours: true,
      pushTtlSeconds: config.hydration.reminderPushTtlSeconds,
      suppressPush: !push,
      now,
    });
    if (result.status === 'created') sweep.sent += 1;
    if (result.push === 'sent') sweep.pushed += 1;
  }

  if (sweep.due > 0) logger.info(sweep, 'hydration.reminders_swept');
  return sweep;
}

/** The last minute this process swept, as ms since the epoch. */
let lastSweptMinute: number | null = null;

/** Forgets it, so the next sweep starts from its own minute. For tests. */
export function resetReminderSweep(): void {
  lastSweptMinute = null;
}

/**
 * The tick's entry point: this minute, and any the tick missed.
 *
 * The first sweep of a process only ever sends its own minute — the minutes
 * before it belong to whatever was running then, and a restart is not a
 * reason to re-send an hour of reminders. After that it fills the gap, which
 * is what stops a held-up tick losing a minute silently.
 */
export async function sweepReminders(now = new Date()): Promise<ReminderSweep> {
  const { hydration } = await getConfig();
  const catchUp = Math.max(0, Math.floor(hydration.reminderCatchUpMinutes));
  const current = minuteFloor(now);
  const oldest = current - catchUp * MINUTE_MS;
  const from =
    lastSweptMinute === null
      ? current
      : Math.min(current, Math.max(lastSweptMinute + MINUTE_MS, oldest));
  lastSweptMinute = current;

  const total: ReminderSweep = { due: 0, sent: 0, pushed: 0 };
  for (let minute = from; minute <= current; minute += MINUTE_MS) {
    // The minute's own instant, so every reminder is read against the clock
    // it was due on rather than the one the tick happens to run on.
    const result = await sendDueReminders(new Date(minute));
    total.due += result.due;
    total.sent += result.sent;
    total.pushed += result.pushed;
  }
  const missed = (current - from) / MINUTE_MS;
  if (missed > 0) {
    logger.warn({ missed, ...total }, 'hydration.reminders_caught_up');
  }
  return total;
}
