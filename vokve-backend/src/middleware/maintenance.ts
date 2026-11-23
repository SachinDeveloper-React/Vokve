import type { RequestHandler } from 'express';
import { Errors } from '../lib/errors.js';
import { bearerSubject, canBypassMaintenance, maintenanceError, maintenanceState } from '../modules/platform/maintenance.js';

/**
 * What a member's app can still reach while maintenance is on (RULES DV14):
 * the health check, the remote config, the About screen, and the three
 * `/app/*` reads that tell a phone what to draw — this one above all, since
 * it is how a phone on the maintenance screen learns it is over.
 */
const OPEN = new Set(['/v1/health', '/v1/config', '/v1/app/about', '/v1/app/update', '/v1/app/icon', '/v1/app/status']);

/**
 * Signing in stays open, so a tester can get in from the maintenance screen
 * ("Team sign-in"); a member who is not one is stopped by the very next
 * request. Making a new account does not: nobody needs one to test.
 */
const CLOSED_AUTH = new Set(['/v1/auth/sign-up', '/v1/auth/identity/create']);

/** The header a let-through request is answered with, so the app can draw its strip at once. */
export const MAINTENANCE_HEADER = 'X-Vokve-Maintenance';

/**
 * Stops member requests while maintenance is on (RULES DV14). After the
 * version gate: a retired build is told to update, which it must do whether
 * or not the server is in maintenance.
 *
 * The panel's routes (`/v1/admin/*`) are never stopped — it is where
 * maintenance is switched off — and nor are avatars.
 */
export const maintenanceGate: RequestHandler = async (req, res, next) => {
  const path = req.path;
  if (!path.startsWith('/v1/') || path.startsWith('/v1/admin/') || path.startsWith('/v1/media/')) return next();

  const state = await maintenanceState();
  if (!state.active) return next();

  const subject = bearerSubject(req.header('authorization'));
  if (subject && !subject.expired && (await canBypassMaintenance(subject.sub))) {
    res.setHeader(MAINTENANCE_HEADER, 'bypass');
    return next();
  }
  if (OPEN.has(path)) return next();
  if (path.startsWith('/v1/auth/') && !CLOSED_AUTH.has(path)) return next();
  // An expired session is answered as one, whoever it belongs to: the app
  // refreshes on a 401 and asks again, and only then is it known whether
  // this is a tester. A 503 here would put a tester on the maintenance
  // screen every time their access token ran out.
  if (subject?.expired) return next(Errors.unauthorized());
  next(maintenanceError(state));
};
