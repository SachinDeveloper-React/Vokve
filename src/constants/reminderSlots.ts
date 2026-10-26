import type { HydrationReminderPlan, ReminderSlot } from '../types/models';

/**
 * What each block of the reminder plan will take (RULES Y5).
 *
 * A block is a part of the day, so the times in it belong to that part of
 * the day: a "Morning" chip reading 8 PM is not a time the user meant, it is
 * a picker that let them spin the wrong column. The three preset blocks are
 * therefore each pinned to a half of the clock — morning is AM, afternoon
 * and evening are PM — and the picker only offers the half the block is in,
 * rather than accepting the wrong one and correcting it afterwards.
 *
 * Afternoon and evening are both PM and are deliberately not split further
 * by hour: which of the two a 6 PM reminder belongs in is the user's call,
 * not the app's, and a block that refused a time the next block along would
 * accept is a rule nobody can see the point of.
 *
 * Custom times are the way out of all of it — one list, any time of day —
 * which is why they are the only slot with no half and no small cap.
 *
 * **The server owns both numbers.** The plan arrives with a `slots` block
 * (⚙ `hydration.reminderSlotPeriods`, `hydration.maxRemindersPerSlot`), so
 * the halves and the caps can be re-cut from the panel without a release.
 * What is written here is this build's copy of the same three rules, and it
 * is what the screen draws when the plan has not arrived yet, when the
 * server is older than the field, and offline — the same rule the rest of
 * the app follows: the figures survive the network.
 */

/** Which half of the clock a block's times are chosen from. */
export type SlotPeriod = 'am' | 'pm' | 'any';

export interface SlotRule {
  /** The block's name, as the card and the messages about it say it. */
  title: string;
  period: SlotPeriod;
  /**
   * The most times the block may hold.
   *
   * Five is a reminder every two or three hours across the part of the day
   * the block covers, which is the point at which another one stops being a
   * reminder and starts being a stream — and each one is an alarm the OS
   * has to keep, on a budget of its own (`ALARM_BUDGET`). The server holds
   * the same cap (⚙ `hydration.maxRemindersPerSlot`), so a second phone
   * cannot talk its way past it.
   */
  maxTimes: number;
  /** The time the picker opens on when the block is empty. */
  defaultTime: string;
}

/** The plan-wide cap the server enforces (⚙ `hydration.maxReminders`). */
export const MAX_PLAN_TIMES = 24;

export type SlotRules = Record<ReminderSlot, SlotRule>;

export const SLOT_RULES: SlotRules = {
  morning: {
    title: 'Morning',
    period: 'am',
    maxTimes: 5,
    defaultTime: '08:00',
  },
  afternoon: {
    title: 'Afternoon',
    period: 'pm',
    maxTimes: 5,
    defaultTime: '14:00',
  },
  evening: {
    title: 'Evening',
    period: 'pm',
    maxTimes: 5,
    defaultTime: '19:00',
  },
  custom: {
    title: 'Custom',
    period: 'any',
    maxTimes: MAX_PLAN_TIMES,
    defaultTime: '08:00',
  },
};

/** The blocks drawn as the three parts of the day, in their own order. */
export const PRESET_SLOTS = ['morning', 'afternoon', 'evening'] as const;

/**
 * The rules in force: the server's where it sent them, this build's where it
 * did not.
 *
 * Merged field by field rather than taken whole, because only two of them
 * are the server's. A block's name and the hour its picker opens on are
 * copy, not policy — and the opening hour is clamped into whichever half the
 * server named, so re-cutting `evening` to AM cannot leave the picker
 * opening at a time it would refuse.
 */
export function mergeSlotRules(
  sent: HydrationReminderPlan['slots'],
): SlotRules {
  if (!sent) return SLOT_RULES;
  const merged = { ...SLOT_RULES };
  for (const slot of Object.keys(SLOT_RULES) as ReminderSlot[]) {
    const rule = sent[slot];
    if (!rule) continue;
    merged[slot] = {
      ...SLOT_RULES[slot],
      period: rule.period,
      maxTimes: rule.maxTimes,
      defaultTime: clampToPeriod(
        SLOT_RULES[slot].defaultTime,
        rule.period,
        SLOT_RULES[slot].defaultTime,
      ),
    };
  }
  return merged;
}

/** Whether an `HH:mm` is in one half of the clock. */
function inPeriod(time: string, period: SlotPeriod): boolean {
  if (period === 'any') return true;
  const hours = Number(time.slice(0, 2));
  if (!Number.isFinite(hours)) return false;
  return period === 'am' ? hours < 12 : hours >= 12;
}

/** The same clock time in `period`, or `fallback` if it cannot be read. */
function clampToPeriod(
  time: string,
  period: SlotPeriod,
  fallback: string,
): string {
  if (inPeriod(time, period)) return time;
  const hours = Number(time.slice(0, 2));
  if (!Number.isFinite(hours)) return fallback;
  const shifted = period === 'am' ? hours - 12 : hours + 12;
  return `${String(shifted).padStart(2, '0')}${time.slice(2)}`;
}

/** Whether an `HH:mm` is in the half of the clock a block takes. */
export function isTimeInSlot(
  time: string,
  slot: ReminderSlot,
  rules: SlotRules = SLOT_RULES,
): boolean {
  return inPeriod(time, rules[slot].period);
}

/**
 * The same time in the block's own half of the clock.
 *
 * Used to seed the picker, never to change a saved reminder: a plan made
 * before this rule, or on a build that did not have it, may hold 1 PM in
 * the morning block, and opening the editor on 1 AM is how the user is
 * shown what the block will now take. Their own commit is what moves it.
 */
export function clampTimeToSlot(
  time: string,
  slot: ReminderSlot,
  rules: SlotRules = SLOT_RULES,
): string {
  return clampToPeriod(time, rules[slot].period, rules[slot].defaultTime);
}

/** Why the picker's AM/PM column is fixed, or nothing when it is not. */
export function slotPeriodNote(
  slot: ReminderSlot,
  rules: SlotRules = SLOT_RULES,
): string | undefined {
  const { title, period } = rules[slot];
  if (period === 'any') return undefined;
  const half = period === 'am' ? 'AM' : 'PM';
  const other = period === 'am' ? 'later in the day' : 'in the morning';
  return `${title} times are ${half}. Add a custom time for a reminder ${other}.`;
}

/** "Morning holds 5 times at most." — said where a block is full. */
export function slotFullMessage(
  slot: ReminderSlot,
  rules: SlotRules = SLOT_RULES,
): string {
  const { title, maxTimes } = rules[slot];
  return `${title} holds ${maxTimes} times at most. Change one of them, or add a custom time instead.`;
}
