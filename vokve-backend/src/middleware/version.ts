import type { RequestHandler } from 'express';
import { getConfig } from '../config/remote.js';
import { Errors } from '../lib/errors.js';
import { AppReleaseModel } from '../modules/devices/models.js';

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Blocks builds the product has retired (RULES DV6): either below the
 * per-platform minimum, or explicitly marked `blocked` in app_releases.
 */
export const versionGate: RequestHandler = async (req, _res, next) => {
  const { platform, appVersion, build } = req.ctx;
  if (!platform || !appVersion) return next();

  const config = await getConfig();
  const min = config.app.minVersion[platform];
  if (compareVersions(appVersion, min) < 0) {
    return next(Errors.upgradeRequired(config.app.storeUrl[platform], min));
  }
  if (build) {
    const release = await AppReleaseModel.findOne({ platform, version: appVersion, build }).lean();
    if (release?.status === 'blocked') {
      return next(Errors.upgradeRequired(config.app.storeUrl[platform], min));
    }
  }
  next();
};
