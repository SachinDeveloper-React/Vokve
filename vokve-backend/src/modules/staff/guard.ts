import { Router, type RequestHandler } from 'express';
import { ApiError, Errors } from '../../lib/errors.js';
import { ROUTE_PERMISSIONS, ruleLabel, type RouteRule } from './permissions.js';

/**
 * A router whose every route checks a permission before anything else runs
 * (RULES Z9).
 *
 * `get`/`post`/`put`/`patch`/`delete` look the route up in
 * `ROUTE_PERMISSIONS` as it is *registered* and put the check in front of
 * its handlers. A route that is not in the table throws right there — at
 * boot, in every test run — so an admin route cannot exist without somebody
 * having decided who may call it. Deny by default, enforced by the server
 * refusing to start rather than by a reviewer remembering.
 */
export function guardedRouter(): Router {
  const router = Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const original = router[method].bind(router) as (...args: unknown[]) => Router;
    (router as unknown as Record<string, unknown>)[method] = (path: unknown, ...handlers: unknown[]) => {
      if (typeof path !== 'string') throw new Error(`An admin route must have a plain path (got ${String(path)})`);
      const key = `${method.toUpperCase()} ${path}`;
      const rule = ROUTE_PERMISSIONS[key];
      if (!rule) {
        throw new Error(`${key} has no entry in ROUTE_PERMISSIONS (modules/staff/permissions.ts) — decide who may call it before adding it`);
      }
      registered.add(key);
      return original(path, requirePermission(rule), ...handlers);
    };
  }
  return router;
}

/** Every guarded route registered so far — what the coverage test reads. */
export const registered = new Set<string>();

export function requirePermission(rule: RouteRule): RequestHandler {
  const needed = rule === '@self' || rule === '@setup' ? [] : Array.isArray(rule) ? rule : [rule];
  return (req, _res, next) => {
    const who = req.ctx.staff;
    req.ctx.permission = needed[0] ?? rule.toString();
    if (!who) return next(Errors.unauthorized());

    // A session that has not yet set its own password or enrolled an
    // authenticator can do exactly that, and nothing else.
    if (who.restricted && rule !== '@setup') {
      return next(new ApiError(403, 'STAFF_SETUP_REQUIRED', 'Set your password and authenticator first.', { setup: true }));
    }
    if (needed.length === 0 || who.kind === 'root') return next();
    if (needed.some(permission => who.permissions.has(permission))) return next();

    const ask = who.role === 'agent' ? 'your manager' : 'an admin';
    return next(
      new ApiError(403, 'PERMISSION_DENIED', `You do not have permission to ${ruleLabel(rule)}. Ask ${ask} if you need it.`, {
        permission: needed[0],
        anyOf: needed,
      }),
    );
  };
}
