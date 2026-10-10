/**
 * Turning a reminder plan into alarms (RULES Y5, Y6).
 *
 * This is where every edge of the feature lives — a time that has already
 * gone today, a plan that runs on three days, a quiet window that wraps
 * midnight, two blocks holding the same minute — so it is checked here, on
 * the pure function, rather than through a mocked native module where a
 * wrong answer would be hidden behind a spy call count.
 *
 * Every check fixes "now", because the whole question is what time it is.
 *
 * @format
 */

import {
  ALARM_ID_PREFIX,
  isQuiet,
  nextOccurrence,
  planReminderAlarms,
  weekdayOf,
} from '../src/services/reminderSchedule';
import type { HydrationReminderPlan } from '../src/types/models';

/** A Wednesday, 08:00 local — in the middle of a week and of a day. */
const WEDNESDAY_0800 = new Date(2026, 9, 14, 8, 0, 0, 0);

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

function planOf(
  times: [HydrationReminderPlan['reminders'][number]['slot'], string, boolean][],
  overrides: Partial<HydrationReminderPlan> = {},
): HydrationReminderPlan {
  return {
    enabled: true,
    sound: 'water_drop',
    vibration: true,
    repeatDays: EVERY_DAY,
    reminders: times.map(([slot, time, enabled]) => ({
      id: `${slot}-${time}`,
      time,
      slot,
      enabled,
    })),
    ...overrides,
  };
}

const PLAN = planOf([
  ['morning', '07:00', true],
  ['morning', '10:00', true],
  ['afternoon', '13:00', true],
  ['evening', '20:00', true],
]);

const at = (alarms: { time: string }[]) => alarms.map(alarm => alarm.time);

describe('the clock', () => {
  test('the fixed instant really is a Wednesday morning', () => {
    expect(weekdayOf(WEDNESDAY_0800)).toBe(2);
    expect(WEDNESDAY_0800.getHours()).toBe(8);
  });

  test('a time still ahead today is today, and one gone is tomorrow', () => {
    const later = new Date(nextOccurrence(WEDNESDAY_0800, '10:00'));
    expect(later.getDate()).toBe(14);
    expect(later.getHours()).toBe(10);

    // 07:00 has been and gone — scheduling it for today would be a trigger
    // in the past, which the OS simply drops.
    const gone = new Date(nextOccurrence(WEDNESDAY_0800, '07:00'));
    expect(gone.getDate()).toBe(15);
    expect(gone.getHours()).toBe(7);
  });

  test('a weekday still ahead this week is this week, and this one wraps if the time has gone', () => {
    // Friday is two days off.
    const friday = new Date(nextOccurrence(WEDNESDAY_0800, '09:00', 4));
    expect(friday.getDate()).toBe(16);
    expect(weekdayOf(friday)).toBe(4);

    // Wednesday 10:00 is still today.
    const today = new Date(nextOccurrence(WEDNESDAY_0800, '10:00', 2));
    expect(today.getDate()).toBe(14);

    // Wednesday 07:00 has gone, so it is next Wednesday — not today.
    const nextWeek = new Date(nextOccurrence(WEDNESDAY_0800, '07:00', 2));
    expect(nextWeek.getDate()).toBe(21);
  });

  test('the quiet window is read on the clock face, so it may wrap midnight', () => {
    const night = { enabled: true, start: '22:00', end: '07:00' };
    expect(isQuiet('23:30', night)).toBe(true);
    expect(isQuiet('02:00', night)).toBe(true);
    expect(isQuiet('07:00', night)).toBe(false);
    expect(isQuiet('13:00', night)).toBe(false);
    expect(isQuiet('02:00', { ...night, enabled: false })).toBe(false);
  });
});

