import type { RequestHandler } from 'express';
import { Errors } from '../lib/errors.js';
import { DeviceModel } from '../modules/devices/models.js';
import { getKV } from '../db/redis.js';

/**
 * The mark that this member's device was checked against the database a
 * moment ago. Keyed by both: a device id is a header, and a mark keyed by
 * the id alone would vouch for whoever quoted it next.
 */
export const heartbeatKey = (deviceId: string, userId: string) => `hb:${deviceId}:${userId}`;

/** How long one check stands, and so how often the heartbeat is written. */
const HEARTBEAT_SECONDS = 300;

/**
 * Every authenticated request must come from a device registered to this
 * user (RULES DV1). The heartbeat — last seen, app version, OS — is written at
 * most once per five minutes per device so the hot path stays cheap.
 *
 * The mark is set *after* the device is found, never before. It used to be
 * set first and left behind when the lookup failed, so a made-up id — or a
 * device revoked a second ago — was refused once and then waved through
 * for five minutes on the mark its own failed request had left. Setting it
 * only on success means the only thing a mark can say is "the database
 * agreed"; a burst of requests on a cold mark each ask the database, which
 * is a few identical writes at launch and nothing more.
 *
 * Revoking a device drops its mark (`revokeDevice`), so the next request is
 * checked. A request already past the lookup at that instant can still set
 * one; what it buys is the rest of that access token on a device whose
 * refresh tokens are gone.
 */
export const requireDevice: RequestHandler = async (req, _res, next) => {
  const { userId, deviceId } = req.ctx;
  if (!deviceId || !userId) return next(Errors.deviceNotRegistered());

  const checkedKey = heartbeatKey(deviceId, userId);
  if (await getKV().has(checkedKey)) return next();

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
  await getKV().setIfAbsent(checkedKey, HEARTBEAT_SECONDS);
  next();
};
