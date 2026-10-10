import { hydrationApi } from '../services/api/endpoints';
import { useHydrationStore } from '../stores/hydrationStore';
import type { HydrationDay, HydrationHistory, HydrationStats } from '../types/models';
import { useServerRead, type Loaded } from './useServerRead';

/**
 * The water habit figures (`GET /hydration/stats`), asked again whenever
 * the server confirms a change to the day — a drink can complete a day at
 * the goal, and the best run with it.
 */
export function useHydrationStats(): Loaded<HydrationStats> {
  const syncedAt = useHydrationStore(s => s.syncedAt);
  return useServerRead('hydration:stats', () => hydrationApi.stats(), syncedAt);
}

/**
 * A span of past days and what it came to (`GET /hydration/history`), asked
 * again whenever the server confirms a change to today — a drink logged this
 * morning belongs in this history a moment later.
 *
 * Every figure in the answer is the server's arithmetic. The screen draws
 * them and does not recompute any of them: two places dividing by a
 * different denominator is how a history ends up disagreeing with the stats
 * card above it.
 */
export function useHydrationHistory(
  from: string,
  to: string,
): Loaded<HydrationHistory> {
  const syncedAt = useHydrationStore(s => s.syncedAt);
  return useServerRead(
    `hydration:history:${from}:${to}`,
    () => hydrationApi.history(from, to),
    syncedAt,
  );
}

/**
 * One past day's drinks (`GET /hydration/day`), for a row of the history
 * opened up. A null date skips the read, which is how the drawer stays
 * closed without a second hook.
 */
export function useHydrationDay(date: string | null): Loaded<HydrationDay> {
  const syncedAt = useHydrationStore(s => s.syncedAt);
  return useServerRead(
    date === null ? null : `hydration:day:${date}`,
    () => hydrationApi.day(date as string),
    syncedAt,
  );
}
