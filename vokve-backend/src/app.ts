import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestContext } from './middleware/requestContext.js';
import { versionGate } from './middleware/version.js';
import { accountRouter, aboutRouter } from './modules/account/routes.js';
import { activityRouter } from './modules/activity/routes.js';
import { challengesRouter } from './modules/challenges/routes.js';
import { commerceRouter } from './modules/commerce/routes.js';
import { contentRouter } from './modules/content/routes.js';
import { devicesRouter } from './modules/devices/routes.js';
import { hydrationRouter } from './modules/hydration/routes.js';
import { leaderboardRouter } from './modules/leaderboard/routes.js';
import { walletRouter } from './modules/economy/routes.js';
import { authRouter } from './modules/identity/auth.routes.js';
import { meRouter } from './modules/identity/me.routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { nutritionRouter } from './modules/nutrition/routes.js';
import { platformRouter } from './modules/platform/routes.js';
import { socialRouter } from './modules/social/routes.js';
import { streakRouter } from './modules/streak/routes.js';
import { trainingRouter } from './modules/training/routes.js';
import { vitalsRouter } from './modules/vitals/routes.js';

/**
 * The Express app, without a listener, so tests can mount it on supertest.
 * Express 5 forwards rejected promises from async handlers to the error
 * handler, which is why the routes can `await` freely.
 */
export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors());
  // A profile photo is the one body bigger than an API call: it gets its own
  // parser, mounted first, so raising its ceiling does not raise everyone's.
  // body-parser marks a request it has read, so the general parser below
  // leaves this path alone.
  app.use('/v1/me/avatar', express.json({ limit: '3mb' }));
  // A signed step snapshot carries a day's minutes, motion windows and raw
  // Health Connect records inside its signature — a watch that writes a
  // record a minute fills a few megabytes. The ceiling stays under what one
  // stored snapshot document can hold.
  app.use('/v1/activity/ingest', express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestContext);
  if (!isTest) {
    app.use(pinoHttp({
      logger,
      customProps: req => ({
        requestId: req.ctx?.requestId, deviceId: req.ctx?.deviceId, appVersion: req.ctx?.appVersion, platform: req.ctx?.platform,
      }),
    }));
  }
  app.use(versionGate);

  const v1 = express.Router();
  v1.use(platformRouter);
  v1.use(aboutRouter);
  v1.use(authRouter);
  v1.use(devicesRouter);
  v1.use(meRouter);
  v1.use(accountRouter);
  v1.use(walletRouter);
  v1.use(trainingRouter);
  v1.use(activityRouter);
  v1.use(notificationsRouter);
  v1.use(commerceRouter);
  v1.use(socialRouter);
  v1.use(streakRouter);
  v1.use(challengesRouter);
  v1.use(leaderboardRouter);
  v1.use(hydrationRouter);
  v1.use(contentRouter);
  v1.use(nutritionRouter);
  v1.use(vitalsRouter);
  app.use('/v1', v1);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'That could not be found.', details: null } });
  });
  app.use(errorHandler);
  return app;
}
