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
import { analyticsOverview, recentSignups } from './analytics.service.js';
import { broadcastBody, previewBroadcast, segmentSchema, sendBroadcast } from './broadcast.service.js';
import {
  catalogueQuery,
  getCatalogueItem,
  itemBody,
  itemPatch,
  listCatalogue,
  patchItem,
  retireItem,
  saveItem,
} from './catalogue.service.js';
import {
  adjustBody,
  adjustMemberCoins,
  auditQuery,
  grantBadge,
  grantBadgeBody,
  memberAudit,
  setMemberStatus,
  statusBody,
} from './moderation.service.js';
import {
  addressBody,
  advanceBody,
  advanceOrder,
  cancelBody,
  cancelOrder,
  orderQueue,
  orderQueueQuery,
  refundBody,
  refundOrder,
  setOrderAddress,
  setStock,
  stockBody,
} from './orders.service.js';
import {
  ledgerQuery,
  memberAchievements,
  memberLedger,
  memberOrders,
  memberSteps,
  memberWallet,
  orderDetail,
  ordersQuery,
  stepsQuery,
} from './profile.service.js';
import { setStepsConfig, setStepsConfigBody, stepsConfig } from './config.service.js';
import {
  memberConfig,
  memberConfigBody,
  memberNotifications,
  memberNotificationsQuery,
  nudgeBody,
  nudgeMemberSync,
  sendMemberNotification,
  sendNotificationBody,
  updateMemberConfig,
} from './member.service.js';
import { fleetHealth, userProblems } from './problems.service.js';
import { shadowReport } from './shadow.service.js';
import {
  activity,
  activitySummary,
  deviceHealth,
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
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  tier: z.enum(['trusted', 'normal', 'watch', 'restricted', 'banned']).optional(),
  platform: z.enum(['ios', 'android']).optional(),
  /** The states support asks for by name. */
  status: z.enum(['any', 'frozen', 'deleted', 'unverified', 'deleting']).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'trust']).default('newest'),
});

/** Which account is being asked about — the way in to everything below. */
adminUsersRouter.get('/admin/users', validate('query', usersQuery), async (req, res) => {
  res.json(await findUsers(req.query as unknown as z.infer<typeof usersQuery>));
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

/**
 * The diagnosis, in words (RULES P18): what is wrong for this member, worst
 * first, each finding with the evidence behind it and what to do about it.
 *
 * The read support actually wants. Everything in it can be had from the five
 * endpoints above — this is the one that asks the questions in the right
 * order so nobody has to know what order that is.
 */
adminUsersRouter.get('/admin/users/:userId/problems', async (req, res) => {
  res.json(await userProblems(String(req.params.userId)));
});

const fleetQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

/**
 * The same questions asked of every install (RULES P18): how many are quiet,
 * how many have a dead counter and on whose phones, which build is crashing,
 * and the faults themselves worst first.
 *
 * Under `/admin/health/...` rather than a member's path, because it is not
 * about a member: it is the list of what to fix next.
 */
adminUsersRouter.get('/admin/health/fleet', validate('query', fleetQuery), async (req, res) => {
  const { days } = req.query as unknown as z.infer<typeof fleetQuery>;
  res.json(await fleetHealth(days));
});

const healthQuery = z.object({ errors: z.coerce.number().int().min(1).max(100).default(25) });

/**
 * Why the app is not working for them (RULES P17): each install's own
 * verdict on itself — the step service, Health Connect, the sync — beside
 * when it last reported steps, and the faults the app has hit, grouped and
 * newest first.
 */
adminUsersRouter.get('/admin/users/:userId/health', validate('query', healthQuery), async (req, res) => {
  const { errors } = req.query as unknown as z.infer<typeof healthQuery>;
  res.json(await deviceHealth(String(req.params.userId), errors));
});

// ─── The dashboard's own numbers ───────────────────────────────────────────

const analyticsQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/**
 * Growth, use, steps, coins and orders over one window — the read behind the
 * operator's dashboard. Bucketed in the zone the request carries
 * (`X-Vokve-Timezone`), so a day on the dashboard is the day the operator is
 * living in rather than UTC's.
 */
adminUsersRouter.get('/admin/analytics/overview', validate('query', analyticsQuery), async (req, res) => {
  const { days } = req.query as unknown as z.infer<typeof analyticsQuery>;
  res.json(await analyticsOverview(days, req.ctx.timezone));
});

const signupsQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(8) });

