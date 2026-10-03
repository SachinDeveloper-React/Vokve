import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { Errors } from '../../lib/errors.js';
import { CONTENT_TOPICS } from './models.js';
import { tipOfTheDay } from './service.js';

export const contentRouter = Router();
contentRouter.use('/content', requireAuth, requireDevice);

const topic = z.enum(CONTENT_TOPICS);

/** The day's tip — or, for `motivation`, the day's line (BACKEND §6.15). */
contentRouter.get('/content/tips/:topic', async (req, res) => {
  const parsed = topic.safeParse(req.params.topic);
  if (!parsed.success) throw Errors.notFound('That topic');
  res.json(await tipOfTheDay(parsed.data, req.ctx.timezone));
});
