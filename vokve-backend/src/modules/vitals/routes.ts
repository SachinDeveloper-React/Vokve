import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { ENTERED_VITAL_KINDS } from './models.js';
import { deleteReading, healthScore, latestVitals, listReadings, logReading } from './service.js';

export const vitalsRouter = Router();
vitalsRouter.use(['/vitals', '/health/score'], requireAuth, requireDevice);

const listQuery = z.object({
  kind: z.enum(ENTERED_VITAL_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** The newest readings, of one kind or all (BACKEND §6.12). */
vitalsRouter.get('/vitals', validate('query', listQuery), async (req, res) => {
  const { kind, limit } = req.query as unknown as z.infer<typeof listQuery>;
  res.json(await listReadings(req.ctx.userId!, kind, limit));
});

/** The newest of each kind, and the BMI derived from them (RULES V3). */
vitalsRouter.get('/vitals/latest', async (req, res) => {
  res.json(await latestVitals(req.ctx.userId!));
});

const readingBody = z.object({
  id: z.string().trim().min(1).max(64),
  // BMI is never entered (RULES V1).
  kind: z.enum(ENTERED_VITAL_KINDS),
  value: z.number(),
  secondary: z.number().nullable().optional(),
  recordedAt: z.string().datetime({ offset: true }).optional(),
});

/** Logs a reading; idempotent on the app's id (RULES V1, V2, V4). */
vitalsRouter.post('/vitals', idempotent, validate('body', readingBody), async (req, res) => {
  res.json(await logReading(req.ctx.userId!, req.body));
});

vitalsRouter.delete('/vitals/:id', idempotent, async (req, res) => {
  await deleteReading(req.ctx.userId!, String(req.params.id));
  res.json({ ok: true });
});

/** One number for how the member is doing, and what made it (RULES V8). */
vitalsRouter.get('/health/score', async (req, res) => {
  res.json(await healthScore(req.ctx.userId!, req.ctx.timezone));
});
