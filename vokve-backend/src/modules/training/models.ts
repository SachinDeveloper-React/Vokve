import { Schema, model } from 'mongoose';

const exerciseSchema = new Schema(
  { _id: { type: String, required: true }, name: String, muscleGroup: String, equipment: String, isTimed: { type: Boolean, default: false }, imageUrl: { type: String, default: null } },
  { collection: 'exercises', versionKey: false },
);
export const ExerciseModel = model('Exercise', exerciseSchema);

const templateSchema = new Schema(
  { _id: { type: String, required: true }, title: String, description: { type: String, default: '' }, estimatedMinutes: Number, muscleGroups: [String], exerciseIds: [String], sort: { type: Number, default: 0 } },
  { collection: 'workout_templates', versionKey: false },
);
export const WorkoutTemplateModel = model('WorkoutTemplate', templateSchema);

const workoutSchema = new Schema(
  {
    _id: { type: String, required: true }, // client-generated
    userId: { type: String, required: true },
    title: { type: String, required: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    localDay: { type: String, required: true },
    exercises: { type: Schema.Types.Mixed, default: [] },
    totalVolumeKg: { type: Number, default: 0 },
    caloriesBurned: { type: Number, default: 0 },
    plausible: { type: Boolean, default: true },
    implausibleReason: { type: String, default: null },
    deviceId: String,
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'workouts' },
);
workoutSchema.index({ userId: 1, startedAt: -1 });
export const WorkoutModel = model('Workout', workoutSchema);
