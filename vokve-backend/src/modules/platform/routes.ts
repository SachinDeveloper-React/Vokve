import { Router } from 'express';
import mongoose from 'mongoose';
import { getConfig } from '../../config/remote.js';
import { siteCompanySchema } from '../../contracts/index.js';
import { getKV } from '../../db/redis.js';
import { isChannelDeliverable } from '../identity/otp.service.js';

export const platformRouter = Router();

/** How long either store may take to answer a health check before it counts as down. */
const HEALTH_TIMEOUT_MS = 3_000;

async function answers(check: () => Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<false>(resolve => {
      timer = setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS);
    });
    return Boolean(await Promise.race([check(), timeout]));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What an uptime monitor polls (RULES P20). It answers 503 unless the
 * database and the KV both answer a ping, because a monitor reads the status
 * and nothing else: this route used to say 200 with `mongo: false` inside,
 * which every monitor reads as "up" while every member's request fails.
 * A real ping rather than the driver's `readyState`, which stays "connected"
 * for a while after the cluster has gone.
 */
platformRouter.get('/health', async (_req, res) => {
  const [mongo, redis] = await Promise.all([
    answers(async () => mongoose.connection.readyState === 1 && (await mongoose.connection.db?.admin().command({ ping: 1 }))?.ok === 1),
    answers(() => getKV().ping()),
  ]);
  const ok = mongo && redis;
  res
    .status(ok ? 200 : 503)
    .set('Cache-Control', 'no-store')
    .json({ ok, mongo, redis, at: new Date().toISOString() });
});

const SOCIAL_KINDS = ['instagram', 'facebook', 'x', 'youtube', 'linkedin'] as const;

/**
 * Public: the company's contact details and links, for the website (RULES
 * P21). Read from the same ⚙ `support.*` the app's Help and About screens
 * read, and edited on the panel's Contact & links page. A minute's cache is
 * plenty — the website keeps its own copy for an hour anyway, and is told
 * to drop it when these change.
 */
platformRouter.get('/site/company', async (_req, res) => {
  const { support, app } = await getConfig();
  res.set('Cache-Control', 'public, max-age=60').json(
    siteCompanySchema.parse({
      company: {
        legalName: support.company,
        email: support.email,
        phone: support.phone,
        whatsapp: support.whatsapp,
        hours: support.hours,
        responseTime: support.responseTime,
        address: support.address,
        grievanceOfficer: {
          name: support.grievanceOfficer.name,
          email: support.grievanceOfficer.email ?? support.email,
        },
      },
      links: support.links,
      inviteUrlBase: support.inviteUrlBase,
      stores: {
        android: { url: app.storeUrl.android, listed: app.storeListed.android },
        ios: { url: app.storeUrl.ios, listed: app.storeListed.ios },
      },
      social: SOCIAL_KINDS.flatMap(kind => {
        const url = support.social[kind];
        return url ? [{ kind, url }] : [];
      }),
    }),
  );
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

