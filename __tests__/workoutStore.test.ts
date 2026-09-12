/**
 * @format
 */

import { useWorkoutStore } from '../src/stores/workoutStore';
import type { Exercise } from '../src/types/models';

const squat: Exercise = {
  id: 'squat',
  name: 'Back Squat',
  muscleGroup: 'legs',
  equipment: 'barbell',
  isTimed: false,
  imageUrl: null,
};

beforeEach(() => {
  useWorkoutStore.setState({
    active: null,
    history: [],
    isSyncing: false,
    error: null,
  });
});

test('a new set inherits the previous set’s load', () => {
  const store = useWorkoutStore.getState();
  store.startWorkout('Leg Day');
  store.addExercise(squat);

  const entryId = useWorkoutStore.getState().active!.exercises[0].id;
  useWorkoutStore.getState().addSet(entryId);
  useWorkoutStore
    .getState()
    .updateSet(entryId, useWorkoutStore.getState().active!.exercises[0].sets[0].id, {
      reps: 5,
      weightKg: 100,
    });
  useWorkoutStore.getState().addSet(entryId);

  const sets = useWorkoutStore.getState().active!.exercises[0].sets;
  expect(sets).toHaveLength(2);
  expect(sets[1].reps).toBe(5);
  expect(sets[1].weightKg).toBe(100);
  expect(sets[1].completed).toBe(false);
});

test('volume counts completed sets only', () => {
  const store = useWorkoutStore.getState();
  store.startWorkout('Leg Day');
  store.addExercise(squat);

  const entryId = useWorkoutStore.getState().active!.exercises[0].id;
  useWorkoutStore.getState().addSet(entryId);
  const setId = useWorkoutStore.getState().active!.exercises[0].sets[0].id;

  useWorkoutStore
    .getState()
    .updateSet(entryId, setId, { reps: 5, weightKg: 100, completed: false });
  expect(useWorkoutStore.getState().active!.totalVolumeKg).toBe(0);

  useWorkoutStore.getState().updateSet(entryId, setId, { completed: true });
  expect(useWorkoutStore.getState().active!.totalVolumeKg).toBe(500);
});

test('removing an exercise recalculates volume', () => {
  const store = useWorkoutStore.getState();
  store.startWorkout('Leg Day');
  store.addExercise(squat);

  const entryId = useWorkoutStore.getState().active!.exercises[0].id;
  useWorkoutStore.getState().addSet(entryId);
  const setId = useWorkoutStore.getState().active!.exercises[0].sets[0].id;
  useWorkoutStore
    .getState()
    .updateSet(entryId, setId, { reps: 5, weightKg: 100, completed: true });

  useWorkoutStore.getState().removeExercise(entryId);

  expect(useWorkoutStore.getState().active!.exercises).toHaveLength(0);
  expect(useWorkoutStore.getState().active!.totalVolumeKg).toBe(0);
});
