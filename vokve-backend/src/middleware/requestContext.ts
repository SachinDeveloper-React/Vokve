import type { RequestHandler } from 'express';
import { v7 as uuidv7 } from 'uuid';
import { isValidTimeZone } from '../lib/dates.js';
import { CONFIG_DEFAULTS } from '../config/defaults.js';

/**
 * Reads the X-Vokve-* headers into `req.ctx` (BACKEND §3.8). Nothing here
 * rejects — the device and version gates do that where they apply.
 */
export const requestContext: RequestHandler = (req, _res, next) => {
  const h = (name: string) => {
    const v = req.header(name);
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const platform = h('x-vokve-platform');
  const tz = h('x-vokve-timezone');
  req.ctx = {
    requestId: h('x-request-id') ?? uuidv7(),
    deviceId: h('x-vokve-device-id'),
    platform: platform === 'ios' || platform === 'android' ? platform : undefined,
    appVersion: h('x-vokve-app-version'),
    build: h('x-vokve-build'),
    osVersion: h('x-vokve-os-version'),
    timezone: tz && isValidTimeZone(tz) ? tz : CONFIG_DEFAULTS.locale.timezone,
    locale: h('x-vokve-locale'),
    idempotencyKey: h('idempotency-key'),
  };
  _res.setHeader('x-request-id', req.ctx.requestId);
  next();
};
