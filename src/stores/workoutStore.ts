import { produce } from 'immer';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { workoutApi } from '../services/api/endpoints';
import { toApiError, type ApiError } from '../services/api/errors';
import type { Exercise, Workout, WorkoutSet } from '../types/models';
import { logger } from '../utils/logger';
import { mmkvStorage } from './index';

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function totalVolume(workout: Workout): number {
  return workout.exercises.reduce(
    (sum, we) =>
      sum +
      we.sets.reduce(
        (setSum, set) => setSum + (set.completed ? set.reps * set.weightKg : 0),
        0,
      ),
    0,
  );
}

interface WorkoutState {
  /** The session the user is in right now, if any. */
  active: Workout | null;
  history: Workout[];
  isSyncing: boolean;
  error: ApiError | null;

  startWorkout: (title: string) => void;
  addExercise: (exercise: Exercise) => void;
  addSet: (workoutExerciseId: string) => void;
  updateSet: (
    workoutExerciseId: string,
    setId: string,
    patch: Partial<WorkoutSet>,
  ) => void;
  removeExercise: (workoutExerciseId: string) => void;
  finishWorkout: () => Promise<void>;
  discardWorkout: () => void;
  loadHistory: () => Promise<void>;
}

/**
 * The active session is persisted so that a crash, a force-quit or an OS
 * memory kill mid-workout does not lose the sets the user already logged —
 * the single most damaging failure this kind of app can have.
 *
 * Nested set updates go through immer's `produce` rather than hand-written
 * spreads: the exercise -> sets -> field path is deep enough that manual
 * copying is where bugs hide.
 */
export const useWorkoutStore = create<WorkoutState>()(
  persist(
    (set, get) => ({
      active: null,
      history: [],
      isSyncing: false,
      error: null,

      startWorkout: title =>
        set({
          active: {
            id: createId(),
            title,
            startedAt: new Date().toISOString(),
            completedAt: null,
            exercises: [],
            totalVolumeKg: 0,
            caloriesBurned: 0,
          },
        }),

      addExercise: exercise =>
        set(
          produce((state: WorkoutState) => {
            if (!state.active) return;
            state.active.exercises.push({
              id: createId(),
              exercise,
              sets: [],
              restSeconds: 90,
              notes: null,
            });
          }),
        ),

      addSet: workoutExerciseId =>
        set(
          produce((state: WorkoutState) => {
            const target = state.active?.exercises.find(
              e => e.id === workoutExerciseId,
            );
            if (!target) return;

            // New sets inherit the previous set's load — that is what the user
            // is about to do again far more often than not.
            const previous = target.sets[target.sets.length - 1];
            target.sets.push({
              id: createId(),
              reps: previous?.reps ?? 0,
              weightKg: previous?.weightKg ?? 0,
              rpe: null,
              durationSeconds: null,
              completed: false,
            });
          }),
        ),

      updateSet: (workoutExerciseId, setId, patch) =>
        set(
          produce((state: WorkoutState) => {
            const target = state.active?.exercises.find(
              e => e.id === workoutExerciseId,
            );
            const targetSet = target?.sets.find(s => s.id === setId);
            if (!targetSet || !state.active) return;

            Object.assign(targetSet, patch);
            state.active.totalVolumeKg = totalVolume(state.active);
          }),
        ),

      removeExercise: workoutExerciseId =>
        set(
          produce((state: WorkoutState) => {
            if (!state.active) return;
            state.active.exercises = state.active.exercises.filter(
              e => e.id !== workoutExerciseId,
            );
            state.active.totalVolumeKg = totalVolume(state.active);
          }),
        ),

      finishWorkout: async () => {
        const active = get().active;
        if (!active) return;

        const finished: Workout = {
          ...active,
          completedAt: new Date().toISOString(),
          totalVolumeKg: totalVolume(active),
        };

        // Record it locally first. If the upload fails the session is still
        // in history and can be retried, rather than silently lost.
        set(state => ({
          active: null,
          history: [finished, ...state.history],
          isSyncing: true,
          error: null,
        }));

        try {
          const saved = await workoutApi.save(finished);
          set(state => ({
            isSyncing: false,
            history: state.history.map(w => (w.id === saved.id ? saved : w)),
          }));
        } catch (error) {
          logger.warn('workoutStore', 'Workout upload failed, kept locally', error);
          set({ isSyncing: false, error: toApiError(error) });
        }
      },

      discardWorkout: () => set({ active: null }),

      loadHistory: async () => {
        set({ isSyncing: true, error: null });
        try {
          const page = await workoutApi.history();
          set({ history: page.data, isSyncing: false });
        } catch (error) {
          set({ error: toApiError(error), isSyncing: false });
        }
      },
    }),
    {
      name: 'vokve.workouts',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      // Transient request state has no business surviving a relaunch.
      partialize: state => ({ active: state.active, history: state.history }),
    },
  ),
);

export const useActiveWorkout = () => useWorkoutStore(s => s.active);
export const useWorkoutHistory = () => useWorkoutStore(s => s.history);