/** The newest accounts, name and date only — the dashboard's arrivals strip. */
adminUsersRouter.get('/admin/analytics/signups', validate('query', signupsQuery), async (req, res) => {
  const { limit } = req.query as unknown as z.infer<typeof signupsQuery>;
  res.json(await recentSignups(limit));
});

// ─── Step coins before they are switched on (D-05) ─────────────────────────

const shadowQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });

/**
 * What ⚙ `coins.steps.enabled` would have cost, and how much of what members
 * walked the layers actually verified. The read behind that decision: a coin
 * once minted cannot be taken back, so the rate is judged on days already
 * scored rather than on the first week of live minting.
 */
adminUsersRouter.get('/admin/activity/shadow', validate('query', shadowQuery), async (req, res) => {
  const { days } = req.query as unknown as z.infer<typeof shadowQuery>;
  res.json(await shadowReport(days, req.ctx.timezone));
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

// ─── The rest of one member (RULES P15) ────────────────────────────────────

/**
 * What they have walked, day by day, with what judged each day and whether
 * it hit the goal they actually set. Bucketed by their own local day.
 */
adminUsersRouter.get('/admin/users/:userId/steps', validate('query', stepsQuery), async (req, res) => {
  res.json(await memberSteps(String(req.params.userId), req.query as unknown as z.infer<typeof stepsQuery>));
});

/** The wallet, the escrow, the daily ceilings, and the totals by source. */
adminUsersRouter.get('/admin/users/:userId/wallet', async (req, res) => {
  res.json(await memberWallet(String(req.params.userId)));
});

/**
 * Every coin in and out, newest first. The ledger is append-only, so these
 * rows *are* the arithmetic behind the balance rather than a summary of it.
 */
adminUsersRouter.get('/admin/users/:userId/ledger', validate('query', ledgerQuery), async (req, res) => {
  res.json(await memberLedger(String(req.params.userId), req.query as unknown as z.infer<typeof ledgerQuery>));
});

/**
 * The whole badge shelf with their own unlocks on it, and every challenge
 * period they finished with what it actually paid.
 */
adminUsersRouter.get('/admin/users/:userId/achievements', async (req, res) => {
  res.json(await memberAchievements(String(req.params.userId)));
});

/** What they have bought, newest first. */
adminUsersRouter.get('/admin/users/:userId/orders', validate('query', ordersQuery), async (req, res) => {
  res.json(await memberOrders(String(req.params.userId), req.query as unknown as z.infer<typeof ordersQuery>));
});

/** One order in full: every line, the address as it was, and its own history. */
adminUsersRouter.get('/admin/orders/:orderId', async (req, res) => {
  res.json(await orderDetail(String(req.params.orderId)));
});

/** Every operator action on this account, newest first — the panel's receipt. */
adminUsersRouter.get('/admin/users/:userId/audit', validate('query', auditQuery), async (req, res) => {
  const { limit } = req.query as unknown as z.infer<typeof auditQuery>;
  res.json(await memberAudit(String(req.params.userId), limit));
});

// ─── The two things an operator may change about an account ────────────────

/**
 * Frozen stops the account spending and leaves everything else alone; a
 * legal hold keeps it out of the deletion job's way. Both need a reason.
 */
adminUsersRouter.put('/admin/users/:userId/status', validate('body', statusBody), async (req, res) => {
  res.json(await setMemberStatus(req.ctx.adminActor!, String(req.params.userId), req.body));
});

/**
 * A correction to what they were paid, as a new ledger row (RULES E2) —
 * positive credits, negative claws back. This is the tool the fraud queue
 * points at for coins that were already released.
 */
adminUsersRouter.post('/admin/users/:userId/coins', validate('body', adjustBody), async (req, res) => {
  res.status(201).json(await adjustMemberCoins(req.ctx.adminActor!, String(req.params.userId), req.body));
});

// ─── The order book, and the three things support does to an order ─────────

/**
 * Every order, not one member's: what needs packing, what is stuck unpaid,
 * what was refunded last week. `paidWith` is the shop's mixed economy as a
 * filter — a coins-only order has no money to chase and a money-only one has
 * no coins to put back (RULES R11).
 */
adminUsersRouter.get('/admin/orders', validate('query', orderQueueQuery), async (req, res) => {
  res.json(await orderQueue(req.query as unknown as z.infer<typeof orderQueueQuery>));
});

/** Moves it along, forwards only, and never out of a finished state. */
adminUsersRouter.put('/admin/orders/:orderId/status', validate('body', advanceBody), async (req, res) => {
  res.json(await advanceOrder(req.ctx.adminActor!, String(req.params.orderId), req.body));
});

/**
 * Undoes it: the same path the member's own cancel takes, so the coins, the
 * stock, the coupon and the gateway refund cannot be forgotten here and
 * remembered there.
 */
adminUsersRouter.post('/admin/orders/:orderId/cancel', validate('body', cancelBody), async (req, res) => {
  res.json(await cancelOrder(req.ctx.adminActor!, String(req.params.orderId), req.body.reason));
});

/**
 * Puts a finished order's money and coins back. Not a cancel: a delivered
 * order's stock is in somebody's house, and this does not pretend otherwise.
 */
adminUsersRouter.post('/admin/orders/:orderId/refund', validate('body', refundBody), async (req, res) => {
  res.json(await refundOrder(req.ctx.adminActor!, String(req.params.orderId), req.body));
});

/**
 * Corrects the address on the order's own snapshot (RULES R4) — the typo
 * case. Only while the parcel has not left.
 */
adminUsersRouter.put('/admin/orders/:orderId/address', validate('body', addressBody), async (req, res) => {
  res.json(await setOrderAddress(req.ctx.adminActor!, String(req.params.orderId), req.body));
});

// ─── The shelf (RULES R1, R11) ─────────────────────────────────────────────

/** The catalogue as the operator needs it: retired rows, stock, and how each item may be paid for. */
adminUsersRouter.get('/admin/shop/items', validate('query', catalogueQuery), async (req, res) => {
  res.json(await listCatalogue(req.query as unknown as z.infer<typeof catalogueQuery>));
});

adminUsersRouter.get('/admin/shop/items/:itemId', async (req, res) => {
  res.json(await getCatalogueItem(String(req.params.itemId)));
});

/** Creates or rewrites one item, idempotent on its slug. */
adminUsersRouter.post('/admin/shop/items', validate('body', itemBody), async (req, res) => {
  const result = await saveItem(req.ctx.adminActor!, req.body);
  res.status(result.created ? 201 : 200).json(result);
});

/** A patch, for the one field somebody came to change. */
adminUsersRouter.put('/admin/shop/items/:itemId', validate('body', itemPatch), async (req, res) => {
  res.json(await patchItem(req.ctx.adminActor!, String(req.params.itemId), req.body));
});

/**
 * Takes it off the shelf — never a delete, so every order that holds it
 * stays readable. `{ "active": true }` puts it back.
 */
adminUsersRouter.delete(
  '/admin/shop/items/:itemId',
  validate('body', z.object({ active: z.boolean().default(false), note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await retireItem(req.ctx.adminActor!, String(req.params.itemId), req.body.active, req.body.note));
  },
);

/** Stock, the other half of an order going wrong. */
adminUsersRouter.put('/admin/shop/items/:itemId/stock', validate('body', stockBody), async (req, res) => {
  res.json(await setStock(req.ctx.adminActor!, String(req.params.itemId), req.body));
});

// ─── Badges by hand, and telling more than one member ──────────────────────

/**
 * Unlocks one badge, through the same path the rules use: it pays what the
 * badge is worth where badge coins are on, tells the member, and granting one
 * they already hold is a no-op.
 */
adminUsersRouter.post(
  '/admin/users/:userId/achievements',
  validate('body', grantBadgeBody),
  async (req, res) => {
    res.status(201).json(await grantBadge(req.ctx.adminActor!, String(req.params.userId), req.body));
  },
);

/** How many a segment is, without sending anything. Read this before the send. */
adminUsersRouter.get('/admin/notifications/preview', validate('query', segmentSchema), async (req, res) => {
  res.json(await previewBroadcast(req.query as unknown as z.infer<typeof segmentSchema>));
});

/**
 * Tells a segment something. `confirm: true`, a reason, and the count the
 * preview gave are all required — a segment that has moved by more than a
 * tenth since is refused rather than sent to.
 */
adminUsersRouter.post('/admin/notifications/broadcast', validate('body', broadcastBody), async (req, res) => {
  res.status(202).json(await sendBroadcast(req.ctx.adminActor!, req.body));
});

// ─── The step pipeline's own knobs ─────────────────────────────────────────

/**
 * Everything that decides what happens to a member's steps: what the phone
 * is told to count, when it must have reported by, what the layers refuse,
 * what a verified day is worth, and what each trust tier lets through.
 *
 * Read with both the effective value and the code's default beside it, so
 * "why is this not what the code says" is answerable without a database
 * client.
 */
adminUsersRouter.get('/admin/config/steps', async (_req, res) => {
  res.json(await stepsConfig());
});

/**
 * Changes some of them. A patch is merged onto the live config and
 * validated **before** it is written: `validate()` runs on read, so an
 * invalid document would fail every request in the process rather than the
 * write that caused it. `reset` puts a key back to the code's default.
 */
adminUsersRouter.put('/admin/config/steps', validate('body', setStepsConfigBody), async (req, res) => {
  res.json(await setStepsConfig(req.ctx.adminActor!, req.body));
});

// ─── One member's own settings, and what we tell them ──────────────────────

/** Their goal, their ceiling, their phones' reporting, and what can reach them. */
adminUsersRouter.get('/admin/users/:userId/config', async (req, res) => {
  res.json(await memberConfig(String(req.params.userId)));
});

/**
 * The little of it an operator may change: the step goal, the timezone, and
 * a notification switch — **off only**. Turning one back on is consent, and
 * the member does that in the app.
 */
adminUsersRouter.put('/admin/users/:userId/config', validate('body', memberConfigBody), async (req, res) => {
  res.json(await updateMemberConfig(req.ctx.adminActor!, String(req.params.userId), req.body));
});

/** Their notification centre, with what became of each push. */
adminUsersRouter.get(
  '/admin/users/:userId/notifications',
  validate('query', memberNotificationsQuery),
  async (req, res) => {
    res.json(await memberNotifications(String(req.params.userId), req.query as never));
  },
);

/** Tells them something, through the same path every job uses. */
adminUsersRouter.post(
  '/admin/users/:userId/notifications',
  validate('body', sendNotificationBody),
  async (req, res) => {
    res.status(201).json(await sendMemberNotification(req.ctx.adminActor!, String(req.params.userId), req.body));
  },
);

/** The silent "sync now" push (A28), sent to this member's phones at once. */
adminUsersRouter.post('/admin/users/:userId/sync-nudge', validate('body', nudgeBody), async (req, res) => {
  res.json(await nudgeMemberSync(req.ctx.adminActor!, String(req.params.userId), req.body));
});

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
