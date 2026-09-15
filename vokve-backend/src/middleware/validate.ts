import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { Errors } from '../lib/errors.js';

/**
 * Validates `req.body` / `req.query` against a zod schema and replaces them
 * with the parsed value. Field errors come back keyed by path, which is what
 * the client's forms attach to inputs (BACKEND §3.3).
 */
export function validate(where: 'body' | 'query', schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[where]);
    if (!result.success) {
      const details: Record<string, string> = {};
      for (const issue of result.error.issues) {
        details[issue.path.join('.') || '_'] = issue.message;
      }
      return next(Errors.validation(details));
    }
    if (where === 'body') req.body = result.data;
    else Object.defineProperty(req, 'query', { value: result.data, writable: true });
    next();
  };
}
