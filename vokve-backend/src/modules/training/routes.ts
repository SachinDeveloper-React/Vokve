import { Router } from 'express';
import { z } from 'zod';
import { workoutSchema, equipmentSchema, muscleGroupSchema } from '../../contracts/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { idempotent } from '../../middleware/idempotency.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { listExercises, listTemplates, listWorkouts, saveWorkout } from './service.js';

export const trainingRouter = Router();
trainingRouter.use(['/workouts', '/workout-templates', '/exercises'], requireAuth, requireDevice);

trainingRouter.get('/workout-templates', async (_req, res) => {
  res.json(await listTemplates());
});

const exercisesQuery = z.object({ muscleGroup: muscleGroupSchema.optional(), equipment: equipmentSchema.optional(), q: z.string().max(60).optional() });
trainingRouter.get('/exercises', validate('query', exercisesQuery), async (req, res) => {
  res.json({ data: await listExercises(req.query as never), nextCursor: null });
});

const pageQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
trainingRouter.get('/workouts', validate('query', pageQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof pageQuery>;
  res.json(await listWorkouts(req.ctx.userId!, q.cursor, q.limit));
});

/**
 * The times must be times: the day a workout counts on is read from
 * `startedAt`, and a string `Date` cannot read used to reach `localDayOf` and
 * throw there. The contract's own schema stays as the app has it.
 */
const isTime = (value: string | null) => value === null || (value.length <= 40 && Number.isFinite(Date.parse(value)));
const saveWorkoutBody = workoutSchema.superRefine((workout, ctx) => {
  if (!isTime(workout.startedAt)) ctx.addIssue({ code: 'custom', path: ['startedAt'], message: 'Not a date and time' });
  if (!isTime(workout.completedAt)) ctx.addIssue({ code: 'custom', path: ['completedAt'], message: 'Not a date and time' });
});

trainingRouter.post(
  '/workouts',
  // Far past anybody training, and a ceiling on scripted saves (security audit 2026-11-27, C-1).
  rateLimit({ name: 'workout-save-user', max: 60, windowSeconds: 3600, by: 'user' }),
  idempotent,
  validate('body', saveWorkoutBody),
  async (req, res) => {
    const result = await saveWorkout(req.ctx.userId!, req.body, { deviceId: req.ctx.deviceId, appVersion: req.ctx.appVersion, timezone: req.ctx.timezone });
    // The client's contract expects the Workout itself; the reward rides in a header so the shape stays exact.
    if (result.reward) res.setHeader('x-vokve-reward', JSON.stringify(result.reward));
    res.json(result.workout);
  },
);
