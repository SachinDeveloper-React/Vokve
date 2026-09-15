import type { RequestHandler } from 'express';
import { IdempotencyModel } from '../modules/platform/models.js';
import { Errors } from '../lib/errors.js';

/**
 * Replays a stored response for a repeated (user, key). The client retries
 * transport failures up to three times, so every mutating route mounts this
 * (BACKEND §3.6). Without a key the request simply runs.
 */
export const idempotent: RequestHandler = async (req, res, next) => {
  const key = req.ctx.idempotencyKey;
  const userId = req.ctx.userId;
  if (!key || !userId) return next();

  const id = `${userId}:${key}`;
  const existing = await IdempotencyModel.findById(id).lean();
  if (existing) {
    if (existing.status === 0) return next(Errors.conflict('IN_PROGRESS', 'That request is still being processed.'));
    res.status(existing.status ?? 200).json(existing.body);
    return;
  }

  try {
    await IdempotencyModel.create({ _id: id, status: 0, body: null });
  } catch {
    return next(Errors.conflict('IN_PROGRESS', 'That request is still being processed.'));
  }

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    void IdempotencyModel.updateOne({ _id: id }, { $set: { status: res.statusCode, body } }).catch(() => {});
    return originalJson(body);
  };
  next();
};
