import { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { requireAdmin } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { confirmFlag, dismissFlag, fraudCase, fraudQueue, rescoreDay } from './fraud.service.js';
import {
  listReleases,
  releaseBody,
  saveRelease,
  setUpdatePolicy,
  updatePolicyBody,
} from './releases.service.js';
import {
  activity,
  activitySummary,
  devicePermissions,
  findUsers,
  loginHistory,
  userOverview,
} from './service.js';

/**
 * The operator's own surface for one member (BACKEND §14.14, RULES P15):
 * who they are, when they installed the app and on what, when they signed
 * in, when they were last here, which phones they use, what those phones
 * allow, and everything they have done in the app.
 *
 * And the fraud review queue (RULES A27): who the layers have flagged, the
 * evidence behind each flag, and the two verdicts — confirmed, which voids
 * what the day was holding, and dismissed, which gives back the trust the
 * open flag was costing.
 *
 * Under `/v1/admin` and the operator's key alone — no member token reaches
 * it, and with no key configured every route here answers 404 rather than
 * advertising a door. Everything about a member is read-only; the only
 * writes are the verdict on a flag and a re-score of a day, and both are
 * about our own judgement rather than about their account.
 */
export const adminUsersRouter = Router();
adminUsersRouter.use('/admin', requireAdmin);

const usersQuery = z.object({
  /** An id, an email, a phone or part of a name. Empty lists the newest accounts. */
  q: z.string().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Which account is being asked about — the way in to everything below. */
adminUsersRouter.get('/admin/users', validate('query', usersQuery), async (req, res) => {
  const { q, limit } = req.query as unknown as z.infer<typeof usersQuery>;
  res.json(await findUsers(q, limit));
});

/** The whole member in one answer: account, installs, sessions, wallet, orders, trail. */
adminUsersRouter.get('/admin/users/:userId', async (req, res) => {
  res.json(await userOverview(String(req.params.userId)));
});

const loginsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

/** Every sign-in, newest first: when, on which phone, on which build. */
adminUsersRouter.get('/admin/users/:userId/logins', validate('query', loginsQuery), async (req, res) => {
  const { limit } = req.query as unknown as z.infer<typeof loginsQuery>;
  res.json(await loginHistory(String(req.params.userId), limit));
});

const activityQuery = z.object({
  cursor: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** One event name — `screen_view` for pages alone, `order_paid` for orders. */
  name: z.string().max(60).optional(),
  /** One screen, for "every time they opened Checkout". */
  screen: z.string().max(60).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

/** The trail itself, newest first. */
adminUsersRouter.get('/admin/users/:userId/activity', validate('query', activityQuery), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof activityQuery>;
  res.json(await activity(String(req.params.userId), query));
});

const summaryQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

/** The trail as a shape: screens by visits, actions by count, events by day. */
adminUsersRouter.get(
  '/admin/users/:userId/activity/summary',
  validate('query', summaryQuery),
  async (req, res) => {
    const { days } = req.query as unknown as z.infer<typeof summaryQuery>;
    res.json(await activitySummary(String(req.params.userId), days));
  },
);

/** Every install on the account, what it allows, and when that last changed. */
adminUsersRouter.get('/admin/users/:userId/permissions', async (req, res) => {
  res.json(await devicePermissions(String(req.params.userId)));
});

// ─── The fraud review queue (RULES A27) ────────────────────────────────────

const queueQuery = z.object({
  status: z.enum(['open', 'confirmed', 'dismissed', 'any']).default('open'),
  severity: z.enum(['hard', 'soft', 'any']).default('any'),
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

/** Who has something to answer for, worst first. */
adminUsersRouter.get('/admin/fraud/queue', validate('query', queueQuery), async (req, res) => {
  res.json(await fraudQueue(req.query as unknown as z.infer<typeof queueQuery>));
});

const caseQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/** One account's case file: the flags, the days behind them, the holds, the proofs. */
adminUsersRouter.get('/admin/fraud/users/:userId', validate('query', caseQuery), async (req, res) => {
  const { days } = req.query as unknown as z.infer<typeof caseQuery>;
  res.json(await fraudCase(String(req.params.userId), days));
});

const verdictBody = z.object({ note: z.string().trim().max(500).optional() });

/** Confirmed: the day's coins in escrow are voided (RULES T7). */
adminUsersRouter.post('/admin/fraud/flags/:flagId/confirm', validate('body', verdictBody), async (req, res) => {
  res.json(await confirmFlag(req.ctx.adminActor!, String(req.params.flagId), req.body.note));
});

/** Dismissed: the day stands, and the score the flag was costing comes back. */
adminUsersRouter.post('/admin/fraud/flags/:flagId/dismiss', validate('body', verdictBody), async (req, res) => {
  res.json(await dismissFlag(req.ctx.adminActor!, String(req.params.flagId), req.body.note));
});

const rescoreParams = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/**
 * Scores a day again from the evidence already stored — what a threshold
 * change would have done to a real day, without waiting for that phone to
 * send anything.
 */
adminUsersRouter.post(
  '/admin/users/:userId/days/:date/rescore',
  async (req, res, next) => {
    const parsed = rescoreParams.safeParse({ date: req.params.date });
    if (!parsed.success) return next(Errors.notFound('That day'));
    next();
  },
  async (req, res) => {
    res.json(await rescoreDay(req.ctx.adminActor!, String(req.params.userId), String(req.params.date)));
  },
);

// ─── Releases and the update wall (RULES DV12) ─────────────────────────────

/** Every known build with its status, the minimum in force, and which builds it refuses. */
adminUsersRouter.get(
  '/admin/releases',
  validate('query', z.object({ platform: z.enum(['ios', 'android']).optional() })),
  async (req, res) => {
    const { platform } = req.query as unknown as { platform?: 'ios' | 'android' };
    res.json(await listReleases(platform));
  },
);

/**
 * Records the build the store is now serving. A knock at most: it never
 * walls anybody off on its own — that is the minimum, below.
 */
adminUsersRouter.post('/admin/releases', validate('body', releaseBody), async (req, res) => {
  res.status(201).json(await saveRelease(req.ctx.adminActor!, req.body));
});

/**
 * The wall itself, and the words on both prompts. Raising `minVersion` is
 * what makes an update mandatory; it is refused if it would leave members
 * with no build to update to.
 */
adminUsersRouter.put('/admin/app/update-policy', validate('body', updatePolicyBody), async (req, res) => {
  res.json(await setUpdatePolicy(req.ctx.adminActor!, req.body));
});
