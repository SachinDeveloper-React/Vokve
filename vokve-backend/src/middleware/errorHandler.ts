import type { ErrorRequestHandler, Response } from 'express';
import { ApiError } from '../lib/errors.js';
import { alertUnexpectedError } from '../lib/serverErrors.js';

/**
 * Answers with the one error shape, and leaves what it answered on the
 * response for the request log (`app.ts`): the code and message on every
 * error, and the thrown error itself — stack and all — on a 5xx, so the
 * request's own log line is where a crash shows up rather than a second,
 * unconnected one.
 */
function fail(res: Response, status: number, body: { code: string; message: string; details: Record<string, unknown> | null }, cause?: unknown) {
  // Flat names: the logger redacts `*.code` (OTP codes), which would blank a
  // nested `{ code }` here.
  res.locals.errorCode = body.code;
  res.locals.errorMessage = body.message;
  res.locals.errorDetails = body.details;
  if (status >= 500 && cause) res.err = cause instanceof Error ? cause : new Error(String(cause));
  res.status(status).json({ error: body });
}

export const errorHandler: ErrorRequestHandler = async (err, req, res, _next) => {
  if (err instanceof ApiError) {
    // Standard header alongside the body's retryAfterSeconds, for proxies and
    // any client that reads headers before bodies.
    const retryAfter = err.details?.retryAfterSeconds;
    if (err.status === 429 && typeof retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter));
    fail(res, err.status, err.toJSON().error, err);
    return;
  }
  // Mongo duplicate key on a unique index — surfaces as a conflict the client can read.
  if (typeof err === 'object' && err && (err as { code?: number }).code === 11000) {
    fail(res, 409, { code: 'DUPLICATE', message: 'That already exists.', details: null });
    return;
  }
  if (err?.type === 'entity.too.large') {
    fail(res, 413, { code: 'PAYLOAD_TOO_LARGE', message: 'That is too large to send.', details: null });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    fail(res, 400, { code: 'BAD_JSON', message: 'The request body is not valid JSON.', details: null });
    return;
  }
  // Before answering, not after: on a serverless host the instance can be
  // frozen the moment the response is out (RULES P20). Bounded and quiet
  // for an hour per route, so at worst the first failure waits a few seconds.
  await alertUnexpectedError(req, err);
  fail(res, 500, { code: 'INTERNAL', message: 'Something went wrong on our side. Please try again.', details: null }, err);
};
