import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { idempotent } from '../../middleware/idempotency.js';
import { freezeToday, getStreak, restoreStreak } from './service.js';

export const streakRouter = Router();
streakRouter.use('/streak', requireAuth, requireDevice);

/** Everything the streak screen shows, in one call (BACKEND §6.5). */
streakRouter.get('/streak', async (req, res) => {
  res.json(await getStreak(req.ctx.userId!, req.ctx.timezone));
});

/** Spends a freeze on today; refused with nothing spent when it cannot help (RULES S4). */
streakRouter.post('/streak/freeze', idempotent, async (req, res) => {
  res.json(await freezeToday(req.ctx.userId!, req.ctx.timezone));
});

/** Bridges the last gap for coins — the debit and the days in one transaction (RULES S6, S7). */
streakRouter.post('/streak/restore', idempotent, async (req, res) => {
  const { userId, timezone, idempotencyKey, deviceId, appVersion } = req.ctx;
  res.json(await restoreStreak(userId!, timezone, { idempotencyKey, deviceId, appVersion }));
});
