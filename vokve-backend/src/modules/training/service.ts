import { getConfig } from '../../config/remote.js';
import { localDayOf } from '../../lib/dates.js';
import { workoutSchema, workoutTemplateSchema, exerciseSchema, type Workout, type WorkoutTemplate, type Exercise } from '../../contracts/index.js';
import { UserModel } from '../identity/models.js';
import { credit } from '../economy/service.js';
import { ActivityDailyModel } from '../activity/models.js';
import { ExerciseModel, WorkoutModel, WorkoutTemplateModel } from './models.js';

export async function listExercises(filter: { muscleGroup?: string; equipment?: string; q?: string }): Promise<Exercise[]> {
  const where: Record<string, unknown> = {};
  if (filter.muscleGroup) where.muscleGroup = filter.muscleGroup;
  if (filter.equipment) where.equipment = filter.equipment;
  if (filter.q) where.name = { $regex: filter.q, $options: 'i' };
  const rows = await ExerciseModel.find(where).sort({ name: 1 }).lean();
  return rows.map(r => exerciseSchema.parse({ id: r._id, name: r.name, muscleGroup: r.muscleGroup, equipment: r.equipment, isTimed: r.isTimed, imageUrl: r.imageUrl }));
}

export async function listTemplates(): Promise<WorkoutTemplate[]> {
  const templates = await WorkoutTemplateModel.find().sort({ sort: 1 }).lean();
  const ids = [...new Set(templates.flatMap(t => t.exerciseIds ?? []))];
  const exercises = new Map((await ExerciseModel.find({ _id: { $in: ids } }).lean()).map(e => [e._id, e]));
  return templates.map(t =>
    workoutTemplateSchema.parse({
      id: t._id, title: t.title, description: t.description, estimatedMinutes: t.estimatedMinutes, muscleGroups: t.muscleGroups,
      exercises: (t.exerciseIds ?? []).map(id => exercises.get(id)).filter(Boolean).map(e => ({
        id: e!._id, name: e!.name, muscleGroup: e!.muscleGroup, equipment: e!.equipment, isTimed: e!.isTimed, imageUrl: e!.imageUrl,
      })),
    }),
  );
}

/** Σ over completed sets of reps × kg — the client's `totalVolume`, recomputed here (RULES W2). */
export function totalVolumeKg(workout: Workout): number {
  return workout.exercises.reduce((sum, we) => sum + we.sets.reduce((s, set) => s + (set.completed ? set.reps * set.weightKg : 0), 0), 0);
}

/** Rough MET-based estimate: 6 MET resistance training × kg × hours (RULES W3). */
export function estimateCalories(workout: Workout, weightKg: number | null): number {
  const minutes = durationMinutes(workout);
  const kg = weightKg ?? 70;
  return Math.round(6 * kg * (minutes / 60));
}

export function durationMinutes(workout: Workout): number {
  if (!workout.completedAt) return 0;
  return Math.max(0, (new Date(workout.completedAt).getTime() - new Date(workout.startedAt).getTime()) / 60_000);
}

interface Plausibility { plausible: boolean; reason: string | null }

/** RULES W4: ≥ N minutes, ≥ 1 completed set, sane loads. Saved either way; only plausible ones pay or mark the streak. */
export async function checkPlausibility(workout: Workout): Promise<Plausibility> {
  const { coins } = await getConfig();
  const completedSets = workout.exercises.flatMap(e => e.sets).filter(s => s.completed);
  if (durationMinutes(workout) < coins.workoutMinMinutes) return { plausible: false, reason: `shorter than ${coins.workoutMinMinutes} minutes` };
  if (completedSets.length === 0) return { plausible: false, reason: 'no completed sets' };
  if (completedSets.some(s => s.weightKg > 500 || s.reps > 200)) return { plausible: false, reason: 'implausible load' };
  return { plausible: true, reason: null };
}

export interface SaveMeta { deviceId?: string; appVersion?: string; timezone: string }

/**
 * Idempotent upsert on the client's id (RULES W1). Pays the workout reward
 * through `economy.credit()` — which enforces the daily ceiling — and bumps
 * the day's `workoutsCompleted`.
 */
export async function saveWorkout(userId: string, input: Workout, meta: SaveMeta) {
  const user = await UserModel.findById(userId).lean();
  const completedAt = input.completedAt ?? new Date().toISOString();
  const normalised: Workout = { ...input, completedAt };
  const localDay = localDayOf(new Date(input.startedAt), meta.timezone);
  const volume = totalVolumeKg(normalised);
  const calories = estimateCalories(normalised, user?.weightKg ?? null);
  const { plausible, reason } = await checkPlausibility(normalised);

  const doc = await WorkoutModel.findOneAndUpdate(
    { _id: input.id, userId },
    {
      $setOnInsert: { _id: input.id, userId, deviceId: meta.deviceId },
      $set: { title: input.title, startedAt: new Date(input.startedAt), completedAt: new Date(completedAt), localDay,
        exercises: input.exercises, totalVolumeKg: volume, caloriesBurned: calories, plausible, implausibleReason: reason },
    },
    { upsert: true, new: true },
  ).lean();

  let reward: Awaited<ReturnType<typeof credit>> | null = null;
  if (plausible) {
    const { coins } = await getConfig();
    // Per-day count cap (RULES W5) is enforced by the source cap in coins; the count itself is informational.
    reward = await credit({
      userId, source: 'workout', referenceType: 'workout', referenceId: input.id, amount: coins.workout,
      title: `${input.title} completed`, localDay, actor: 'system', deviceId: meta.deviceId, appVersion: meta.appVersion,
    });
    if (reward.status === 'credited') {
      await ActivityDailyModel.updateOne(
        { _id: `${userId}:${localDay}` },
        { $setOnInsert: { _id: `${userId}:${localDay}`, userId, localDay }, $inc: { workoutsCompleted: 1, caloriesBurned: calories } },
        { upsert: true },
      );
    }
  }

  return { workout: toWorkout(doc!), reward };
}

export async function listWorkouts(userId: string, cursor: string | undefined, limit = 20) {
  const filter: Record<string, unknown> = { userId, deletedAt: null };
  if (cursor) filter.startedAt = { $lt: new Date(cursor) };
  const rows = await WorkoutModel.find(filter).sort({ startedAt: -1 }).limit(limit + 1).lean();
  const page = rows.slice(0, limit);
  return { data: page.map(toWorkout), nextCursor: rows.length > limit ? page[page.length - 1].startedAt.toISOString() : null };
}

function toWorkout(d: Record<string, any>): Workout {
  return workoutSchema.parse({
    id: d._id, title: d.title, startedAt: d.startedAt.toISOString(), completedAt: d.completedAt ? d.completedAt.toISOString() : null,
    exercises: d.exercises ?? [], totalVolumeKg: d.totalVolumeKg ?? 0, caloriesBurned: d.caloriesBurned ?? 0,
  });
}
