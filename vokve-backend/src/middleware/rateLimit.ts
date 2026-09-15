import type { RequestHandler } from 'express';
import { getKV } from '../db/redis.js';
import { Errors } from '../lib/errors.js';

interface Limit {
  /** Name for the key space, e.g. "otp-send". */
  name: string;
  max: number;
  windowSeconds: number;
  /** What the limit is per: ip, user, device, or a body field (e.g. phone). */
  by: 'ip' | 'user' | 'device' | ((req: Parameters<RequestHandler>[0]) => string | undefined);
}

export function rateLimit(limit: Limit): RequestHandler {
  return async (req, _res, next) => {
    let subject: string | undefined;
    if (limit.by === 'ip') subject = req.ip;
    else if (limit.by === 'user') subject = req.ctx.userId;
    else if (limit.by === 'device') subject = req.ctx.deviceId;
    else subject = limit.by(req);
    if (!subject) return next();

    const count = await getKV().incrWithTtl(`rl:${limit.name}:${subject}`, limit.windowSeconds);
    if (count > limit.max) return next(Errors.rateLimited(limit.windowSeconds));
    next();
  };
}