describe('planning the alarms', () => {
  test('a plan that runs every day needs one alarm per time, repeating daily', () => {
    const alarms = planReminderAlarms(PLAN, { now: WEDNESDAY_0800 });

    expect(alarms).toHaveLength(4);
    expect(alarms.every(alarm => alarm.repeat === 'daily')).toBe(true);
    // Soonest first: 10:00 today, then 13:00 and 20:00, then 07:00 tomorrow.
    expect(at(alarms)).toEqual(['10:00', '13:00', '20:00', '07:00']);
    expect(alarms[0].id).toBe(`${ALARM_ID_PREFIX}10:00`);
  });

  test('a plan on some days gets one weekly alarm per day and time', () => {
    // Weekdays only.
    const alarms = planReminderAlarms(planOf([['morning', '07:00', true]], { repeatDays: [0, 1, 2, 3, 4] }), {
      now: WEDNESDAY_0800,
    });

    expect(alarms).toHaveLength(5);
    expect(alarms.every(alarm => alarm.repeat === 'weekly')).toBe(true);
    expect(alarms.map(alarm => alarm.weekday)).toEqual([3, 4, 0, 1, 2]);
    // The nearest is Thursday's, because Wednesday's 07:00 has gone.
    expect(alarms[0].id).toBe(`${ALARM_ID_PREFIX}3.07:00`);
  });

  test('nothing is scheduled for a plan switched off, with no days, or with nothing on', () => {
    expect(planReminderAlarms(null, { now: WEDNESDAY_0800 })).toEqual([]);
    expect(planReminderAlarms({ ...PLAN, enabled: false }, { now: WEDNESDAY_0800 })).toEqual([]);
    expect(planReminderAlarms({ ...PLAN, repeatDays: [] }, { now: WEDNESDAY_0800 })).toEqual([]);

    const allOff = planOf([
      ['morning', '07:00', false],
      ['evening', '20:00', false],
    ]);
    expect(planReminderAlarms(allOff, { now: WEDNESDAY_0800 })).toEqual([]);
  });

  test('a reminder switched off is left out while the rest stay', () => {
    const plan = planOf([
      ['morning', '10:00', false],
      ['afternoon', '13:00', true],
    ]);

    expect(at(planReminderAlarms(plan, { now: WEDNESDAY_0800 }))).toEqual(['13:00']);
  });

  test('two blocks holding the same minute ring once', () => {
    const plan = planOf([
      ['morning', '10:00', true],
      ['custom', '10:00', true],
    ]);

    // The user asked to be reminded at ten, not twice at ten.
    expect(planReminderAlarms(plan, { now: WEDNESDAY_0800 })).toHaveLength(1);
  });

  test('a time inside quiet hours is not scheduled at all', () => {
    const plan = planOf([
      ['custom', '02:00', true],
      ['custom', '23:30', true],
      ['afternoon', '13:00', true],
    ]);

    const alarms = planReminderAlarms(plan, {
      now: WEDNESDAY_0800,
      quietHours: { enabled: true, start: '22:00', end: '07:00' },
    });

    // Held until morning it would arrive for a time that has gone, next to
    // whatever the morning itself brings — so it is dropped, as the server
    // drops it (RULES Y6).
    expect(at(alarms)).toEqual(['13:00']);
  });

  test('quiet hours switched off schedule the night times again', () => {
    const plan = planOf([['custom', '02:00', true]]);

    expect(
      at(planReminderAlarms(plan, {
        now: WEDNESDAY_0800,
        quietHours: { enabled: false, start: '22:00', end: '07:00' },
      })),
    ).toEqual(['02:00']);
  });

  test('a plan over the budget keeps the alarms it is about to need', () => {
    const times: [HydrationReminderPlan['reminders'][number]['slot'], string, boolean][] = [];
    for (let hour = 8; hour < 20; hour += 1) {
      times.push(['custom', `${String(hour).padStart(2, '0')}:30`, true]);
    }
    // 12 times on 6 days is 72 alarms, where iOS will hold 64.
    const plan = planOf(times, { repeatDays: [0, 1, 2, 3, 4, 5] });

    const alarms = planReminderAlarms(plan, { now: WEDNESDAY_0800, budget: 20 });

    expect(alarms).toHaveLength(20);
    // Soonest kept: the first is today's 08:30, half an hour away.
    expect(alarms[0].time).toBe('08:30');
    expect(alarms[0].weekday).toBe(2);
    // And they are in order, so the far end of the week is what was lost.
    const timestamps = alarms.map(alarm => alarm.timestamp);
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
  });

  test('ids are stable, so re-scheduling the same plan replaces rather than adds', () => {
    const first = planReminderAlarms(PLAN, { now: WEDNESDAY_0800 });
    const again = planReminderAlarms(PLAN, { now: new Date(2026, 9, 14, 8, 30, 0, 0) });

    expect(again.map(alarm => alarm.id)).toEqual(first.map(alarm => alarm.id));
  });

  test('every id is Vokve’s own, so cancelling cannot touch another notification', () => {
    const alarms = planReminderAlarms(PLAN, { now: WEDNESDAY_0800 });

    expect(alarms.every(alarm => alarm.id.startsWith(ALARM_ID_PREFIX))).toBe(true);
  });
});
