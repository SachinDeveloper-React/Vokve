import { Router } from 'express';
import { z } from 'zod';
import { localDayOf } from '../../lib/dates.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { validate } from '../../middleware/validate.js';
import { getAchievements, getChallenges } from './service.js';

export const challengesRouter = Router();
challengesRouter.use(['/challenges', '/achievements'], requireAuth, requireDevice);

const boardQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional(),
});

/** The board for a day — today in the caller's zone unless one is named (BACKEND §6.7). */
challengesRouter.get('/challenges', validate('query', boardQuery), async (req, res) => {
  const { date } = req.query as z.infer<typeof boardQuery>;
  res.json(await getChallenges(req.ctx.userId!, date ?? localDayOf(new Date(), req.ctx.timezone)));
});

challengesRouter.get('/achievements', async (req, res) => {
  res.json(await getAchievements(req.ctx.userId!));
});
