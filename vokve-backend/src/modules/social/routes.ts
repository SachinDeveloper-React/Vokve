import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { applyCode, getProgram, listReferrals } from './service.js';

export const socialRouter = Router();
socialRouter.use('/referrals', requireAuth, requireDevice);

/** Everything the Referral & Earn screen shows, in one call (BACKEND §6.13). */
socialRouter.get('/referrals/me', async (req, res) => {
  res.json(await getProgram(req.ctx.userId!, req.ctx.timezone));
});

const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

socialRouter.get('/referrals', validate('query', listQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listQuery>;
  res.json(await listReferrals(req.ctx.userId!, req.ctx.timezone, q.cursor, q.limit));
});

const applyBody = z.object({ code: z.string().trim().min(4).max(12) });

/**
 * Rate-limited per user: a code is seven characters from a 32-letter
 * alphabet, and a form that could be tried a thousand times an hour would
 * otherwise be a way to find one.
 */
socialRouter.post(
  '/referrals/apply',
  validate('body', applyBody),
  rateLimit({ name: 'referral-apply-user', max: 10, windowSeconds: 3600, by: 'user' }),
  async (req, res) => {
    res.json(await applyCode(req.ctx.userId!, req.body.code, req.ctx.timezone, req.ctx.deviceId));
  },
);
