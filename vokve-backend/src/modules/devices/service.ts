import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { compareVersions } from '../../middleware/version.js';
import { AuditLogModel } from '../platform/models.js';
import { RefreshTokenModel } from '../identity/models.js';
import { DeviceModel } from './models.js';
import { getKV } from '../../db/redis.js';
import { heartbeatKey } from '../../middleware/device.js';

export const registerDeviceBody = z.object({
  installId: z.string().min(8).max(128),
  vendorId: z.string().max(128).optional().nullable(),
  platform: z.enum(['ios', 'android']),
  profile: z.object({
    brand: z.string().optional(), manufacturer: z.string().optional(), model: z.string().optional(),
    deviceName: z.string().optional(), osVersion: z.string().optional(),
    isEmulator: z.boolean().optional(), isTablet: z.boolean().optional(),
    totalMemoryMb: z.number().optional(), carrier: z.string().optional(),
    locale: z.string().optional(), timezone: z.string().optional(),
    screen: z.object({ w: z.number(), h: z.number(), scale: z.number() }).optional(),
    hasBiometrics: z.boolean().optional(),
    app: z.object({ version: z.string(), build: z.string(), bundleId: z.string().optional() }),
  }),
  integrity: z.object({ provider: z.enum(['play_integrity', 'app_attest']), token: z.string() }).optional().nullable(),
  signals: z
    .object({ rooted: z.boolean().optional(), debugBuild: z.boolean().optional(), hookingFramework: z.boolean().optional(),
      mockLocation: z.boolean().optional(), developerMode: z.boolean().optional() })
    .optional(),
  pushToken: z.string().optional().nullable(),
});
export type RegisterDeviceBody = z.infer<typeof registerDeviceBody>;

/**
 * Idempotent by (user, installId). Attestation verification is a stub until
 * Phase 2 wires Play Integrity / App Attest; the verdict is recorded as
 * `unverified` so nothing downstream mistakes "not checked" for "passed".
 */
export async function registerDevice(userId: string, body: RegisterDeviceBody, refreshTokenHash?: string) {
  const config = await getConfig();

  const active = await DeviceModel.countDocuments({ userId, revokedAt: null, installId: { $ne: body.installId } });
  if (active >= config.devices.maxPerAccount) {
    throw Errors.forbidden('TOO_MANY_DEVICES', `You can use VOKVE on up to ${config.devices.maxPerAccount} devices. Remove one from Account → Devices.`);
  }

  const now = new Date();
  const device = await DeviceModel.findOneAndUpdate(
    { userId, installId: body.installId },
    {
      $setOnInsert: { _id: newId('dev'), firstSeenAt: now, 'app.firstVersion': body.profile.app.version },
      $set: {
        vendorId: body.vendorId ?? undefined,
        platform: body.platform,
        info: {
          brand: body.profile.brand, manufacturer: body.profile.manufacturer, model: body.profile.model,
          deviceName: body.profile.deviceName, osVersion: body.profile.osVersion,
          isEmulator: body.profile.isEmulator ?? false, isTablet: body.profile.isTablet ?? false,
          totalMemoryMb: body.profile.totalMemoryMb, carrier: body.profile.carrier,
          locale: body.profile.locale, timezone: body.profile.timezone, screen: body.profile.screen,
          hasBiometrics: body.profile.hasBiometrics,
        },
        'app.version': body.profile.app.version,
        'app.build': body.profile.app.build,
        'app.bundleId': body.profile.app.bundleId,
        ...(body.pushToken ? { push: { token: body.pushToken, provider: 'fcm', updatedAt: now } } : {}),
        integrity: body.integrity
          ? { provider: body.integrity.provider, verdict: 'unverified', checkedAt: now }
          : { verdict: 'none', checkedAt: now },
        signals: { ...(body.signals ?? {}), emulator: body.profile.isEmulator ?? false },
        lastSeenAt: now,
        revokedAt: null,
      },
    },
    { upsert: true, new: true },
  ).lean();

  // Device sharing (L6): the same install or vendor id on several accounts.
  const shared = await DeviceModel.countDocuments({
    $or: [{ installId: body.installId }, ...(body.vendorId ? [{ vendorId: body.vendorId }] : [])],
    userId: { $ne: userId },
  });
  if (shared + 1 >= config.devices.flagAtAccountsPerDevice) {
    await AuditLogModel.create({ actorType: 'system', action: 'device.shared', subjectType: 'user', subjectId: userId,
      deviceId: device._id, after: { accounts: shared + 1 } });
  }

  // Bind the session that made this call to the device (RULES DV7).
  if (refreshTokenHash) {
    await RefreshTokenModel.updateOne({ tokenHash: refreshTokenHash }, { $set: { deviceId: device._id } });
  }

  const min = config.app.minVersion[body.platform];
  return {
    deviceId: device._id,
    trustTier: 'normal' as const,
    mustUpgrade: compareVersions(body.profile.app.version, min) < 0,
    minVersion: min,
  };
}

export async function listDevices(userId: string) {
  const devices = await DeviceModel.find({ userId, revokedAt: null }).sort({ lastSeenAt: -1 }).lean();
  return devices.map(d => ({
    id: d._id,
    platform: d.platform,
    model: d.info?.model ?? null,
    brand: d.info?.brand ?? null,
    osVersion: d.info?.osVersion ?? null,
    appVersion: d.app?.version ?? null,
    build: d.app?.build ?? null,
    firstSeenAt: d.firstSeenAt?.toISOString() ?? null,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
  }));
}

export async function revokeDevice(userId: string, deviceId: string, actorDeviceId?: string) {
  const device = await DeviceModel.findOneAndUpdate(
    { _id: deviceId, userId, revokedAt: null },
    { $set: { revokedAt: new Date(), 'push.invalidAt': new Date() } },
  ).lean();
  if (!device) throw Errors.notFound('That device');
  // Revocation must be immediate — drop the heartbeat debounce so the next request re-checks the DB.
  await getKV().del(heartbeatKey(deviceId));
  await RefreshTokenModel.updateMany({ userId, deviceId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await AuditLogModel.create({ actorType: 'user', actorId: userId, deviceId: actorDeviceId, action: 'device.revoke',
    subjectType: 'device', subjectId: deviceId });
}
