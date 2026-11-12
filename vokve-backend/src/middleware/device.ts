import type { RequestHandler } from 'express';
import { Errors } from '../lib/errors.js';
import { DeviceModel } from '../modules/devices/models.js';
import { getKV } from '../db/redis.js';

export const heartbeatKey = (deviceId: string) => `hb:${deviceId}`;

/**
 * Every authenticated request must come from a device registered to this
 * user (RULES DV1). The heartbeat — last seen, app version, OS — is written at
 * most once per five minutes per device so the hot path stays cheap.
 */
export const requireDevice: RequestHandler = async (req, _res, next) => {
  const { userId, deviceId } = req.ctx;
  if (!deviceId) return next(Errors.deviceNotRegistered());

  const debounceKey = heartbeatKey(deviceId);
  const fresh = await getKV().setIfAbsent(debounceKey, 300);
  if (!fresh) return next();

  const device = await DeviceModel.findOneAndUpdate(
    { _id: deviceId, userId, revokedAt: null },
    {
      $set: {
        lastSeenAt: new Date(),
        ...(req.ctx.appVersion ? { 'app.version': req.ctx.appVersion } : {}),
        ...(req.ctx.build ? { 'app.build': req.ctx.build } : {}),
        ...(req.ctx.osVersion ? { 'info.osVersion': req.ctx.osVersion } : {}),
        ...(req.ctx.timezone ? { 'info.timezone': req.ctx.timezone } : {}),
      },
    },
    { new: true, projection: { _id: 1 } },
  ).lean();

  if (!device) return next(Errors.deviceNotRegistered());
  next();
};
