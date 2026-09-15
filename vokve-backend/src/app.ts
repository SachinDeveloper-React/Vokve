import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestContext } from './middleware/requestContext.js';
import { versionGate } from './middleware/version.js';
import { activityRouter } from './modules/activity/routes.js';
import { devicesRouter } from './modules/devices/routes.js';
import { walletRouter } from './modules/economy/routes.js';
import { authRouter } from './modules/identity/auth.routes.js';
import { meRouter } from './modules/identity/me.routes.js';
import { platformRouter } from './modules/platform/routes.js';
import { trainingRouter } from './modules/training/routes.js';

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
  v1.use(authRouter);
  v1.use(devicesRouter);
  v1.use(meRouter);
  v1.use(walletRouter);
  v1.use(trainingRouter);
  v1.use(activityRouter);
  app.use('/v1', v1);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'That could not be found.', details: null } });
  });
  app.use(errorHandler);
  return app;
}
