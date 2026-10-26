import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { validate } from '../../middleware/validate.js';
import { getBoard, getHistory, getRules } from './service.js';

export const leaderboardRouter = Router();
leaderboardRouter.use('/leaderboard', requireAuth, requireDevice);

/**
 * A page of the board. Both are clipped to ⚙ `leaderboard.boardSize` in the
 * service, so an app cannot walk past the last place the board holds — and a
 * call with neither gets the whole board, which is what an installed build
 * does (X2).
 */
const boardQuery = z.object({
  offset: z.coerce.number().int().min(0).max(1_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** This week's board for the caller's country, and their place on it (BACKEND §6.8). */
leaderboardRouter.get('/leaderboard', validate('query', boardQuery), async (req, res) => {
  const page = req.query as unknown as z.infer<typeof boardQuery>;
  res.json(await getBoard(req.ctx.userId!, { offset: page.offset, limit: page.limit }));
});

/** The caller's record over closed weeks. */
leaderboardRouter.get('/leaderboard/history', async (req, res) => {
  res.json(await getHistory(req.ctx.userId!));
});

/** The prizes and how they are won, worded from the config in force. */
leaderboardRouter.get('/leaderboard/reward-tiers', async (req, res) => {
  res.json(await getRules(req.ctx.userId!));
});
