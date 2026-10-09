import { Router } from 'express';
import { z } from 'zod';
import { localDayOf } from '../../lib/dates.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { validate } from '../../middleware/validate.js';
import {
  getAchievementDetail,
  getAchievements,
  getChallengeDetail,
  getChallenges,
} from './service.js';

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

/**
 * One challenge in full for the day (BACKEND §6.7) — the board's row plus the
 * day's share of the goal, the rule sheet, the standings and the reward.
 * 404 for a challenge that is not in the catalogue or has been retired.
 */
challengesRouter.get('/challenges/:id', validate('query', boardQuery), async (req, res) => {
  const { date } = req.query as z.infer<typeof boardQuery>;
  res.json(
    await getChallengeDetail(
      req.ctx.userId!,
      req.params.id as string,
      date ?? localDayOf(new Date(), req.ctx.timezone),
      req.ctx.timezone,
    ),
  );
});

challengesRouter.get('/achievements', async (req, res) => {
  res.json(await getAchievements(req.ctx.userId!));
});

/**
 * One badge in full (BACKEND §6.7) — what it takes, the member's own best
 * against it, what it pays and the rest of its family. 404 for a badge that
 * is not in the catalogue.
 */
challengesRouter.get('/achievements/:id', async (req, res) => {
  res.json(await getAchievementDetail(req.ctx.userId!, req.params.id as string, req.ctx.timezone));
});
