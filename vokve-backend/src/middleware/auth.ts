import type { RequestHandler } from 'express';
import { Errors } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/tokens.js';

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const claims = token ? verifyAccessToken(token) : null;
  if (!claims) return next(Errors.unauthorized());
  req.ctx.userId = claims.sub;
  req.ctx.trustTier = claims.tier;
  req.ctx.sessionIssuedAt = claims.iat !== null ? new Date(claims.iat * 1000) : undefined;
  req.ctx.authenticatedAt = claims.auth !== null ? new Date(claims.auth * 1000) : undefined;
  next();
};
