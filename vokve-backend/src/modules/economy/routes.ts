import { Router } from 'express';
import { z } from 'zod';
import { isProduction } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { validate } from '../../middleware/validate.js';
import { COIN_SOURCES } from './models.js';
import { earnRules, expireIdleWallets, getWallet, listTransactions } from './wallet.service.js';

export const walletRouter = Router();
walletRouter.use('/wallet', requireAuth, requireDevice);

walletRouter.get('/wallet', async (req, res) => {
  res.json(await getWallet(req.ctx.userId!, req.ctx.timezone));
});

const txQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  source: z.enum(COIN_SOURCES).optional(),
});

walletRouter.get('/wallet/transactions', validate('query', txQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof txQuery>;
  res.json(await listTransactions(req.ctx.userId!, q.cursor, q.limit, q.source));
});

walletRouter.get('/wallet/earn-rules', async (_req, res) => {
  res.json({ data: await earnRules(), nextCursor: null });
});

/**
 * Dev only: run the idle-expiry sweep now, optionally as of a later date, so
 * the wallet's "your coins expired" path can be seen without waiting ninety
 * days. Absent in production — the scheduler is the only caller there.
 */
if (!isProduction) {
  const body = z.object({ now: z.string().datetime().optional() });
  walletRouter.post('/dev/jobs/coin-expiry', requireAuth, requireDevice, validate('body', body), async (req, res) => {
    const now = req.body.now ? new Date(req.body.now) : new Date();
    res.json(await expireIdleWallets(now));
  });
}
