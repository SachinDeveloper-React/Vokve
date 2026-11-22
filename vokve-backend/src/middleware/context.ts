import type { Request } from 'express';

/** What every handler can rely on once the auth + device plugins have run. */
export interface RequestContext {
  requestId: string;
  userId?: string;
  trustTier?: string;
  deviceId?: string;
  platform?: 'ios' | 'android';
  appVersion?: string;
  build?: string;
  osVersion?: string;
  timezone: string;
  locale?: string;
  idempotencyKey?: string;
  /** Who the admin key authenticated as, on `/v1/admin/*` only. */
  adminActor?: string;
  /** The person behind an admin request: a member of staff, or the break-glass key (RULES Z9). */
  staff?: StaffPrincipal;
  /** The permission the matched admin route asked for, for the activity log. */
  permission?: string;
}

/**
 * Whoever is on the admin surface. `root` is the `ADMIN_API_KEY` — the
 * break-glass door, everything allowed and every use logged.
 */
export interface StaffPrincipal {
  kind: 'staff' | 'root';
  id: string;
  role: 'root' | 'admin' | 'manager' | 'agent';
  name: string;
  email: string | null;
  managerId: string | null;
  permissions: ReadonlySet<string>;
  sessionId: string | null;
  /** Has to set a password or enrol an authenticator before anything else. */
  restricted: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx: RequestContext;
  }
}

export function ctxOf(req: Request): RequestContext {
  return req.ctx;
}
