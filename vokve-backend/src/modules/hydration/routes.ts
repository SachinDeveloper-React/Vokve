import { Router } from 'express';
import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { hydrationReminderPlanSchema } from '../../contracts/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { Errors } from '../../lib/errors.js';
import {
  deleteDrink,
  getHydrationDays,
  getHydrationStats,
  getHydrationToday,
  getReminderPlan,
  logDrink,
  putReminderPlan,
} from './service.js';

export const hydrationRouter = Router();
hydrationRouter.use('/hydration', requireAuth, requireDevice);

/** Today's water in the caller's zone (BACKEND §6.10). */
hydrationRouter.get('/hydration/today', async (req, res) => {
  res.json(await getHydrationToday(req.ctx.userId!, req.ctx.timezone));
});

const drinkBody = z.object({
  id: z.string().trim().min(1).max(64),
  ml: z.number().int(),
  at: z.string().datetime({ offset: true }).optional(),
});

/** Logs a drink; idempotent on the app's id. Answers the day it landed on. */
hydrationRouter.post('/hydration/entries', idempotent, validate('body', drinkBody), async (req, res) => {
  const { hydration } = await getConfig();
  const body = req.body as z.infer<typeof drinkBody>;
  if (body.ml < hydration.minMl || body.ml > hydration.maxMl) {
    throw Errors.validation({ ml: `Log between ${hydration.minMl} and ${hydration.maxMl} ml.` });
  }
  res.json(await logDrink(req.ctx.userId!, body, req.ctx.timezone));
});

hydrationRouter.delete('/hydration/entries/:id', idempotent, async (req, res) => {
  res.json(await deleteDrink(req.ctx.userId!, String(req.params.id)));
});

hydrationRouter.get('/hydration/stats', async (req, res) => {
  res.json(await getHydrationStats(req.ctx.userId!, req.ctx.timezone));
});

const daysQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

hydrationRouter.get('/hydration/days', validate('query', daysQuery), async (req, res) => {
  const { from, to } = req.query as z.infer<typeof daysQuery>;
  res.json(await getHydrationDays(req.ctx.userId!, from, to));
});

hydrationRouter.get('/hydration/reminders', async (req, res) => {
  res.json(await getReminderPlan(req.ctx.userId!));
});

const planBody = hydrationReminderPlanSchema.extend({
  reminders: z.array(
    z.object({
      id: z.string().trim().min(1).max(64),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm.'),
      slot: z.enum(['morning', 'afternoon', 'evening', 'custom']),
      enabled: z.boolean(),
    }),
  ).max(200),
  sound: z.string().trim().min(1).max(40),
});

/** Replaces the whole plan (RULES Y5). */
hydrationRouter.put('/hydration/reminders', idempotent, validate('body', planBody), async (req, res) => {
  res.json(await putReminderPlan(req.ctx.userId!, req.body));
});
