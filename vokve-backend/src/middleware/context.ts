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
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx: RequestContext;
  }
}

export function ctxOf(req: Request): RequestContext {
  return req.ctx;
}
