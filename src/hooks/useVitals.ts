import { vitalsApi } from '../services/api/endpoints';
import { useVitalsStore } from '../stores/vitalsStore';
import type { HealthScore } from '../types/models';
import { useServerRead, type Loaded } from './useServerRead';

/**
 * The health score (`GET /health/score`), asked again whenever the server
 * confirms a reading — a new blood pressure can move it.
 */
export function useHealthScore(): Loaded<HealthScore> {
  const confirmedAt = useVitalsStore(s => s.confirmedAt);
  return useServerRead('health:score', () => vitalsApi.score(), confirmedAt);
}
