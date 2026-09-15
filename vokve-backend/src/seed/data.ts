/**
 * Catalogue fixtures, copied from the client's `seedData.workoutTemplates` so
 * a fresh database renders the same Workouts screen the mock did. Exercises
 * are flattened once — templates reference them by id.
 */
export const EXERCISES = [
  { _id: 'bench', name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell', isTimed: false },
  { _id: 'ohp', name: 'Overhead Press', muscleGroup: 'shoulders', equipment: 'barbell', isTimed: false },
  { _id: 'incline-db', name: 'Incline Dumbbell Press', muscleGroup: 'chest', equipment: 'dumbbell', isTimed: false },
  { _id: 'pushdown', name: 'Cable Tricep Pushdown', muscleGroup: 'triceps', equipment: 'cable', isTimed: false },
  { _id: 'deadlift', name: 'Deadlift', muscleGroup: 'back', equipment: 'barbell', isTimed: false },
  { _id: 'pullup', name: 'Pull-up', muscleGroup: 'back', equipment: 'bodyweight', isTimed: false },
  { _id: 'row', name: 'Barbell Row', muscleGroup: 'back', equipment: 'barbell', isTimed: false },
  { _id: 'curl', name: 'Dumbbell Curl', muscleGroup: 'biceps', equipment: 'dumbbell', isTimed: false },
  { _id: 'squat', name: 'Back Squat', muscleGroup: 'legs', equipment: 'barbell', isTimed: false },
  { _id: 'rdl', name: 'Romanian Deadlift', muscleGroup: 'glutes', equipment: 'barbell', isTimed: false },
  { _id: 'legpress', name: 'Leg Press', muscleGroup: 'legs', equipment: 'machine', isTimed: false },
  { _id: 'plank', name: 'Plank', muscleGroup: 'core', equipment: 'bodyweight', isTimed: true },
  { _id: 'row-erg', name: 'Rowing Intervals', muscleGroup: 'cardio', equipment: 'machine', isTimed: true },
  { _id: 'burpee', name: 'Burpees', muscleGroup: 'full_body', equipment: 'bodyweight', isTimed: true },
  { _id: 'goblet-squat', name: 'Goblet Squat', muscleGroup: 'legs', equipment: 'kettlebell', isTimed: false },
  { _id: 'band-pull-apart', name: 'Band Pull-Apart', muscleGroup: 'shoulders', equipment: 'band', isTimed: false },
  { _id: 'lat-pulldown', name: 'Lat Pulldown', muscleGroup: 'back', equipment: 'cable', isTimed: false },
  { _id: 'lunge', name: 'Walking Lunge', muscleGroup: 'legs', equipment: 'bodyweight', isTimed: false },
];

export const WORKOUT_TEMPLATES = [
  { _id: 'push-day', title: 'Push Day', description: 'Chest, shoulders and triceps. Heavy compounds first.', estimatedMinutes: 55,
    muscleGroups: ['chest', 'shoulders', 'triceps'], exerciseIds: ['bench', 'ohp', 'incline-db', 'pushdown'], sort: 1 },
  { _id: 'pull-day', title: 'Pull Day', description: 'Back and biceps, built around the deadlift.', estimatedMinutes: 60,
    muscleGroups: ['back', 'biceps'], exerciseIds: ['deadlift', 'pullup', 'row', 'curl'], sort: 2 },
  { _id: 'leg-day', title: 'Leg Day', description: 'Squat-focused lower body with posterior chain work.', estimatedMinutes: 65,
    muscleGroups: ['legs', 'glutes', 'core'], exerciseIds: ['squat', 'rdl', 'legpress', 'plank'], sort: 3 },
  { _id: 'conditioning', title: 'Conditioning', description: 'Twenty minutes of intervals to finish the week.', estimatedMinutes: 25,
    muscleGroups: ['cardio', 'full_body'], exerciseIds: ['row-erg', 'burpee'], sort: 4 },
];

export const APP_RELEASES = [
  { platform: 'ios', version: '1.0.0', build: '1', status: 'current', releasedAt: new Date('2026-09-01') },
  { platform: 'android', version: '1.0.0', build: '1', status: 'current', releasedAt: new Date('2026-09-01') },
];
