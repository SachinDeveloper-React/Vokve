import { Router } from 'express';
import { appErrorBatchSchema, deviceHealthReportSchema, eventBatchSchema, permissionReportSchema } from '../../contracts/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { readPermissions, recordErrors, recordEvents, saveDeviceHealth, savePermissions } from './service.js';

export const telemetryRouter = Router();
telemetryRouter.use(['/events', '/me/permissions', '/me/errors', '/me/device-health'], requireAuth, requireDevice);

/**
 * The analytics sink (PRD ADV2): a batch of what the member did, with the
 * device and the app version attached server-side.
 *
 * `202`, not `200`: the server has taken the batch, and what it does with
 * each row — files it, drops it for a member who opted out (RULES P7),
 * drops it as too old — is not something the app needs to act on.
 *
 * The rate limit is per device and generous — the app flushes every few
 * seconds while someone is using it, and a batch holds a hundred — but it is
 * there, so a build with a broken flush loop cannot write without bound.
 */
telemetryRouter.post(
  '/events',
  rateLimit({ name: 'events', max: 240, windowSeconds: 600, by: 'device' }),
  validate('body', eventBatchSchema),
  async (req, res) => {
    const { accepted, dropped } = await recordEvents(req.ctx.userId!, req.ctx.deviceId!, req.ctx, req.body.events);
    // `dropped` only when there is something to say: the ordinary answer to
    // an ordinary batch is the count it wrote.
    res.status(202).json(dropped > 0 ? { accepted, dropped } : { accepted });
  },
);

/**
 * What this phone's OS currently lets the app do (RULES P14). Sent on launch,
 * after any permission screen, and whenever an answer changes — never on a
 * timer, so a phone whose answers are stable says nothing.
 */
telemetryRouter.put(
  '/me/permissions',
  rateLimit({ name: 'permissions-report', max: 60, windowSeconds: 600, by: 'device' }),
  validate('body', permissionReportSchema),
  async (req, res) => {
    res.json(await savePermissions(req.ctx.userId!, req.ctx.deviceId!, req.ctx, req.body.permissions));
  },
);

/** The same snapshot back — what the app itself can show as "what's off". */
telemetryRouter.get('/me/permissions', async (req, res) => {
  res.json(await readPermissions(req.ctx.userId!, req.ctx.deviceId!));
});

/**
 * What went wrong on this phone (RULES P17).
 *
 * `202` like the trail: the server has taken the batch, and whether a row
 * was folded into a group already there or dropped as too old is not
 * something the app should behave differently about. Unlike the trail it is
 * kept for a member with usage analytics off — an error is the record of
 * the app failing them, not of what interests them.
 *
 * The limit is tighter than the trail's, because errors are rare by
 * definition and a build sending them at speed is the thing being limited.
 */
telemetryRouter.post(
  '/me/errors',
  rateLimit({ name: 'app-errors', max: 60, windowSeconds: 600, by: 'device' }),
  validate('body', appErrorBatchSchema),
  async (req, res) => {
    const { accepted, dropped } = await recordErrors(req.ctx.userId!, req.ctx.deviceId!, req.ctx, req.body.errors);
    res.status(202).json(dropped > 0 ? { accepted, dropped } : { accepted });
  },
);

/**
 * Whether this install is working (RULES P17): the tracker's own health,
 * Health Connect's grants, the state of the step sync. Sent on launch, on a
 * foreground and when any of it changes — the same three moments as the
 * permission snapshot, and diffed on the phone the same way, so a phone
 * where nothing moves says it twice a day.
 */
telemetryRouter.put(
  '/me/device-health',
  rateLimit({ name: 'device-health', max: 60, windowSeconds: 600, by: 'device' }),
  validate('body', deviceHealthReportSchema),
  async (req, res) => {
    res.json(await saveDeviceHealth(req.ctx.userId!, req.ctx.deviceId!, req.ctx, req.body));
  },
);
