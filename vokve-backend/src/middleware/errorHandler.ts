import type { ErrorRequestHandler } from 'express';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error({ err, requestId: req.ctx?.requestId }, err.code);
    // Standard header alongside the body's retryAfterSeconds, for proxies and
    // any client that reads headers before bodies.
    const retryAfter = err.details?.retryAfterSeconds;
    if (err.status === 429 && typeof retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter));
    res.status(err.status).json(err.toJSON());
    return;
  }
  // Mongo duplicate key on a unique index — surfaces as a conflict the client can read.
  if (typeof err === 'object' && err && (err as { code?: number }).code === 11000) {
    res.status(409).json({ error: { code: 'DUPLICATE', message: 'That already exists.', details: null } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'The request body is not valid JSON.', details: null } });
    return;
  }
  logger.error({ err, requestId: req.ctx?.requestId }, 'unhandled');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', details: null } });
};
