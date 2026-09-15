import { Router } from 'express';
import { z } from 'zod';
import { workoutSchema, equipmentSchema, muscleGroupSchema } from '../../contracts/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { idempotent } from '../../middleware/idempotency.js';
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

trainingRouter.post('/workouts', idempotent, validate('body', workoutSchema), async (req, res) => {
  const result = await saveWorkout(req.ctx.userId!, req.body, { deviceId: req.ctx.deviceId, appVersion: req.ctx.appVersion, timezone: req.ctx.timezone });
  // The client's contract expects the Workout itself; the reward rides in a header so the shape stays exact.
  if (result.reward) res.setHeader('x-vokve-reward', JSON.stringify(result.reward));
  res.json(result.workout);
});
