import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { EventModel } from './models.js';
import { isChannelDeliverable } from '../identity/otp.service.js';

export const platformRouter = Router();

platformRouter.get('/health', (_req, res) => {
  res.json({ ok: true, mongo: mongoose.connection.readyState === 1, at: new Date().toISOString() });
});

/** Public: earn rates, caps, milestones, min version — everything ⚙. */
platformRouter.get('/config', async (_req, res) => {
  const config = await getConfig();
  res.json({
    coins: {
      dailyCap: config.coins.dailyCap,
      sourceCaps: config.coins.sourceCaps,
      steps: config.coins.steps,
      workout: config.coins.workout,
      streakMilestones: config.coins.streakMilestones,
      referral: config.coins.referral,
      expiryDays: config.coins.expiryDays,
    },
    streak: config.streak,
    app: config.app,
    locale: config.locale,
    otp: {
      signupChannel: config.otp.signupChannel,
      channels: { email: isChannelDeliverable('email'), sms: isChannelDeliverable('sms') },
    },
  });
});

const eventsBody = z.object({
  events: z
    .array(z.object({ name: z.string().min(1).max(64), props: z.record(z.string(), z.unknown()).optional(), at: z.string().datetime() }))
    .min(1)
    .max(100),
});

platformRouter.post('/events', requireAuth, validate('body', eventsBody), async (req, res) => {
  const { userId, deviceId, appVersion, platform } = req.ctx;
  await EventModel.insertMany(
    req.body.events.map((e: z.infer<typeof eventsBody>['events'][number]) => ({
      userId, deviceId, appVersion, platform, name: e.name, props: e.props ?? {}, at: new Date(e.at),
    })),
    { ordered: false },
  );
  res.status(202).json({ accepted: req.body.events.length });
});
