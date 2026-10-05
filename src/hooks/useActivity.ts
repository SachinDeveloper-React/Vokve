import type { ActivityRangeQuery } from '../services/api/contracts';
import { activityApi } from '../services/api/endpoints';
import type {
  ActivityRange,
  DailyActivity,
  StepGoal,
  StepSourcesReport,
} from '../types/models';
import { useServerRead, type Loaded } from './useServerRead';

export type { Loaded } from './useServerRead';

/** A period's steps at one grain (`GET /activity/range`); null skips the read. */
export function useActivityRange(
  query: ActivityRangeQuery | null,
): Loaded<ActivityRange> {
  const key = query ? `${query.granularity}:${query.from}:${query.to}` : null;
  return useServerRead(key, () => activityApi.range(query!));
}

/** One day as the server holds it (`GET /activity/day`). */
export function useActivityDay(date: string): Loaded<DailyActivity> {
  return useServerRead(`day:${date}`, () => activityApi.day(date));
}

/** Where a day's steps came from, and how they were matched (`GET /activity/sources`). */
export function useStepSources(date: string): Loaded<StepSourcesReport> {
  return useServerRead(`sources:${date}`, () => activityApi.sources(date));
}

/**
 * The step goal, the one the server suggests and the range a goal may be
 * set in (`GET /activity/goal`, D-55).
 */
export function useStepGoal(): Loaded<StepGoal> {
  return useServerRead('step-goal', () => activityApi.goal());
}
