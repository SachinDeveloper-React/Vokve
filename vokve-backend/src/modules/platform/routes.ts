import { Router } from 'express';
import mongoose from 'mongoose';
import { getConfig } from '../../config/remote.js';
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

