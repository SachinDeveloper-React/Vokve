import { Router } from 'express';
import { z } from 'zod';
import { isProduction } from '../../config/env.js';
import { localDayOf } from '../../lib/dates.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { idempotent } from '../../middleware/idempotency.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { activityGranularitySchema } from '../../contracts/index.js';
import { ingestBody, ingestSnapshot, issueIngestNonce } from './ingest.service.js';
import { clientActivityConfig, getRange, getSourcesReport } from './report.service.js';
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** How the phone's tracker is set up and when it syncs — the server's to change. */
activityRouter.get('/activity/config', async (_req, res) => {
  res.json(await clientActivityConfig());
});

/** Any one day, as `/activity/today` answers for today. */
activityRouter.get('/activity/day', validate('query', z.object({ date: isoDate })), async (req, res) => {
  res.json(await getDay(req.ctx.userId!, (req.query as unknown as { date: string }).date));
});

/** A period's steps at one grain (BACKEND §6.3). */
activityRouter.get(
  '/activity/range',
  validate('query', z.object({ from: isoDate, to: isoDate, granularity: activityGranularitySchema })),
  async (req, res) => {
    const { from, to, granularity } = req.query as unknown as { from: string; to: string; granularity: 'hour' | 'day' | 'week' | 'month' };
    res.json(await getRange(req.ctx.userId!, from, to, granularity));
  },
);

/** Where a day's steps came from, and how they were matched. */
activityRouter.get('/activity/sources', validate('query', z.object({ date: isoDate })), async (req, res) => {
  res.json(await getSourcesReport(req.ctx.userId!, (req.query as unknown as { date: string }).date, req.ctx.deviceId));
});

/**
 * The value the next signed snapshot carries (BACKEND §7.3). Generous limits:
 * a phone syncs today every few minutes while the app is open (⚙
 * `activity.sync`), and once more each time it comes back to the foreground
 * (RULES Z3).
 */
activityRouter.post(
  '/activity/ingest/nonce',
  rateLimit({ name: 'ingest-nonce', max: 120, windowSeconds: 3600, by: 'device' }),
  async (req, res) => {
    res.json(await issueIngestNonce(req.ctx.userId!, req.ctx.deviceId!));
  },
);

/** One day's signed snapshot — see `ingest.service.ts`. */
activityRouter.post(
  '/activity/ingest',
  rateLimit({ name: 'ingest', max: 120, windowSeconds: 3600, by: 'device' }),
  rateLimit({ name: 'ingest-user', max: 240, windowSeconds: 3600, by: 'user' }),
  validate('body', ingestBody),
  idempotent,
  async (req, res) => {
    res.json(
      await ingestSnapshot(
        { userId: req.ctx.userId!, deviceId: req.ctx.deviceId!, appVersion: req.ctx.appVersion, timezone: req.ctx.timezone },
        req.body,
      ),
    );
  },
);

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
