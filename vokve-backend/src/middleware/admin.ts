import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { Errors } from '../lib/errors.js';

/**
 * The operator's own door (`/v1/admin/*`).
 *
 * There is no admin account and no admin role on a member: the key lives in
 * the operator's environment, so no member token — stolen, rooted or
 * otherwise — can ever reach these routes, and nothing in the app has to know
 * the admin surface exists.
 *
 * With no key configured the routes answer 404 rather than 401, because a
 * server that was never meant to be administered should not advertise a door
 * to knock on.
 */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  const configured = env.ADMIN_API_KEY;
  if (!configured) return next(Errors.notFound('That'));

  const offered = Buffer.from(req.header('x-admin-key') ?? '', 'utf8');
  const expected = Buffer.from(configured, 'utf8');
  // Compared in constant time, and only at equal length — `timingSafeEqual`
  // throws on a length mismatch, which would itself leak the length.
  if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) {
    return next(Errors.unauthorized());
  }

  req.ctx.adminActor = env.ADMIN_ACTOR;
  next();
};
