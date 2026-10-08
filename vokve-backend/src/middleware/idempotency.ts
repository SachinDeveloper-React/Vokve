import type { RequestHandler } from 'express';
import { IdempotencyModel } from '../modules/platform/models.js';
import { Errors } from '../lib/errors.js';

/**
 * Replays a stored response for a repeated (user, key). The client retries
 * transport failures up to three times, so every mutating route mounts this
 * (BACKEND §3.6). Without a key the request simply runs.
 *
 * Only an answer that *did* something is worth replaying. A request that
 * was refused changed nothing, so its key is freed rather than stored: the
 * app keeps one key for the whole of an attempt, and a checkout refused
 * for want of a step-up code is retried under that same key with the code
 * added. Storing the refusal would hand it straight back, the app would
 * ask for another code, and the member would be stuck in an OTP loop with
 * an order that can never be placed (MEMORY §7.17).
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
    const status = res.statusCode;
    void (status >= 400
      ? IdempotencyModel.deleteOne({ _id: id })
      : IdempotencyModel.updateOne({ _id: id }, { $set: { status, body } })
    ).catch(() => {});
    return originalJson(body);
  };
  next();
};
