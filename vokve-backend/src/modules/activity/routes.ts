import { Router } from 'express';
import { z } from 'zod';
import { isProduction } from '../../config/env.js';
import { localDayOf } from '../../lib/dates.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { validate } from '../../middleware/validate.js';
import { ActivityDailyModel } from './models.js';
import { creditStepsForDay, getDay, getWeek } from './service.js';

export const activityRouter = Router();
activityRouter.use(['/activity', '/dev'], requireAuth, requireDevice);

activityRouter.get('/activity/today', async (req, res) => {
  res.json(await getDay(req.ctx.userId!, localDayOf(new Date(), req.ctx.timezone)));
});

activityRouter.get('/activity/weekly', async (req, res) => {
  res.json(await getWeek(req.ctx.userId!, req.ctx.timezone));
});

/** Phase 2 lands the real ingest (attestation, provenance, layers). Until then: 501, honestly. */
activityRouter.post('/activity/ingest', (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Step sync is coming soon.', details: { phase: 2 } } });
});

/**
 * Dev only: set today's verified steps and run the credit path, so the cap,
 * escrow and wallet can be exercised without a phone. Absent in production.
 */
if (!isProduction) {
  const body = z.object({ steps: z.number().int().min(0).max(200_000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
  activityRouter.post('/dev/steps', validate('body', body), async (req, res) => {
    const localDay = req.body.date ?? localDayOf(new Date(), req.ctx.timezone);
    await ActivityDailyModel.updateOne(
      { _id: `${req.ctx.userId}:${localDay}` },
      { $setOnInsert: { _id: `${req.ctx.userId}:${localDay}`, userId: req.ctx.userId, localDay },
        $set: { steps: req.body.steps, verifiedSteps: req.body.steps, verified: true, source: 'manual', distanceKm: Math.round(req.body.steps * 0.00075 * 100) / 100 } },
      { upsert: true },
    );
    const result = await creditStepsForDay(req.ctx.userId!, localDay, req.body.steps, req.ctx.trustTier);
    res.json({ day: await getDay(req.ctx.userId!, localDay), result });
  });
}
