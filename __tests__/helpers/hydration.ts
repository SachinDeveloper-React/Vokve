import type { HydrationDay, HydrationEntry } from '../../src/types/models';
import { todayIso } from '../../src/utils/date';

/**
 * The limits the server sends with every day (RULES Y1b), at their defaults.
 *
 * A test that needs a different ceiling overrides the field it cares about
 * rather than restating all six — the point of the helper is that a new
 * limit added to the contract does not need touching in every fixture.
 */
export const TEST_WATER_LIMITS: HydrationDay['limits'] = {
  minMl: 10,
  maxMl: 3000,
  maxDailyMl: 10000,
  confirmAboveMl: 5000,
  hourlyMl: 1500,
  hourlyMinutes: 60,
};

/** A day as the server answers it: its drinks, and the usual limits. */
export function waterDay(
  entries: HydrationEntry[],
  date: string = todayIso(),
  overrides: Partial<HydrationDay> = {},
): HydrationDay {
  return {
    date,
    consumedMl: entries.reduce((sum, entry) => sum + entry.ml, 0),
    goalMl: 2500,
    entries,
    limits: TEST_WATER_LIMITS,
    caution: null,
    ...overrides,
  };
}
