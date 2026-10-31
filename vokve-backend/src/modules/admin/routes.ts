import { Router } from 'express';
import { z } from 'zod';
import { notificationPreferenceSchema } from '../../contracts/index.js';
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
  deleteItem,
  getCatalogueItem,
  importItems,
  itemBody,
  itemImportRow,
  itemInsight,
  itemPatch,
  listCatalogue,
  patchItem,
  retireItem,
  saveItem,
} from './catalogue.service.js';
import {
  createExercise,
  createTemplate,
  deleteExercise,
  deleteTemplate,
  exerciseBody,
  exercisePatch,
  listTraining,
  templateBody,
  templatePatch,
  updateExercise,
  updateTemplate,
} from './training.service.js';
import {
  achievementBody,
  achievementPatch,
  challengeBody,
  challengePatch,
  createAchievement,
  createChallenge,
  deleteAchievement,
  deleteChallenge,
  getAchievement,
  getChallenge,
  listAchievements,
  listChallenges,
  setChallengeActive,
  updateAchievement,
  updateChallenge,
} from './gamification.service.js';
import {
  categoryBody,
  categoryDeleteBody,
  categoryPatch,
  createCategory,
  createSubcategory,
  deleteCategory,
  deleteSubcategory,
  listCategories,
  recategoriseBody,
  recategoriseItems,
  renameSubcategory,
  subcategoryBody,
  subcategoryCreateBody,
  subcategoryDeleteBody,
  subcategoryPatchBody,
  updateCategory,
  updateSubcategory,
} from './categories.service.js';
import {
  couponBody,
  couponPatch,
  couponQuery,
  deleteCoupon,
  getCoupon,
  listCoupons,
  patchCoupon,
  saveCoupon,
  setCouponActive,
} from './coupons.service.js';
import {
  basketLineBody,
  basketNoteBody,
  basketQuery,
  clearBasket,
  clearBasketCoupon,
  demand,
  demandQuery,
  getBasket,
  listBaskets,
  removeBasketLine,
  removeWishlistEntry,
} from './baskets.service.js';
import { deleteReview, deleteReviewBody, listReviews, reviewQuery } from './reviews.service.js';
import {
  adjustBody,
  adjustMemberCoins,
  auditQuery,
  grantBadge,
  grantBadgeBody,
  memberAudit,
  setMemberStatus,
  statusBody,
  verifyContactBody,
  verifyMemberContact,
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
import {
  appConfig,
  setAppConfig,
  setAppConfigBody,
  setStepsConfig,
  setStepsConfigBody,
  stepsConfig,
} from './config.service.js';
import {
  broadcastHistory,
  deleteNotification,
  deleteNotificationBody,
  listNotifications,
  notificationConsent,
  notificationQuery,
  retractBody,
  retractBroadcast,
} from './notifications.service.js';
import {
  deleteTicket,
  deleteTicketBody,
  getTicket,
  listTickets,
  replyBody,
  replyToTicket,
  setTicketStatus,
  ticketQuery,
  ticketStatusBody,
} from './support.service.js';
import {
  deleteFaq,
  deleteGuideSection,
  faqBody,
  faqPatch,
  faqQuery,
  guideBody,
  listFaqs,
  listGuide,
  patchFaq,
  saveFaq,
  saveGuideSection,
} from './faq.service.js';
import { adminLeaderboard, adminLeaderboardQuery } from './leaderboard.service.js';
import {
  addTips,
  deleteTip,
  listTips,
  patchTip,
  saveTip,
  tipBody,
  tipPatch,
  tipQuery,
  tipsBody,
} from './tips.service.js';
import {
  deleteReferralCard,
  listReferralCards,
  patchReferralCard,
  referralCardBody,
  referralCardPatch,
  referralCardQuery,
  saveReferralCard,
} from './referralCards.service.js';
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
import { rejectionBody, setDayRejections } from './rejection.service.js';
import { stepsTimeline, timelineQuery } from './timeline.service.js';
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
  /**
   * Accounts that have switched one subject off (RULES P14) — the drill-down
   * from the consent report, so "412 have offers off" names them.
   */
  silenced: notificationPreferenceSchema.optional(),
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

/**
 * One day minute by minute: every phone that claimed each minute, which one
 * the day took it from, and what was dropped because another phone claimed
 * the same minute (D-53). The answer to "the phone says 11,000 and the day
 * says 8,000" at the grain the decision is actually made.
 *
 * `?overlapsOnly=true` returns only the minutes more than one phone
 * claimed — the ones worth looking at when a member has several installs.
 */
adminUsersRouter.get('/admin/users/:userId/steps/timeline', validate('query', timelineQuery), async (req, res) => {
  res.json(await stepsTimeline(String(req.params.userId), req.query as unknown as z.infer<typeof timelineQuery>));
});

/**
 * Which of a day's phones it is allowed to count (D-88). The per-minute pick
 * settles a walk two phones both saw; this is for the case arithmetic
 * cannot settle — whose leg the phone was on. The body carries the exact
 * set to reject, so `[]` lifts every rejection, and the day is re-scored
 * before the call answers.
 */
adminUsersRouter.put(
  '/admin/users/:userId/days/:date/devices/rejected',
  async (req, res, next) => {
    const parsed = rescoreParams.safeParse({ date: req.params.date });
    if (!parsed.success) return next(Errors.notFound('That day'));
    next();
  },
  validate('body', rejectionBody),
  async (req, res) => {
    res.json(await setDayRejections(req.ctx.adminActor!, String(req.params.userId), String(req.params.date), req.body));
  },
);

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
 * A contact detail proven by hand, for the member whose code never arrives
 * (RULES O5). It unlocks redeeming, so it asks for the value typed back and
 * for a reason, and there is no route that undoes it.
 */
adminUsersRouter.post('/admin/users/:userId/verify-contact', validate('body', verifyContactBody), async (req, res) => {
  res.json(await verifyMemberContact(req.ctx.adminActor!, String(req.params.userId), req.body));
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

/**
 * A spreadsheet's worth of products, matched by slug.
 *
 * Declared before `/:itemId` only in the reader's eye — Express matches the
 * literal path first whatever the order — and takes the same rows a typed-in
 * form would. `dryRun` writes nothing and answers with what *would* happen,
 * which is what the panel shows before the operator presses Import.
 */
const itemImportBody = z
  .object({ rows: z.array(itemImportRow).min(1).max(2000), dryRun: z.boolean().optional() })
  .strict();

adminUsersRouter.post('/admin/shop/items/import', validate('body', itemImportBody), async (req, res) => {
  const body = req.body as z.infer<typeof itemImportBody>;
  res.json(await importItems(req.ctx.adminActor!, body.rows, { dryRun: body.dryRun }));
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

/**
 * One product in full: what it has sold, who is waiting for it, what
 * members said about it, and who changed it last. Four collections an
 * operator would otherwise join by hand.
 */
adminUsersRouter.get('/admin/shop/items/:itemId/insight', async (req, res) => {
  res.json(await itemInsight(String(req.params.itemId)));
});

/**
 * Deletes it outright — a slug typed wrong, a draft listed by accident.
 *
 * Its own path, not the `DELETE` above, because the two are different acts
 * and only one of them is reversible. An item any order holds is refused:
 * that is a retire, and the refusal says so. Basket lines, saves and
 * reviews pointing at the row are tidied up with it.
 */
adminUsersRouter.delete(
  '/admin/shop/items/:itemId/permanent',
  validate('body', z.object({ note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await deleteItem(req.ctx.adminActor!, String(req.params.itemId), req.body.note));
  },
);

// ─── Shelves, and the subcategories under them (RULES R9) ──────────────────

/**
 * What each shelf is carrying — stock, sales, and what people want that is
 * not an order yet — with every subcategory under it.
 *
 * The shelves are rows now, not a zod enum: the app is told each one's
 * label and icon, so one added here appears on a phone that is already
 * installed.
 */
adminUsersRouter.get('/admin/shop/categories', async (_req, res) => {
  res.json(await listCategories());
});

/** Adds a shelf. The slug is derived from the name unless one is given. */
adminUsersRouter.post('/admin/shop/categories', validate('body', categoryBody), async (req, res) => {
  res.status(201).json(await createCategory(req.ctx.adminActor!, req.body));
});

/**
 * The two bulk writes, and why they are declared before `/:slug`.
 *
 * Express matches in the order routes are registered, so `/:slug` would
 * swallow `/subcategory` and `/move` — a rename would arrive as "update the
 * shelf called subcategory". These two stay above it.
 */

/**
 * Renames a subcategory across the items that hold it, or merges two by
 * renaming one to the other's name. `to: null` leaves them unfiled.
 */
adminUsersRouter.put('/admin/shop/categories/subcategory', validate('body', subcategoryBody), async (req, res) => {
  res.json(await renameSubcategory(req.ctx.adminActor!, req.body));
});

/** Moves a handful of items onto another shelf, in one write and one audit row. */
adminUsersRouter.post('/admin/shop/categories/move', validate('body', recategoriseBody), async (req, res) => {
  res.json(await recategoriseItems(req.ctx.adminActor!, req.body));
});

/** Renames a shelf, re-orders it, or takes it off the app. Never re-keys it: items carry the slug. */
adminUsersRouter.put('/admin/shop/categories/:slug', validate('body', categoryPatch), async (req, res) => {
  res.json(await updateCategory(req.ctx.adminActor!, String(req.params.slug), req.body));
});

/**
 * Deletes a shelf. `moveTo` is where its items go and is required while any
 * item is still on it — an item on a shelf that does not exist is an item
 * no filter finds.
 */
adminUsersRouter.delete('/admin/shop/categories/:slug', validate('body', categoryDeleteBody), async (req, res) => {
  res.json(await deleteCategory(req.ctx.adminActor!, String(req.params.slug), req.body));
});

/** Adds a subcategory to a shelf — the second dropdown on the item form. */
adminUsersRouter.post(
  '/admin/shop/categories/:slug/subcategories',
  validate('body', subcategoryCreateBody),
  async (req, res) => {
    res.status(201).json(await createSubcategory(req.ctx.adminActor!, String(req.params.slug), req.body));
  },
);

/** Renames one across every item that holds it; an existing name merges the two. */
adminUsersRouter.put(
  '/admin/shop/categories/:slug/subcategories/:name',
  validate('body', subcategoryPatchBody),
  async (req, res) => {
    res.json(
      await updateSubcategory(req.ctx.adminActor!, String(req.params.slug), decodeURIComponent(String(req.params.name)), req.body),
    );
  },
);

/** Removes one. `reassignTo` files its items under a neighbour; null leaves them unfiled. */
adminUsersRouter.delete(
  '/admin/shop/categories/:slug/subcategories/:name',
  validate('body', subcategoryDeleteBody),
  async (req, res) => {
    res.json(
      await deleteSubcategory(req.ctx.adminActor!, String(req.params.slug), decodeURIComponent(String(req.params.name)), req.body),
    );
  },
);

// ─── Challenges and badges (RULES C1–C7) ───────────────────────────────────

/**
 * Every challenge, with what it has actually paid: completions, members,
 * coins granted, and the ones the economy has not paid because the daily
 * ceiling or ⚙ `coins.achievements.enabled` held them (D-46).
 */
adminUsersRouter.get('/admin/challenges', async (_req, res) => {
  res.json(await listChallenges());
});

adminUsersRouter.post('/admin/challenges', validate('body', challengeBody), async (req, res) => {
  res.status(201).json(await createChallenge(req.ctx.adminActor!, req.body));
});

adminUsersRouter.get('/admin/challenges/:challengeId', async (req, res) => {
  res.json(await getChallenge(String(req.params.challengeId)));
});

adminUsersRouter.put('/admin/challenges/:challengeId', validate('body', challengePatch), async (req, res) => {
  res.json(await updateChallenge(req.ctx.adminActor!, String(req.params.challengeId), req.body));
});

/**
 * Takes it off every member's board — never a delete, so the completions
 * that paid somebody's coins stay readable. `{ "active": true }` puts it
 * back.
 */
adminUsersRouter.delete(
  '/admin/challenges/:challengeId',
  validate('body', z.object({ active: z.boolean().default(false), note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await setChallengeActive(req.ctx.adminActor!, String(req.params.challengeId), req.body.active, req.body.note));
  },
);

/** Deletes it outright — refused the moment anybody has finished it. */
adminUsersRouter.delete(
  '/admin/challenges/:challengeId/permanent',
  validate('body', z.object({ note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await deleteChallenge(req.ctx.adminActor!, String(req.params.challengeId), req.body.note));
  },
);

/** Every badge, who holds it, and what pays it out. */
adminUsersRouter.get('/admin/achievements', async (_req, res) => {
  res.json(await listAchievements());
});

adminUsersRouter.post('/admin/achievements', validate('body', achievementBody), async (req, res) => {
  res.status(201).json(await createAchievement(req.ctx.adminActor!, req.body));
});

adminUsersRouter.get('/admin/achievements/:achievementId', async (req, res) => {
  res.json(await getAchievement(String(req.params.achievementId)));
});

adminUsersRouter.put('/admin/achievements/:achievementId', validate('body', achievementPatch), async (req, res) => {
  res.json(await updateAchievement(req.ctx.adminActor!, String(req.params.achievementId), req.body));
});

/**
 * Deletes a badge: refused while anybody holds it (C7 — a badge is never
 * taken back) and while a challenge still awards it.
 */
adminUsersRouter.delete(
  '/admin/achievements/:achievementId',
  validate('body', z.object({ note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await deleteAchievement(req.ctx.adminActor!, String(req.params.achievementId), req.body.note));
  },
);

// ─── The gym: exercises and the templates built from them ──────────────────

/**
 * Every exercise and every template, with what uses each: the templates an
 * exercise is in, the sets members have logged of it, and the ids a
 * template names that no exercise answers to.
 */
adminUsersRouter.get('/admin/training', async (_req, res) => {
  res.json(await listTraining());
});

adminUsersRouter.post('/admin/training/exercises', validate('body', exerciseBody), async (req, res) => {
  res.status(201).json(await createExercise(req.ctx.adminActor!, req.body));
});

adminUsersRouter.put('/admin/training/exercises/:exerciseId', validate('body', exercisePatch), async (req, res) => {
  res.json(await updateExercise(req.ctx.adminActor!, String(req.params.exerciseId), req.body));
});

/** Refused while a template names it — the app drops a template with a hole in it. */
adminUsersRouter.delete(
  '/admin/training/exercises/:exerciseId',
  validate('body', z.object({ note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await deleteExercise(req.ctx.adminActor!, String(req.params.exerciseId), req.body.note));
  },
);

adminUsersRouter.post('/admin/training/templates', validate('body', templateBody), async (req, res) => {
  res.status(201).json(await createTemplate(req.ctx.adminActor!, req.body));
});

adminUsersRouter.put('/admin/training/templates/:templateId', validate('body', templatePatch), async (req, res) => {
  res.json(await updateTemplate(req.ctx.adminActor!, String(req.params.templateId), req.body));
});

/** A workout started from one keeps its own copy, so the row can simply go. */
adminUsersRouter.delete(
  '/admin/training/templates/:templateId',
  validate('body', z.object({ note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await deleteTemplate(req.ctx.adminActor!, String(req.params.templateId), req.body.note));
  },
);

// ─── Coupons (RULES R16) ───────────────────────────────────────────────────

/** Every coupon, with what it has actually given away. */
adminUsersRouter.get('/admin/shop/coupons', validate('query', couponQuery), async (req, res) => {
  res.json(await listCoupons(req.query as unknown as z.infer<typeof couponQuery>));
});

/** One coupon, with who claimed it and the orders that hold it. */
adminUsersRouter.get('/admin/shop/coupons/:code', async (req, res) => {
  res.json(await getCoupon(String(req.params.code)));
});

/** Creates a coupon, or rewrites the one with that code. Idempotent on the code. */
adminUsersRouter.post('/admin/shop/coupons', validate('body', couponBody), async (req, res) => {
  const result = await saveCoupon(req.ctx.adminActor!, req.body);
  res.status(result.created ? 201 : 200).json(result);
});

/** A patch, for the one field somebody came to change. */
adminUsersRouter.put('/admin/shop/coupons/:code', validate('body', couponPatch), async (req, res) => {
  res.json(await patchCoupon(req.ctx.adminActor!, String(req.params.code), req.body));
});

/**
 * Switches it off, or back on — the ordinary way to end a campaign. The
 * till tests `active` first, so this stops it applying everywhere at once.
 */
adminUsersRouter.put(
  '/admin/shop/coupons/:code/active',
  validate('body', z.object({ active: z.boolean(), note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await setCouponActive(req.ctx.adminActor!, String(req.params.code), req.body.active, req.body.note));
  },
);

/**
 * Deletes a coupon nothing ever used. One that has been redeemed is
 * refused — an order holds its own snapshot of it and the usage rows are
 * what the per-member limit is counted from.
 */
adminUsersRouter.delete(
  '/admin/shop/coupons/:code',
  validate('body', z.object({ note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await deleteCoupon(req.ctx.adminActor!, String(req.params.code), req.body.note));
  },
);

// ─── Baskets and saved items (RULES R14) ───────────────────────────────────

/**
 * Every basket with something in it, dearest or most recent first.
 *
 * `blocked` is the column to act on: lines a checkout would refuse because
 * the item was retired, deleted or ran out under them. The value is at
 * today's prices, because a basket holds references rather than snapshots.
 */
adminUsersRouter.get('/admin/shop/baskets', validate('query', basketQuery), async (req, res) => {
  res.json(await listBaskets(req.query as unknown as z.infer<typeof basketQuery>));
});

/**
 * What people want against what is on the shelf: saves and basket units
 * beside stock. Sorted by the wanting, which is the point — sales figures
 * can only ever show what was in stock.
 */
adminUsersRouter.get('/admin/shop/demand', validate('query', demandQuery), async (req, res) => {
  res.json(await demand(req.query as unknown as z.infer<typeof demandQuery>));
});

/** One member's basket and saved items — as stored, and as they see them. */
adminUsersRouter.get('/admin/users/:userId/basket', async (req, res) => {
  res.json(await getBasket(String(req.params.userId)));
});

/** Takes one line out, through the member's own cart path. */
adminUsersRouter.delete('/admin/users/:userId/basket/lines', validate('body', basketLineBody), async (req, res) => {
  res.json(await removeBasketLine(req.ctx.adminActor!, String(req.params.userId), req.body));
});

/** Takes the coupon off, for a basket stuck behind a campaign that has ended. */
adminUsersRouter.delete('/admin/users/:userId/basket/coupon', validate('body', basketNoteBody), async (req, res) => {
  res.json(await clearBasketCoupon(req.ctx.adminActor!, String(req.params.userId), req.body.reason));
});

/** Empties it, coupon and all. */
adminUsersRouter.delete('/admin/users/:userId/basket', validate('body', basketNoteBody), async (req, res) => {
  res.json(await clearBasket(req.ctx.adminActor!, String(req.params.userId), req.body.reason));
});

/** Unsaves an item for somebody. */
adminUsersRouter.delete(
  '/admin/users/:userId/wishlist/:itemId',
  validate('body', basketNoteBody),
  async (req, res) => {
    res.json(
      await removeWishlistEntry(
        req.ctx.adminActor!,
        String(req.params.userId),
        String(req.params.itemId),
        req.body.reason,
      ),
    );
  },
);

// ─── Reviews (RULES R15) ───────────────────────────────────────────────────

/** Every review, worst first if asked — which is the sort this exists for. */
adminUsersRouter.get('/admin/shop/reviews', validate('query', reviewQuery), async (req, res) => {
  res.json(await listReviews(req.query as unknown as z.infer<typeof reviewQuery>));
});

/** Takes one down and recounts the item's rating, which every list reads. */
adminUsersRouter.delete('/admin/shop/reviews/:reviewId', validate('body', deleteReviewBody), async (req, res) => {
  res.json(await deleteReview(req.ctx.adminActor!, String(req.params.reviewId), req.body.reason));
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
/**
 * Consent across the base, switch by switch (RULES P14): who will be reached,
 * who turned it off, and which switches anything is actually sent on.
 */
adminUsersRouter.get('/admin/notifications/consent', async (_req, res) => {
  res.json(await notificationConsent());
});

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
// ─── The notification system (ARCHITECTURE §5.7) ───────────────────────────

/**
 * What the app has actually told everybody, and what became of it: the feed
 * row always, the push only where consent allowed it, and `read` after.
 *
 * Nothing here sends anything — `POST /admin/notifications/broadcast` above
 * is the one send, and `notify()` is the only path to a push.
 */
adminUsersRouter.get('/admin/notifications', validate('query', notificationQuery), async (req, res) => {
  res.json(await listNotifications(req.query as unknown as z.infer<typeof notificationQuery>));
});

/**
 * Every broadcast, from the audit log, joined to what is left in the feeds:
 * the tally the send reported, beside the open rate it could not know.
 */
adminUsersRouter.get(
  '/admin/notifications/broadcasts',
  validate('query', z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) })),
  async (req, res) => {
    res.json(await broadcastHistory(Number(req.query.limit ?? 25)));
  },
);

/**
 * Takes back as much of a broadcast as can be taken back: the rows nobody
 * has opened, which also cancels any push quiet hours were still holding.
 * What was already read is left alone, and the answer says how much.
 */
adminUsersRouter.post(
  '/admin/notifications/broadcasts/:dedupeKey/retract',
  validate('body', retractBody),
  async (req, res) => {
    res.json(await retractBroadcast(req.ctx.adminActor!, String(req.params.dedupeKey), req.body.reason));
  },
);

/** One row out of one feed — which also cancels a push still being held. */
adminUsersRouter.delete('/admin/notifications/:id', validate('body', deleteNotificationBody), async (req, res) => {
  res.json(await deleteNotification(req.ctx.adminActor!, String(req.params.id), req.body.reason));
});

// ─── The support system (RULES P12) ────────────────────────────────────────

/**
 * The queue, ordered by who has been waiting longest for *us* — which is
 * computed from the thread's last message rather than stored, so it cannot
 * disagree with what the thread says.
 */
adminUsersRouter.get('/admin/support/tickets', validate('query', ticketQuery), async (req, res) => {
  res.json(await listTickets(req.query as unknown as z.infer<typeof ticketQuery>));
});

/** One ticket, its whole thread, the phone it was opened from, and their others. */
adminUsersRouter.get('/admin/support/tickets/:ticketId', async (req, res) => {
  res.json(await getTicket(String(req.params.ticketId)));
});

/**
 * Answers them, as support — and tells them, through `notify()`, so their
 * own consent decides the push. `status` moves in the same write, because
 * "reply and resolve" is one action.
 */
adminUsersRouter.post('/admin/support/tickets/:ticketId/replies', validate('body', replyBody), async (req, res) => {
  res.status(201).json(await replyToTicket(req.ctx.adminActor!, String(req.params.ticketId), req.body));
});

/** Moves its state without saying anything in the thread. */
adminUsersRouter.put('/admin/support/tickets/:ticketId/status', validate('body', ticketStatusBody), async (req, res) => {
  res.json(await setTicketStatus(req.ctx.adminActor!, String(req.params.ticketId), req.body));
});

/**
 * Deletes a ticket that should never have been one — spam, a duplicate.
 * Refused once support has replied: that would take away the member's copy
 * of what we told them. Closing is how a conversation ends.
 */
adminUsersRouter.delete('/admin/support/tickets/:ticketId', validate('body', deleteTicketBody), async (req, res) => {
  res.json(await deleteTicket(req.ctx.adminActor!, String(req.params.ticketId), req.body.reason));
});

// ─── The help centre's own content (RULES P12) ──────────────────────────────

/** The articles, with the shelves they are filed under and the empty ones. */
adminUsersRouter.get('/admin/support/faqs', validate('query', faqQuery), async (req, res) => {
  res.json(await listFaqs(req.query as unknown as z.infer<typeof faqQuery>));
});

/** Writes an article, creating it where the id is new. Idempotent on the id. */
adminUsersRouter.post('/admin/support/faqs', validate('body', faqBody), async (req, res) => {
  const result = await saveFaq(req.ctx.adminActor!, req.body);
  res.status(result.created ? 201 : 200).json(result);
});

/** A patch, for the one field somebody came to change — usually `active`. */
adminUsersRouter.put('/admin/support/faqs/:faqId', validate('body', faqPatch), async (req, res) => {
  res.json(await patchFaq(req.ctx.adminActor!, String(req.params.faqId), req.body));
});

/**
 * A real delete, unlike a shop item's: nothing holds a snapshot of an
 * article. Hiding it (`active: false`) is the other option, and the right
 * one for an answer that is wrong today and right next week.
 */
adminUsersRouter.delete(
  '/admin/support/faqs/:faqId',
  validate('body', z.object({ note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await deleteFaq(req.ctx.adminActor!, String(req.params.faqId), req.body.note));
  },
);

/** The app guide, chapter by chapter, with the icons and tints the app can draw. */
adminUsersRouter.get('/admin/support/guide', async (_req, res) => {
  res.json(await listGuide());
});

adminUsersRouter.post('/admin/support/guide', validate('body', guideBody), async (req, res) => {
  const result = await saveGuideSection(req.ctx.adminActor!, req.body);
  res.status(result.created ? 201 : 200).json(result);
});

adminUsersRouter.delete(
  '/admin/support/guide/:sectionId',
  validate('body', z.object({ note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await deleteGuideSection(req.ctx.adminActor!, String(req.params.sectionId), req.body.note));
  },
);

// ─── The weekly board, and what it pays (RULES §L) ─────────────────────────

/**
 * The board as the operator needs it: the prize ladder in force, **the words
 * the app will say** with their placeholders filled for that country, who is
 * standing in the paid places right now and what each would take, and the
 * last week that closed with what it actually paid.
 *
 * Read-only. The ladder and the copy are config, so they are written through
 * `PUT /admin/config` like every other knob — which is what puts them through
 * the cross-field validator that refuses two rungs over the same place.
 */
adminUsersRouter.get('/admin/leaderboard', validate('query', adminLeaderboardQuery), async (req, res) => {
  res.json(await adminLeaderboard(req.query as unknown as z.infer<typeof adminLeaderboardQuery>));
});

// ─── The app's own words (BACKEND §6.15) ───────────────────────────────────

/**
 * Every line the app says in its own voice, with the rotation spelled out.
 *
 * `showingToday` and `byTopic[].todayId` are the reason this is a page and
 * not a collection browser: one line per topic per day is shown, in `sort`
 * order, and which one that is today is a question only the server can
 * answer. `silentTopics` is the other half — a screen whose card is simply
 * not drawn because nothing is live for it.
 */
adminUsersRouter.get('/admin/tips', validate('query', tipQuery), async (req, res) => {
  res.json(await listTips(req.query as unknown as z.infer<typeof tipQuery>, req.ctx.timezone));
});

/** Writes a line, creating it where the id is new. Idempotent on the id. */
adminUsersRouter.post('/admin/tips', validate('body', tipBody), async (req, res) => {
  const result = await saveTip(req.ctx.adminActor!, req.body);
  res.status(result.created ? 201 : 200).json(result);
});

/**
 * A list of lines for one topic in one go — somebody arrives with twenty
 * quotes in a document, and inventing twenty ids by hand is not the job.
 */
adminUsersRouter.post('/admin/tips/bulk', validate('body', tipsBody), async (req, res) => {
  res.status(201).json(await addTips(req.ctx.adminActor!, req.body));
});

/** A patch, for the one field somebody came to change — usually `active`. */
adminUsersRouter.put('/admin/tips/:tipId', validate('body', tipPatch), async (req, res) => {
  res.json(await patchTip(req.ctx.adminActor!, String(req.params.tipId), req.body));
});

/**
 * A real delete: nothing holds a snapshot of a tip. Hiding it
 * (`active: false`) is the other option, and the right one for a line being
 * drafted or withdrawn for a fortnight.
 */
adminUsersRouter.delete(
  '/admin/tips/:tipId',
  validate('body', z.object({ note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await deleteTip(req.ctx.adminActor!, String(req.params.tipId), req.body.note));
  },
);

// ─── The invite card, screen by screen ──────────────────────

/**
 * Every invite card, with what each screen is drawing today.
 *
 * Same shape and same reasoning as the tips above: a screen with several
 * active cards rotates them a day at a time in `sort` order, so which one is
 * live is a question only the server can answer. `silentScreens` is the other
 * half — a screen carrying no card at all, which is how the invite is turned
 * off in one place without touching the rest.
 *
 * The reward is not in the rows. `{coins}` and `{friendCoins}` in the words
 * are filled from `coins.referral` as it is paying, so a card cannot promise
 * what the ledger will not honour.
 */
adminUsersRouter.get('/admin/referral-cards', validate('query', referralCardQuery), async (req, res) => {
  res.json(
    await listReferralCards(req.query as unknown as z.infer<typeof referralCardQuery>, req.ctx.timezone),
  );
});

/** Writes a card, creating it where the id is new. Idempotent on the id. */
adminUsersRouter.post('/admin/referral-cards', validate('body', referralCardBody), async (req, res) => {
  const result = await saveReferralCard(req.ctx.adminActor!, req.body);
  res.status(result.created ? 201 : 200).json(result);
});

/** A patch, for the one field somebody came to change — usually `active`. */
adminUsersRouter.put('/admin/referral-cards/:cardId', validate('body', referralCardPatch), async (req, res) => {
  res.json(await patchReferralCard(req.ctx.adminActor!, String(req.params.cardId), req.body));
});

/**
 * A real delete: nothing holds a snapshot of a card. Hiding it
 * (`active: false`) is the other option, and the right one for a campaign
 * that is being drafted or has been pulled.
 */
adminUsersRouter.delete(
  '/admin/referral-cards/:cardId',
  validate('body', z.object({ note: z.string().trim().max(300).optional() })),
  async (req, res) => {
    res.json(await deleteReferralCard(req.ctx.adminActor!, String(req.params.cardId), req.body.note));
  },
);

// ─── The whole config, key by key ──────────────────────────────────────────

/**
 * Every section of `CONFIG_DEFAULTS`: what is in force, what the code
 * ships, and where the two have parted. The step pipeline's own knobs have
 * their own curated page (`/admin/config/steps`) and are marked as such
 * here rather than hidden.
 */
adminUsersRouter.get('/admin/config', async (_req, res) => {
  res.json(await appConfig());
});

/**
 * Writes any config key by its dotted path, or puts one back.
 *
 * A path that does not exist is a 422 rather than a stray key, a value of
 * the wrong kind is refused against the shape of the defaults, and the
 * merged config goes through the same cross-field validator every read runs
 * before anything is written.
 */
adminUsersRouter.put('/admin/config', validate('body', setAppConfigBody), async (req, res) => {
  res.json(await setAppConfig(req.ctx.adminActor!, req.body));
});

adminUsersRouter.put('/admin/app/update-policy', validate('body', updatePolicyBody), async (req, res) => {
  res.json(await setUpdatePolicy(req.ctx.adminActor!, req.body));
});
