import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { getBoard, getHistory, getRules } from './service.js';

export const leaderboardRouter = Router();
leaderboardRouter.use('/leaderboard', requireAuth, requireDevice);

/** This week's board for the caller's country, and their place on it (BACKEND §6.8). */
leaderboardRouter.get('/leaderboard', async (req, res) => {
  res.json(await getBoard(req.ctx.userId!));
});

/** The caller's record over closed weeks. */
leaderboardRouter.get('/leaderboard/history', async (req, res) => {
  res.json(await getHistory(req.ctx.userId!));
});

/** The prizes and how they are won, worded from the config in force. */
leaderboardRouter.get('/leaderboard/reward-tiers', async (req, res) => {
  res.json(await getRules(req.ctx.userId!));
});
