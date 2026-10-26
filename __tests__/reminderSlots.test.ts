/**
 * What a block of the reminder plan will take (RULES Y5).
 *
 * A block is a part of the day, so its times are in that part of the day:
 * the picker is pinned to one half of the clock per block, and each block
 * holds a bounded number of times. Both rules exist in two places — here and
 * in the server's own `hydration.maxRemindersPerSlot` — so the checks are
 * about the half, the cap, and the wording the screen says them in.
 *
 * @format
 */

import {
  MAX_PLAN_TIMES,
  PRESET_SLOTS,
  SLOT_RULES,
  clampTimeToSlot,
  isTimeInSlot,
  mergeSlotRules,
  slotFullMessage,
  slotPeriodNote,
} from '../src/constants/reminderSlots';

describe('which half of the clock a block takes', () => {
  test('morning is AM, afternoon and evening are PM', () => {
    expect(SLOT_RULES.morning.period).toBe('am');
    expect(SLOT_RULES.afternoon.period).toBe('pm');
    expect(SLOT_RULES.evening.period).toBe('pm');
    // The way out of all three.
    expect(SLOT_RULES.custom.period).toBe('any');
  });

  test('a time is in its block, or it is not', () => {
    expect(isTimeInSlot('07:00', 'morning')).toBe(true);
    expect(isTimeInSlot('11:59', 'morning')).toBe(true);
    // Noon is the first PM minute, which is what makes 12:30 an afternoon
    // time and not a morning one.
    expect(isTimeInSlot('12:00', 'morning')).toBe(false);
    expect(isTimeInSlot('19:00', 'morning')).toBe(false);

    expect(isTimeInSlot('12:00', 'afternoon')).toBe(true);
    expect(isTimeInSlot('23:30', 'evening')).toBe(true);
    expect(isTimeInSlot('09:00', 'evening')).toBe(false);

    // A custom time is any time; that is the whole point of it.
    expect(isTimeInSlot('03:00', 'custom')).toBe(true);
    expect(isTimeInSlot('15:00', 'custom')).toBe(true);
  });

  test('a midnight hour reads as AM and noon as PM, not the other way round', () => {
    expect(isTimeInSlot('00:30', 'morning')).toBe(true);
    expect(isTimeInSlot('00:30', 'evening')).toBe(false);
    expect(isTimeInSlot('12:45', 'evening')).toBe(true);
  });
});

describe('clampTimeToSlot', () => {
  test('leaves a time its block already takes', () => {
    expect(clampTimeToSlot('07:30', 'morning')).toBe('07:30');
    expect(clampTimeToSlot('18:00', 'evening')).toBe('18:00');
    expect(clampTimeToSlot('03:00', 'custom')).toBe('03:00');
  });

  test('moves one from the other half, keeping the hour on the face', () => {
    // A plan written before the rule can hold 1 PM in the morning block, and
    // the editor opening on 01:00 is how the user is shown what it now takes.
    expect(clampTimeToSlot('13:00', 'morning')).toBe('01:00');
    expect(clampTimeToSlot('09:15', 'evening')).toBe('21:15');
    expect(clampTimeToSlot('23:45', 'morning')).toBe('11:45');
  });

  test('falls back to the block’s own hour for a time it cannot read', () => {
    expect(clampTimeToSlot('nonsense', 'afternoon')).toBe(
      SLOT_RULES.afternoon.defaultTime,
    );
  });

  test('every block opens on an hour it would accept', () => {
    for (const slot of [...PRESET_SLOTS, 'custom'] as const) {
      expect(isTimeInSlot(SLOT_RULES[slot].defaultTime, slot)).toBe(true);
    }
  });
});

describe('what the screen says about it', () => {
  test('the note names the half and offers the way round it', () => {
    expect(slotPeriodNote('morning')).toContain('AM');
    expect(slotPeriodNote('morning')).toContain('custom time');
    expect(slotPeriodNote('evening')).toContain('PM');
    // Nothing to explain where any time will do.
    expect(slotPeriodNote('custom')).toBeUndefined();
  });

  test('a full block says how many it holds and what to do instead', () => {
    const message = slotFullMessage('morning');

    expect(message).toContain('Morning');
    expect(message).toContain(String(SLOT_RULES.morning.maxTimes));
    expect(message).toContain('custom time');
  });
});

describe('the caps themselves', () => {
  test('each part of the day holds five times', () => {
    for (const slot of PRESET_SLOTS) {
      expect(SLOT_RULES[slot].maxTimes).toBe(5);
    }
  });

  test('a block never holds more than the whole plan may', () => {
    for (const slot of [...PRESET_SLOTS, 'custom'] as const) {
      expect(SLOT_RULES[slot].maxTimes).toBeLessThanOrEqual(MAX_PLAN_TIMES);
      expect(SLOT_RULES[slot].maxTimes).toBeGreaterThan(0);
    }
  });

  test('the three blocks together leave room for a custom time or two', () => {
    const presets = PRESET_SLOTS.reduce(
      (sum, slot) => sum + SLOT_RULES[slot].maxTimes,
      0,
    );

    expect(presets).toBeLessThan(MAX_PLAN_TIMES);
  });
});

/**
 * The server owns both numbers (RULES Y5b).
 *
 * The halves and the caps arrive with the plan (⚙ `hydration.*`) so they can
 * be re-cut from the panel without a release. What is written in the app is
 * the fallback — for the plan that has not arrived, the server that is older
 * than the field, and offline.
 */
describe('mergeSlotRules', () => {
  test('this build’s rules stand in when the plan carried none', () => {
    expect(mergeSlotRules(undefined)).toBe(SLOT_RULES);
  });

  test('the server’s half and cap win where it sent them', () => {
    const rules = mergeSlotRules({
      morning: { period: 'am', maxTimes: 8 },
      afternoon: { period: 'pm', maxTimes: 8 },
      evening: { period: 'any', maxTimes: 3 },
      custom: { period: 'any', maxTimes: 40 },
    });

    expect(rules.morning.maxTimes).toBe(8);
    expect(rules.evening).toMatchObject({ period: 'any', maxTimes: 3 });
    expect(rules.custom.maxTimes).toBe(40);
    // The name and the opening hour are copy, not policy: they stay the
    // app's.
    expect(rules.morning.title).toBe(SLOT_RULES.morning.title);
  });

  test('a re-cut block’s picker cannot open on an hour it would refuse', () => {
    const rules = mergeSlotRules({
      // Evening moved to the morning half: 19:00 is no longer a time it
      // takes, so the hour it opens on moves with it.
      morning: SLOT_RULES.morning,
      afternoon: SLOT_RULES.afternoon,
      evening: { period: 'am', maxTimes: 5 },
      custom: { period: 'any', maxTimes: 24 },
    });

    expect(rules.evening.defaultTime).toBe('07:00');
    expect(isTimeInSlot(rules.evening.defaultTime, 'evening', rules)).toBe(
      true,
    );
  });

  test('the helpers read the rules they are given, not the constant', () => {
    const rules = mergeSlotRules({
      morning: { period: 'pm', maxTimes: 2 },
      afternoon: SLOT_RULES.afternoon,
      evening: SLOT_RULES.evening,
      custom: SLOT_RULES.custom,
    });

    expect(isTimeInSlot('19:00', 'morning', rules)).toBe(true);
    expect(isTimeInSlot('07:00', 'morning', rules)).toBe(false);
    expect(clampTimeToSlot('07:30', 'morning', rules)).toBe('19:30');
    expect(slotPeriodNote('morning', rules)).toContain('PM');
    expect(slotFullMessage('morning', rules)).toContain('2 times');
  });
});
