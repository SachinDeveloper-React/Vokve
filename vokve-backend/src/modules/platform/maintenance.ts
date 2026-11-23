import { getConfig } from '../../config/remote.js';
import { appStatusSchema, type AppStatus } from '../../contracts/index.js';
import { ApiError } from '../../lib/errors.js';
import { accessTokenSubject } from '../../lib/tokens.js';
import { UserModel } from '../identity/models.js';
import { StaffModel } from '../staff/models.js';

/**
 * Maintenance mode (RULES DV14).
 *
 * One switch on the panel's Maintenance page (⚙ `app.maintenance`). While it
 * is on, every member request answers `503 MAINTENANCE` and the app draws
 * the maintenance screen; the panel, the health check and the handful of
 * routes the app needs to say so are untouched. Two kinds of member carry on
 * through it, each with a strip in the app saying maintenance is on:
 *
 *   - **testers**, marked on the Maintenance page (`flags.tester`), and
 *   - **staff**: a member whose *verified* email is an active panel
 *     account's. Verified, because anybody can type a staff address into a
 *     sign-up form; proving it takes the code sent to that inbox.
 */

export interface MaintenanceState {
  active: boolean;
  title: string;
  message: string;
  endsAt: string | null;
}

export async function maintenanceState(): Promise<MaintenanceState> {
  const { maintenance } = (await getConfig()).app;
  return {
    active: maintenance.enabled,
    title: maintenance.title,
    message: maintenance.message,
    endsAt: maintenance.endsAt,
  };
}

/**
 * How long one answer to "may this member through?" is kept. Every request
 * a tester makes during maintenance asks, and the answer changes only when
 * somebody edits the tester list — which clears it here at once, and on
 * another instance within this.
 */
const BYPASS_TTL_MS = 30_000;
const bypassCache = new Map<string, { at: number; value: boolean }>();

export async function canBypassMaintenance(userId: string): Promise<boolean> {
  const hit = bypassCache.get(userId);
  if (hit && Date.now() - hit.at < BYPASS_TTL_MS) return hit.value;

  const user = await UserModel.findById(userId, { email: 1, emailVerifiedAt: 1, flags: 1, deletedAt: 1 }).lean();
  let value = false;
  if (user && !user.deletedAt) {
    if (user.flags?.tester) {
      value = true;
    } else if (user.emailVerifiedAt && user.email) {
      value = Boolean(await StaffModel.exists({ email: user.email.trim().toLowerCase(), status: 'active' }));
    }
  }
  // A few thousand members hitting a gate is a few thousand entries; past
  // that the oldest answers are simply asked again.
  if (bypassCache.size > 5_000) bypassCache.clear();
  bypassCache.set(userId, { at: Date.now(), value });
  return value;
}

/** Drops a remembered answer, after the tester list changed. */
export function forgetMaintenanceBypass(userId?: string): void {
  if (userId) bypassCache.delete(userId);
  else bypassCache.clear();
}

/** The member a request's bearer token names, expired or not; null for none, or a token this server did not sign. */
export function bearerSubject(authorization: string | undefined): { sub: string; expired: boolean } | null {
  const header = authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return token ? accessTokenSubject(token) : null;
}

/** What a member's request is answered with while maintenance is on: the screen's own words, ready to draw. */
export function maintenanceError(state: MaintenanceState): ApiError {
  return new ApiError(503, 'MAINTENANCE', state.message, { title: state.title, endsAt: state.endsAt });
}

/**
 * `GET /app/status`: maintenance, and whether this caller is let through.
 * A tester whose session has just expired is still told `bypass` — their
 * next request is a 401 the app refreshes, not the maintenance screen.
 */
export async function appStatus(authorization: string | undefined): Promise<AppStatus> {
  const state = await maintenanceState();
  const subject = state.active ? bearerSubject(authorization) : null;
  const bypass = subject ? await canBypassMaintenance(subject.sub) : false;
  return appStatusSchema.parse({
    maintenance: { active: state.active, bypass: state.active && bypass, title: state.title, message: state.message, endsAt: state.endsAt },
  });
}
