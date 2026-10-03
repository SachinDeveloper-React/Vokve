import { workoutApi } from '../services/api/endpoints';
import type { WorkoutTemplate } from '../types/models';
import { useServerRead, type Loaded } from './useServerRead';

/** The routine library (`GET /workout-templates`). */
export function useWorkoutTemplates(): Loaded<WorkoutTemplate[]> {
  return useServerRead('workout-templates', () => workoutApi.templates());
}
