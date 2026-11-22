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
/**
 * How long a key may say "in progress" before it is taken to be abandoned.
 *
 * A request that dies mid-way — the process restarted, the deploy rolled —
 * never writes its answer, and its row would otherwise answer `IN_PROGRESS`
 * to every retry for the row's whole day: a member whose checkout was cut
 * off could not finish it, under the one key that makes finishing it safe.
 * Two minutes is far past any request this server serves, and the routes
 * that move money answer for a key themselves as well (an order carries
 * the checkout's key; a payment, a cancel are idempotent on the order's
 * state), so running one again after this is a replay, not a repeat.
 */
const ABANDONED_AFTER_MS = 2 * 60_000;

export const idempotent: RequestHandler = async (req, res, next) => {
  const key = req.ctx.idempotencyKey;
  const userId = req.ctx.userId;
  if (!key || !userId) return next();

  const id = `${userId}:${key}`;
  const existing = await IdempotencyModel.findById(id).lean();
  if (existing) {
    if (existing.status !== 0) {
      res.status(existing.status ?? 200).json(existing.body);
      return;
    }
    const startedAt = existing.createdAt instanceof Date ? existing.createdAt.getTime() : Date.now();
    if (Date.now() - startedAt < ABANDONED_AFTER_MS) {
      return next(Errors.conflict('IN_PROGRESS', 'That request is still being processed.'));
    }
    // Abandoned: take it over — exactly one retry does, the one whose
    // conditional write still finds the row as it was read.
    const taken = await IdempotencyModel.updateOne(
      { _id: id, status: 0, createdAt: existing.createdAt },
      { $set: { createdAt: new Date() } },
    );
    if (taken.modifiedCount === 0) return next(Errors.conflict('IN_PROGRESS', 'That request is still being processed.'));
  } else {
    try {
      await IdempotencyModel.create({ _id: id, status: 0, body: null });
    } catch {
      return next(Errors.conflict('IN_PROGRESS', 'That request is still being processed.'));
    }
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
