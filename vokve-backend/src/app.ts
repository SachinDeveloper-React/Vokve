import cors from 'cors';
import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { env, isTest } from './config/env.js';
import { logger } from './lib/logger.js';
import { verifyAppleNotification } from './lib/appleIdentity.js';
import { Errors } from './lib/errors.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import { handleAppleNotification } from './modules/identity/appleNotifications.service.js';
import { requestContext } from './middleware/requestContext.js';
import { versionGate } from './middleware/version.js';
import { maintenanceGate } from './middleware/maintenance.js';
import { accountRouter, aboutRouter } from './modules/account/routes.js';
import { adminAutomationsRouter } from './modules/admin/automations.routes.js';
import { adminUsersRouter } from './modules/admin/routes.js';
import { registerWishlistGoalAlerts } from './modules/commerce/wishlistGoals.service.js';
import { adminSessionRouter } from './modules/admin/session.routes.js';
import { requireAdmin } from './middleware/admin.js';
import { recordStaffActivity } from './modules/staff/activity.js';
import { staffPublicRouter, staffRouter } from './modules/staff/routes.js';
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
import { adminNutritionRouter } from './modules/nutrition/admin.routes.js';
import { nutritionRouter } from './modules/nutrition/routes.js';
import { platformRouter } from './modules/platform/routes.js';
import { socialRouter } from './modules/social/routes.js';
import { streakRouter } from './modules/streak/routes.js';
import { telemetryRouter } from './modules/telemetry/routes.js';
import { trainingRouter } from './modules/training/routes.js';
import { vitalsRouter } from './modules/vitals/routes.js';

/**
 * Query values that are a person or a secret: an operator searching members
 * by email or phone, a token on a link. The key stays in the log so the line
 * still says what was asked; the value does not (RULES Z8).
 */
const PRIVATE_QUERY = /^(q|query|search|email|phone|identifier|name|token|code|key|refreshToken|password)$/i;

export function scrubUrl(url: string): string {
  const mark = url.indexOf('?');
  if (mark < 0) return url;
  const params = new URLSearchParams(url.slice(mark + 1));
  for (const key of new Set(params.keys())) {
    if (PRIVATE_QUERY.test(key)) params.set(key, 'redacted');
  }
  return `${url.slice(0, mark)}?${params.toString()}`;
}

/**
 * Which browser pages may read the API's answers. The app is native and
 * the panel calls from its own server, so in production that is nobody
 * unless `CORS_ORIGINS` names them — never `*`, and never with credentials.
 * Outside production any origin, as before, so local tools keep working.
 */
function corsPolicy() {
  const allowed = (env.CORS_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean);
  if (allowed.length > 0) return cors({ origin: allowed, credentials: false });
  return cors({ origin: env.NODE_ENV !== 'production', credentials: false });
}

/**
 * One line per request, written when the answer goes out: method, path,
 * status, how long it took, who asked, and — on an error — the code and
 * message the app was sent (left on `res.locals` by the error handler) plus
 * the stack on a 5xx. 4xx logs at warn and 5xx at error, so the level alone
 * says which requests went wrong.
 */
