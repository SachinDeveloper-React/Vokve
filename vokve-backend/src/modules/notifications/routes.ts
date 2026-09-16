import { Router } from 'express';
import { z } from 'zod';
import { notificationCategorySchema } from '../../contracts/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { validate } from '../../middleware/validate.js';
import { countNotifications, listNotifications, markAllRead, markRead } from './service.js';

export const notificationsRouter = Router();
notificationsRouter.use('/notifications', requireAuth, requireDevice);

const listQuery = z.object({
  category: notificationCategorySchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

notificationsRouter.get('/notifications', validate('query', listQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listQuery>;
  res.json(await listNotifications(req.ctx.userId!, q.category, q.cursor, q.limit));
});

notificationsRouter.get('/notifications/counts', async (req, res) => {
  res.json(await countNotifications(req.ctx.userId!));
});

/** Idempotent: a row already read, or one that has gone, answers `ok` too. */
notificationsRouter.post('/notifications/read-all', async (req, res) => {
  res.json({ ok: true, updated: await markAllRead(req.ctx.userId!) });
});

notificationsRouter.post('/notifications/:id/read', async (req, res) => {
  await markRead(req.ctx.userId!, req.params.id as string);
  res.json({ ok: true });
});
