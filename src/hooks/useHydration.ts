import { hydrationApi } from '../services/api/endpoints';
import { useHydrationStore } from '../stores/hydrationStore';
import type { HydrationStats } from '../types/models';
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