export function requestLogger() {
  const facts = (req: IncomingMessage, res: ServerResponse) => {
    const r = req as Request;
    const locals = (res as Response).locals ?? {};
    return {
      requestId: r.ctx?.requestId,
      userId: r.ctx?.userId,
      deviceId: r.ctx?.deviceId,
      appVersion: r.ctx?.appVersion,
      platform: r.ctx?.platform,
      errorCode: locals.errorCode as string | undefined,
      errorMessage: locals.errorMessage as string | undefined,
      errorDetails: locals.errorDetails ?? undefined,
    };
  };
  const line = (req: IncomingMessage, res: ServerResponse, ms: number) =>
    `${req.method} ${scrubUrl((req as Request).originalUrl ?? req.url ?? '')} ${res.statusCode} ${ms}ms`;
  return pinoHttp({
    logger,
    genReqId: req => (req as Request).ctx?.requestId ?? '',
    customLogLevel: (_req, res, err) => {
      // A maintenance refusal is the server doing what it was told (RULES
      // DV14), once per member request for as long as it lasts — not an error.
      if ((res as Response).locals?.errorCode === 'MAINTENANCE') return 'info';
      return err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    },
    customSuccessMessage: (req, res, ms) => line(req, res, ms),
    // pino-http passes the response time as a fourth argument its types leave out.
    customErrorMessage: (req, res, _err, ms?: number) => line(req, res, ms ?? 0),
    customSuccessObject: (req, res, val) => ({ ...val, ...facts(req, res) }),
    customErrorObject: (req, res, _err, val) => ({ ...val, ...facts(req, res) }),
    serializers: {
      req: (req: { method?: string; url?: string; remoteAddress?: string }) => ({ method: req.method, url: scrubUrl(req.url ?? ''), ip: req.remoteAddress }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  });
}

/**
 * The Express app, without a listener, so tests can mount it on supertest.
 * Express 5 forwards rejected promises from async handlers to the error
 * handler, which is why the routes can `await` freely.
 */
export function createApp() {
  // A credit that takes the wallet to a saved reward's goal tells the member (RULES M12).
  registerWishlistGoalAlerts();
  const app = express();
  // The number of proxies in front of this process, not `true`: see
  // `TRUST_PROXY_HOPS`. `req.ip` is what every per-IP rate limit counts.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');

  app.use(helmet());
  // Avatars are public images (RULES P10) that any page may draw — the
  // panel's service worker fetches them with CORS to cache them. Nothing
  // private is served under /v1/media, and no credentials are honoured.
  app.use('/v1/media', cors({ origin: '*', credentials: false }));
  app.use(corsPolicy());
  // Ahead of the body parsers, so a request they refuse (bad JSON, too
  // large) still gets an id and still shows up in the log.
  app.use(requestContext);
  if (!isTest) app.use(requestLogger());
  // A profile photo is the one body bigger than an API call: it gets its own
  // parser, mounted first, so raising its ceiling does not raise everyone's.
  // body-parser marks a request it has read, so the general parser below
  // leaves this path alone.
  //
  // Both large parsers sit behind the session check: reading twelve
  // megabytes of JSON is the expensive part of these routes, and it used to
  // be done for anybody who asked, before the route's own `requireAuth`
  // turned them away. The signature check is microseconds (RULES Z3).
  app.use('/v1/me/avatar', requireAuth, express.json({ limit: '3mb' }));
  // A signed step snapshot carries a day's minutes, motion windows and raw
  // Health Connect records inside its signature — a watch that writes a
  // record a minute fills a few megabytes. The ceiling stays under what one
  // stored snapshot document can hold.
  app.use('/v1/activity/ingest', requireAuth, express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '1mb' }));

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Vokve Backend is running",
  });
});

  // Android's Apple sign-in return URL (RULES O13). Apple's web flow ends by
  // POSTing the result here, and the app's WebView reads it off Apple's page
  // and stops before this answers — but the URL is registered with Apple and
  // has to be real, and a member who catches the race should see this rather
  // than a JSON refusal. Above the version gate because a WebView sends none
  // of the app's headers. Nothing posted here is read or trusted.
  app.all('/v1/auth/apple/callback', (_req, res) => {
    res
      .status(200)
      .type('html')
      .send('<!doctype html><meta name="viewport" content="width=device-width"><title>VOKVE</title><p style="font-family:sans-serif;text-align:center;margin-top:40vh">Signed in with Apple. Returning to VOKVE…</p>');
  });

  // Apple's server-to-server notifications (RULES O17): consent withdrawn,
  // the Apple ID deleted, Hide My Email forwarding off or on. Above the
  // version gate for the callback's reason — Apple sends none of the app's
  // headers — and believed only once the payload's signature checks out.
  app.post(
    '/v1/auth/apple/notifications',
    express.urlencoded({ extended: false, limit: '32kb' }),
    rateLimit({ name: 'apple-notifications-ip', max: 300, windowSeconds: 600, by: 'ip' }),
    async (req, res) => {
      const payload = typeof req.body?.payload === 'string' ? req.body.payload : null;
      if (!payload) throw Errors.validation({ payload: 'A signed payload is required.' });
      const event = await verifyAppleNotification(payload);
      const outcome = event ? await handleAppleNotification(event) : 'ignored';
      logger.info({ type: event?.type ?? 'unknown', outcome }, 'apple.notification');
      res.status(200).json({ ok: true });
    },
  );

  app.use(versionGate);
  // Maintenance (RULES DV14): after the version gate, so a retired build is
  // still told to update; before every member route, the panel's excepted.
  app.use(maintenanceGate);

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
  v1.use(telemetryRouter);
  // The operator's own surface, last and under one gate (RULES Z9). Signing
  // in comes first — the two /admin paths the gate cannot stand in front of,
  // since they are where sessions come from. Then the gate, once, which says
  // who is asking; then the activity log, which writes down every request;
  // then the routers, each route of which checks its own permission.
  v1.use(adminSessionRouter);
  v1.use(staffPublicRouter);
  v1.use('/admin', requireAdmin, recordStaffActivity);
  v1.use(staffRouter);
  v1.use(adminNutritionRouter);
  v1.use(adminUsersRouter);
  v1.use(adminAutomationsRouter);
  app.use('/v1', v1);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'That could not be found.', details: null } });
  });
  app.use(errorHandler);
  return app;
}
