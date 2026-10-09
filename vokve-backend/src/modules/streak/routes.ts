import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { freezeToday, getStreak, getStreakHistory, restoreStreak } from './service.js';

export const streakRouter = Router();
streakRouter.use('/streak', requireAuth, requireDevice);

/** Everything the streak screen shows, in one call (BACKEND §6.5). */
streakRouter.get('/streak', async (req, res) => {
  res.json(await getStreak(req.ctx.userId!, req.ctx.timezone));
});

const historyQuery = z.object({
  cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** The streak's record, newest first, missed days filled in (BACKEND §6.5). */
streakRouter.get('/streak/history', validate('query', historyQuery), async (req, res) => {
  const { cursor, limit } = req.query as z.infer<typeof historyQuery>;
  res.json(await getStreakHistory(req.ctx.userId!, req.ctx.timezone, { cursor, limit }));
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
