import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { validate } from '../../middleware/validate.js';
import { hashToken } from '../../lib/tokens.js';
import { AppReleaseModel, DeviceModel } from './models.js';
import { listDevices, registerDevice, registerDeviceBody, revokeDevice } from './service.js';

export const devicesRouter = Router();

/** Exempt from the device gate — it is how a device becomes known. */
devicesRouter.post('/devices/register', requireAuth, validate('body', registerDeviceBody), async (req, res) => {
  const refresh = req.header('x-vokve-refresh-token');
  const result = await registerDevice(req.ctx.userId!, req.body, refresh ? hashToken(refresh) : undefined);
  res.json(result);
});

const heartbeatBody = z.object({
  appVersion: z.string().optional(), build: z.string().optional(), osVersion: z.string().optional(),
  pushToken: z.string().nullable().optional(), timezone: z.string().optional(), locale: z.string().optional(),
});

devicesRouter.patch('/devices/:deviceId', requireAuth, validate('body', heartbeatBody), async (req, res) => {
  const set: Record<string, unknown> = { lastSeenAt: new Date() };
  if (req.body.appVersion) set['app.version'] = req.body.appVersion;
  if (req.body.build) set['app.build'] = req.body.build;
  if (req.body.osVersion) set['info.osVersion'] = req.body.osVersion;
  if (req.body.timezone) set['info.timezone'] = req.body.timezone;
  if (req.body.locale) set['info.locale'] = req.body.locale;
  if (req.body.pushToken !== undefined) set['push'] = req.body.pushToken
    ? { token: req.body.pushToken, provider: 'fcm', updatedAt: new Date() } : { token: null, invalidAt: new Date() };
  const updated = await DeviceModel.updateOne({ _id: String(req.params.deviceId), userId: req.ctx.userId, revokedAt: null }, { $set: set });
  res.json({ ok: updated.matchedCount === 1 });
});

devicesRouter.get('/me/devices', requireAuth, requireDevice, async (req, res) => {
  const data = await listDevices(req.ctx.userId!);
  res.json({ data: data.map(d => ({ ...d, isCurrent: d.id === req.ctx.deviceId })), nextCursor: null });
});

devicesRouter.delete('/me/devices/:deviceId', requireAuth, requireDevice, async (req, res) => {
  await revokeDevice(req.ctx.userId!, String(req.params.deviceId), req.ctx.deviceId);
  res.json({ ok: true });
});

devicesRouter.get('/releases', async (req, res) => {
  const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
  const data = await AppReleaseModel.find(platform ? { platform } : {}).sort({ releasedAt: -1 }).lean();
  res.json({ data: data.map(r => ({ platform: r.platform, version: r.version, build: r.build, status: r.status, releasedAt: r.releasedAt })), nextCursor: null });
});
