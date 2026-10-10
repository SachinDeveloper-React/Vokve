import { Platform } from 'react-native';
import type { HydrationReminderPlan } from '../types/models';

/**
 * Turning a reminder plan into the alarms the OS will hold (RULES Y5, Y6).
 *
 * Kept apart from `services/notifications` and free of anything native, so
 * the question this answers — given this plan, at this instant, what should
 * be scheduled? — can be asked in a test. It is the part with all the edge
 * cases in it: a plan that repeats on three days, a time that has already
 * gone today, a window the user asked not to be disturbed in, and a list
 * longer than the OS will keep.
 */

/**
 * Every alarm Vokve schedules is named from here, so cancelling the plan
 * cannot cancel a notification something else in the app scheduled.
 */
export const ALARM_ID_PREFIX = 'vokve.hydration.';

/**
 * How many alarms to leave with the OS.
 *
 * iOS keeps 64 pending notification requests per app and silently drops the
 * rest, so the budget is 56: under the limit with room for anything else the
 * app schedules. One alarm covers a weekday, and a plan that repeats every
 * day needs only one per time — so the ceiling is reached by a plan with
 * many times on *some* days, where the nearest alarms are scheduled and the
 * rest come into range as the week turns and the app re-syncs. Android's
 * limit is in the hundreds, and its alarms survive reboot, so it gets more.
 */
export const ALARM_BUDGET = Platform.OS === 'ios' ? 56 : 400;

export interface ReminderAlarm {
  /**
   * Stable across re-syncs: scheduling the same plan again replaces each
   * alarm rather than adding a second copy of it.
   */
  id: string;
  /** When it first fires, ms since the epoch. */
  timestamp: number;
  /**
   * `daily` for a plan that runs all week — one alarm per time instead of
   * seven — and `weekly` for one that does not.
   */
  repeat: 'daily' | 'weekly';
  /** `HH:mm`, as the plan holds it. */
  time: string;
  /** Monday-first weekday this alarm covers, or null for a daily one. */
  weekday: number | null;
}

export interface QuietHours {
  enabled: boolean;
  /** 24-hour `HH:mm`, local. The window may run past midnight. */
  start: string;
  end: string;
}

export interface PlanAlarmsOptions {
  now?: Date;
  /**
   * The window the user asked not to be disturbed in. A reminder inside it
   * is not scheduled at all rather than moved: the server drops it for the
   * same reason (RULES Y6), and a 03:00 reminder arriving at 07:00 is not a
   * late reminder but a reminder for a time that has gone.
   */
  quietHours?: QuietHours | null;
  budget?: number;
}

/** Minutes since midnight of an `HH:mm`. */
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * Whether a time on the clock face falls inside the quiet window.
 *
 * Measured as "how far past the start, going forwards", so a window that
 * wraps midnight — 22:00 to 07:00, the default — needs no special case.
 */
export function isQuiet(time: string, quietHours: QuietHours | null | undefined): boolean {
  if (!quietHours?.enabled) return false;
  const start = minutesOf(quietHours.start);
  const end = minutesOf(quietHours.end);
  if (start === end) return false;
  const sinceStart = (minutesOf(time) - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const length = (end - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return sinceStart < length;
}

/** Monday-first weekday of a date, 0 = Monday (RULES Y5). */
export function weekdayOf(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/**
 * The next time the clock reads `time`, optionally on a given weekday.
 *
 * Built by moving a copy of `now`, so the phone's own calendar does the
 * work: a clock change in between lands on the wall-clock time the user
 * asked for, which is the whole point of storing `HH:mm` rather than an
 * instant. A time that is exactly now goes to the next day — the OS will
 * not fire an alarm for a moment that has already passed.
 */
export function nextOccurrence(now: Date, time: string, weekday?: number | null): number {
  const [hours, minutes] = time.split(':').map(Number);
  const at = new Date(now.getTime());
  at.setHours(hours || 0, minutes || 0, 0, 0);

  if (weekday === undefined || weekday === null) {
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    return at.getTime();
  }

  let days = (weekday - weekdayOf(now) + 7) % 7;
  if (days === 0 && at.getTime() <= now.getTime()) days = 7;
  at.setDate(at.getDate() + days);
  return at.getTime();
}

/**
 * The alarms a plan comes to, soonest first.
 *
 * One alarm per *time*, not per reminder: a plan is allowed to hold 10:00 in
 * the morning block and 10:00 as a custom time, and the user who set both
 * asked to be reminded at ten — not twice at ten. The server sends one for
 * the same reason.
 */
export function planReminderAlarms(
  plan: HydrationReminderPlan | null,
  { now = new Date(), quietHours = null, budget = ALARM_BUDGET }: PlanAlarmsOptions = {},
): ReminderAlarm[] {
  if (plan === null || !plan.enabled) return [];

  const days = [...new Set(plan.repeatDays)].filter(day => day >= 0 && day <= 6).sort((a, b) => a - b);
  if (days.length === 0) return [];

  const times = [...new Set(plan.reminders.filter(reminder => reminder.enabled).map(reminder => reminder.time))]
    .filter(time => !isQuiet(time, quietHours))
    .sort((a, b) => minutesOf(a) - minutesOf(b));
  if (times.length === 0) return [];

  const everyDay = days.length === 7;
  const alarms: ReminderAlarm[] = everyDay
    ? times.map(time => ({
        id: `${ALARM_ID_PREFIX}${time}`,
        timestamp: nextOccurrence(now, time),
        repeat: 'daily' as const,
        time,
        weekday: null,
      }))
    : days.flatMap(weekday =>
        times.map(time => ({
          id: `${ALARM_ID_PREFIX}${weekday}.${time}`,
          timestamp: nextOccurrence(now, time, weekday),
          repeat: 'weekly' as const,
          time,
          weekday,
        })),
      );

  // Soonest first, so a plan over the budget keeps the reminders the user is
  // about to need and loses the far end of the week — which the next sync
  // brings back as it comes into range.
  return alarms.sort((a, b) => a.timestamp - b.timestamp).slice(0, budget);
}
