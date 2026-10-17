import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { toCoins } from '../../lib/coins.js';
import { addDays, localDayOf } from '../../lib/dates.js';
import { Errors } from '../../lib/errors.js';
import { ActivityDailyModel } from '../activity/models.js';
import { AchievementDefinitionModel, ChallengeCompletionModel, ChallengeDefinitionModel, UserAchievementModel } from '../challenges/models.js';
import { OrderModel } from '../commerce/models.js';
import { CoinBalanceModel, CoinDailyCapModel, CoinHoldModel, CoinLedgerModel } from '../economy/models.js';
import { UserModel, UserSettingsModel } from '../identity/models.js';
import { streakFigures } from '../streak/service.js';

/**
 * The rest of one member, for the operator's profile (RULES P15).
 *
 * Four reads that were only ever answerable to the member themselves: what
 * they have walked day by day, every coin in and out, the badges they hold,
 * and what they have bought. Support is asked about all four — "my steps
 * are missing", "where did my coins go", "I did not get my badge", "where
 * is my order" — and until now the answer involved a database client.
 *
 * Read-only, every one of them. The two things an operator may *change*
 * about an account live in `moderation.service.ts`, deliberately apart, so
 * nothing on a reading screen can write by accident.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

// ─── What they have walked (RULES A3, A20) ─────────────────────────────────

export const stepsQuery = z.object({
  /** Local days, inclusive. Defaults to the last 30 in the member's own zone. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(400).default(30),
});
export type StepsQuery = z.infer<typeof stepsQuery>;

/**
 * Their days, newest first, with what each one earned and what judged it.
 *
 * Bucketed by the member's own local day, because that is what the rows are
 * keyed by (D-18): a day here is the day they lived, not a window of ours.
 * `goal` comes from their settings, so "did they hit it" is answered against
 * the number they actually set rather than the default.
 */
export async function memberSteps(userId: string, query: StepsQuery) {
  const user = await UserModel.findById(userId).select({ timezone: 1 }).lean();
  if (!user) throw Errors.notFound('That member');
  const config = await getConfig();
  const timezone = user.timezone || config.locale.timezone;

  const today = localDayOf(new Date(), timezone);
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -(query.days - 1));

  const [settings, days, streak] = await Promise.all([
    UserSettingsModel.findById(userId, { dailyStepGoal: 1 }).lean(),
    ActivityDailyModel.find({ userId, localDay: { $gte: from, $lte: to } }).sort({ localDay: -1 }).lean(),
    // The streak is counted from `streak_days`, not stored as a number, so
    // this is the same arithmetic the member's own screen shows.
    streakFigures(userId, timezone).catch(() => null),
  ]);
  const goal = settings?.dailyStepGoal ?? 10_000;

  const rows = days.map(day => ({
    localDay: day.localDay,
    steps: day.steps ?? 0,
    verifiedSteps: day.verifiedSteps ?? 0,
    pedometerSteps: day.pedometerSteps ?? null,
    distanceKm: Math.round((day.distanceKm ?? 0) * 100) / 100,
    activeMinutes: day.activeMinutes ?? 0,
    /** Walking calories and workout calories are two figures; the day is both. */
    calories: Math.round((day.stepCalories ?? 0) + (day.caloriesBurned ?? 0)),
    workouts: day.workoutsCompleted ?? 0,
    source: day.source ?? null,
    verified: day.verified ?? false,
    plausibility: day.plausibility ?? null,
    layers: day.layers ?? null,
    flags: day.flags ?? [],
    hardRejects: day.hardRejects ?? [],
    deviceCount: day.deviceCount ?? 0,
    /** Steps already paid or held for this day — the high-water mark (RULES A4). */
    stepsCredited: day.stepsCredited ?? 0,
    goalHit: (day.steps ?? 0) >= goal,
    scoredAt: iso(day.scoredAt),
    /** Which phone counted what, as the decision was made. Null on unscored days. */
    devices: ((day.breakdown as { devices?: Record<string, unknown>[] } | undefined)?.devices ?? []).map(device => ({
      deviceId: device.deviceId,
      source: device.source,
      candidate: device.candidate,
      verified: device.verified,
      verifiedSteps: device.verifiedSteps,
      plausibility: device.plausibility,
    })),
  }));

  const steps = rows.reduce((sum, row) => sum + row.steps, 0);
  const verifiedSteps = rows.reduce((sum, row) => sum + row.verifiedSteps, 0);
  const round = (n: number) => Math.round(n * 1000) / 1000;

  return {
    window: { from, to, days: rows.length, timezone },
    goal,
    totals: {
      steps,
      verifiedSteps,
      verifiedShare: steps > 0 ? round(verifiedSteps / steps) : 0,
      distanceKm: round(rows.reduce((sum, row) => sum + row.distanceKm, 0)),
      activeMinutes: rows.reduce((sum, row) => sum + row.activeMinutes, 0),
      calories: rows.reduce((sum, row) => sum + row.calories, 0),
      workouts: rows.reduce((sum, row) => sum + row.workouts, 0),
      verifiedDays: rows.filter(row => row.verified).length,
      unverifiedDays: rows.filter(row => !row.verified).length,
      goalDays: rows.filter(row => row.goalHit).length,
      bestDay: rows.reduce<{ localDay: string; steps: number } | null>(
        (best, row) => (best === null || row.steps > best.steps ? { localDay: row.localDay, steps: row.steps } : best),
        null,
      ),
      averageSteps: rows.length > 0 ? Math.round(steps / rows.length) : 0,
    },
    streak,
    /** Oldest first, for a chart. */
    byDay: [...rows].reverse(),
    data: rows,
  };
}

// ─── Every coin in and out (RULES E2) ──────────────────────────────────────

export const ledgerQuery = z.object({
  cursor: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  source: z.enum(['steps', 'workout', 'streak', 'challenge', 'referral', 'purchase', 'refund']).optional(),
  /** `in` is credits, `out` is spends and clawbacks. */
  direction: z.enum(['in', 'out', 'any']).default('any'),
});
export type LedgerQuery = z.infer<typeof ledgerQuery>;

/**
 * The wallet and the ledger behind it.
 *
 * The ledger is append-only: nothing in it was ever edited, and a correction
 * is a second row (RULES E2). That is what makes this read the answer to
 * "where did my coins go" rather than a summary somebody has to trust — the
 * rows are the arithmetic.
 */
export async function memberWallet(userId: string) {
  const user = await UserModel.findById(userId).select({ timezone: 1 }).lean();
  if (!user) throw Errors.notFound('That member');
  const config = await getConfig();
  const timezone = user.timezone || config.locale.timezone;
  const today = localDayOf(new Date(), timezone);

  const [balance, bySource, holds, caps, totals] = await Promise.all([
    CoinBalanceModel.findById(userId).lean(),
    CoinLedgerModel.aggregate<{ _id: string; earnedMc: number; spentMc: number; rows: number; lastAt: Date }>([
      { $match: { userId } },
      {
        $group: {
          _id: '$source',
          earnedMc: { $sum: { $cond: [{ $gt: ['$amountMc', 0] }, '$amountMc', 0] } },
          spentMc: { $sum: { $cond: [{ $lt: ['$amountMc', 0] }, '$amountMc', 0] } },
          rows: { $sum: 1 },
          lastAt: { $max: '$createdAt' },
        },
      },
      { $sort: { earnedMc: -1 } },
    ]),
    CoinHoldModel.find({ userId }).sort({ createdAt: -1 }).limit(50).lean(),
    CoinDailyCapModel.find({ userId, localDay: { $gte: addDays(today, -13) } }).sort({ localDay: -1 }).lean(),
    CoinLedgerModel.aggregate<{ _id: null; earnedMc: number; spentMc: number; rows: number }>([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          earnedMc: { $sum: { $cond: [{ $gt: ['$amountMc', 0] }, '$amountMc', 0] } },
          spentMc: { $sum: { $cond: [{ $lt: ['$amountMc', 0] }, '$amountMc', 0] } },
          rows: { $sum: 1 },
        },
      },
    ]),
  ]);

  const total = totals[0];
  const held = holds.filter(hold => hold.status === 'held');
  const expiryDays = config.coins.expiryDays;
  const lastCreditAt = balance?.lastCreditAt ?? null;

  return {
    balance: {
      coins: toCoins(balance?.balanceMc ?? 0),
      pending: toCoins(balance?.pendingMc ?? 0),
      lifetimeEarned: toCoins(balance?.lifetimeEarnedMc ?? 0),
      lastCreditAt: iso(lastCreditAt),
      /** Idle coins lapse (RULES E9); the clock resets on any credit. */
      expiresAt:
        lastCreditAt && (balance?.balanceMc ?? 0) > 0
          ? new Date(lastCreditAt.getTime() + expiryDays * 86_400_000).toISOString()
          : null,
      expiryWindowDays: expiryDays,
    },
    totals: {
      earned: toCoins(total?.earnedMc ?? 0),
      spent: toCoins(Math.abs(total?.spentMc ?? 0)),
      rows: total?.rows ?? 0,
      held: toCoins(held.reduce((sum, hold) => sum + hold.amountMc, 0)),
      heldCount: held.length,
    },
    bySource: bySource.map(row => ({
      source: row._id,
      earned: toCoins(row.earnedMc),
      spent: toCoins(Math.abs(row.spentMc)),
      rows: row.rows,
      lastAt: iso(row.lastAt),
    })),
    /** Escrow, and what became of it (RULES E15). */
    holds: holds.map(hold => ({
      id: hold._id,
      amount: toCoins(hold.amountMc),
      source: hold.source,
      title: hold.title,
      status: hold.status,
      reason: hold.reason ?? null,
      localDay: hold.referenceType === 'activity_day' ? String(hold.referenceId).split(':')[0] : null,
      releaseAfter: iso(hold.releaseAfter),
      createdAt: iso(hold.createdAt),
    })),
    /** The daily ceiling, day by day: what it let through and what it refused. */
    dailyCaps: caps.map(cap => ({
      localDay: cap.localDay,
      earned: toCoins(cap.totalMc ?? 0),
      capped: toCoins(cap.cappedMc ?? 0),
      workouts: cap.workoutCount ?? 0,
      bySource: Object.fromEntries(
        Object.entries((cap.bySource as unknown as Map<string, number> | Record<string, number>) instanceof Map
          ? Object.fromEntries(cap.bySource as unknown as Map<string, number>)
          : ((cap.bySource ?? {}) as Record<string, number>),
        ).map(([source, milli]) => [source, toCoins(Number(milli))]),
      ),
    })),
    rate: { dailyCap: config.coins.dailyCap, sourceCaps: config.coins.sourceCaps, stepsEnabled: config.coins.steps.enabled },
  };
}

/** The rows themselves, newest first, cursored on the time-ordered id. */
export async function memberLedger(userId: string, query: LedgerQuery) {
  const filter: Record<string, unknown> = { userId };
  if (query.source) filter.source = query.source;
  if (query.direction === 'in') filter.amountMc = { $gt: 0 };
  if (query.direction === 'out') filter.amountMc = { $lt: 0 };
  if (query.cursor) filter._id = { $lt: query.cursor };

  const rows = await CoinLedgerModel.find(filter).sort({ _id: -1 }).limit(query.limit + 1).lean();
  const page = rows.slice(0, query.limit);
  return {
    data: page.map(row => ({
      id: row._id,
      amount: toCoins(row.amountMc),
      source: row.source,
      title: row.title,
      /** What the row is *about*: the day, the order, the challenge period. */
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      /** `system` for a job, `user` for a spend, the operator's name for an adjustment. */
      actor: row.actor ?? 'system',
      holdId: row.holdId ?? null,
      deviceId: row.deviceId ?? null,
      appVersion: row.appVersion ?? null,
      createdAt: iso(row.createdAt),
    })),
    nextCursor: rows.length > query.limit ? page[page.length - 1]._id : null,
  };
}

// ─── Badges, and the challenges that pay them (RULES C4, C7) ───────────────

/**
 * The whole shelf, not only what they hold: a badge they have *not* unlocked
 * is the question support is usually asked about, and a list of the ones they
 * have cannot answer it.
 */
export async function memberAchievements(userId: string) {
  const user = await UserModel.findById(userId).select({ _id: 1 }).lean();
  if (!user) throw Errors.notFound('That member');
  const config = await getConfig();

  const [definitions, unlocked, completions, challenges] = await Promise.all([
    AchievementDefinitionModel.find().sort({ sort: 1, _id: 1 }).lean(),
    UserAchievementModel.find({ userId }).sort({ achievedAt: -1 }).lean(),
    ChallengeCompletionModel.find({ userId }).sort({ completedAt: -1 }).limit(100).lean(),
    ChallengeDefinitionModel.find().lean(),
  ]);

  const unlockedOf = new Map(unlocked.map(row => [row.achievementId, row]));
  const challengeOf = new Map(challenges.map(row => [String(row._id), row]));

  const badges = definitions.map(definition => {
    const held = unlockedOf.get(String(definition._id));
    return {
      id: String(definition._id),
      label: definition.label,
      title: definition.title || definition.label,
      metric: definition.metric,
      value: definition.value,
      rule: definition.rule ?? null,
      threshold: definition.threshold ?? null,
      /** What unlocking it pays, and whether that is switched on yet (D-46). */
      rewardCoins: definition.rewardCoins ?? 0,
      rewardEnabled: config.coins.achievements.enabled,
      unlocked: Boolean(held),
      unlockedAt: iso(held?.achievedAt),
      /** Its own rule, or the challenge that pays it. */
      via: held?.via ?? null,
    };
  });

  return {
    summary: {
      unlocked: badges.filter(badge => badge.unlocked).length,
      total: badges.length,
      rewardsEnabled: config.coins.achievements.enabled,
      /** What they would have been paid if badge coins were on. */
      coinsWaiting: badges
        .filter(badge => badge.unlocked && !config.coins.achievements.enabled)
        .reduce((sum, badge) => sum + badge.rewardCoins, 0),
      challengesCompleted: completions.length,
      challengeCoinsPaid: completions.reduce((sum, row) => sum + (row.granted ?? 0), 0),
    },
    badges,
    /** Every challenge period they finished, and what it actually paid. */
    challenges: completions.map(row => {
      const definition = challengeOf.get(row.challengeId);
      return {
        id: row._id,
        challengeId: row.challengeId,
        title: (definition as { title?: string } | undefined)?.title ?? row.challengeId,
        cadence: row.cadence,
        period: { from: row.periodStart, to: row.periodEnd },
        progress: row.progress,
        goal: row.goal,
        rewardCoins: row.rewardCoins,
        /** Less than the reward under the daily ceiling; zero while step rewards wait. */
        granted: row.granted ?? 0,
        status: row.status,
        ledgerId: row.ledgerId ?? null,
        completedAt: iso(row.completedAt),
      };
    }),
  };
}

// ─── What they have bought (RULES R11) ─────────────────────────────────────

/**
 * How an order was paid for (RULES R11).
 *
 * `inCoins` is set by the till only when every line was coins-only, and in
 * that case the coin figures *are* the price — the paise on the row are the
 * conversion, not a bill anybody was sent. Which is why this is computed
 * once here rather than guessed at by each reader: an order paid entirely in
 * coins should never be shown a rupee figure.
 */
function paidWith(order: { inCoins?: unknown; payable?: number; coinsUsed?: number }): 'coins' | 'money' | 'mixed' {
  if (order.inCoins) return 'coins';
  const money = order.payable ?? 0;
  const coins = order.coinsUsed ?? 0;
  if (coins > 0 && money === 0) return 'coins';
  if (coins === 0) return 'money';
  return 'mixed';
}

export const ordersQuery = z.object({
  cursor: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .enum(['pending_payment', 'placed', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded'])
    .optional(),
});
export type OrdersQuery = z.infer<typeof ordersQuery>;

export async function memberOrders(userId: string, query: OrdersQuery) {
  const filter: Record<string, unknown> = { userId };
  if (query.status) filter.status = query.status;
  if (query.cursor) filter._id = { $lt: query.cursor };

  const [rows, totals] = await Promise.all([
    OrderModel.find(filter).sort({ _id: -1 }).limit(query.limit + 1).lean(),
    OrderModel.aggregate<{ _id: null; orders: number; payable: number; coinsUsed: number; cancelled: number }>([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          payable: { $sum: '$payable' },
          coinsUsed: { $sum: '$coinsUsed' },
          cancelled: { $sum: { $cond: [{ $in: ['$status', ['cancelled', 'refunded']] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const page = rows.slice(0, query.limit);
  const total = totals[0];
  return {
    totals: {
      orders: total?.orders ?? 0,
      /** Paise, as the orders were placed. */
      payable: total?.payable ?? 0,
      /** Whole coins: the order row holds coins, not milli-coins. */
      coinsUsed: total?.coinsUsed ?? 0,
      cancelled: total?.cancelled ?? 0,
    },
    data: page.map(order => ({
      id: order._id,
      /** The reference a member reads out. */
      number: order.number,
      status: order.status,
      /** Coins, money, or both — what the row may show figures for. */
      paidWith: paidWith(order),
      /** Null unless every line was coins-only, in which case these are the price. */
      inCoins: (order.inCoins ?? null) as { goods: number; discount: number; shipping: number; total: number } | null,
      items: order.items.length,
      /** The first line, so a row reads as a thing rather than a count. */
      firstItem: order.items[0]?.title ?? null,
      subtotal: order.subtotal,
      discount: order.discount,
      shipping: order.shipping,
      total: order.total,
      payable: order.payable,
      coinsUsed: order.coinsUsed ?? 0,
      /** Paise — what those coins were worth at the till's rate. */
      coinsValue: order.coinsValue ?? 0,
      payment: {
        method: order.payment?.method ?? null,
        status: order.payment?.status ?? null,
        paidAt: iso(order.payment?.paidAt),
        refundedAt: iso(order.payment?.refundedAt),
      },
      placedAt: iso(order.placedAt),
      trackingRef: order.trackingRef ?? null,
      city: (order.addressSnapshot as { city?: string } | undefined)?.city ?? null,
    })),
    nextCursor: rows.length > query.limit ? page[page.length - 1]._id : null,
  };
}

/** One order in full — every line, the address as it was, and its own history. */
export async function orderDetail(orderId: string) {
  const order = await OrderModel.findById(orderId).lean();
  if (!order) throw Errors.notFound('That order');
  const user = await UserModel.findById(order.userId).select({ name: 1, email: 1, phone: 1 }).lean();

  return {
    id: order._id,
    number: order.number,
    status: order.status,
    /**
     * What this order may be shown in. A coins order has no money side at
     * all, and showing it rupees would be inventing a bill.
     */
    paidWith: paidWith(order),
    member: {
      id: order.userId,
      name: user?.name ?? '',
      email: user?.email ?? null,
      phone: user?.phone ?? null,
    },
    money: {
      currency: order.currency,
      subtotal: order.subtotal,
      discount: order.discount,
      shipping: order.shipping,
      total: order.total,
      payable: order.payable,
      coinsUsed: order.coinsUsed ?? 0,
      coinsValue: order.coinsValue ?? 0,
    },
    coupon: order.coupon ?? null,
    inCoins: order.inCoins ?? null,
    payment: {
      provider: order.payment?.provider ?? null,
      method: order.payment?.method ?? null,
      status: order.payment?.status ?? null,
      amount: order.payment?.amount ?? 0,
      providerOrderId: order.payment?.providerOrderId ?? null,
      providerPaymentId: order.payment?.providerPaymentId ?? null,
      paidAt: iso(order.payment?.paidAt),
      expiresAt: iso(order.payment?.expiresAt),
      refundedAt: iso(order.payment?.refundedAt),
    },
    items: order.items.map(item => ({
      itemId: item.itemId,
      title: item.title,
      emoji: item.emoji ?? null,
      image: item.image ?? null,
      quantity: item.quantity,
      size: item.size ?? null,
      color: item.color ?? null,
      price: item.price,
      mrp: item.mrp ?? null,
      coinPrice: item.coinPrice ?? 0,
      /** How this line was paid for, as the till split it (RULES R11). */
      coinsUsed: item.coinsUsed ?? 0,
      coinsValue: item.coinsValue ?? 0,
      moneyPaid: item.moneyPaid ?? 0,
    })),
    address: order.addressSnapshot ?? null,
    delivery: order.delivery ?? null,
    estimatedDelivery: order.estimatedDelivery ?? null,
    trackingRef: order.trackingRef ?? null,
    notes: order.notes ?? null,
    /** Who moved it and when, oldest first. */
    events: (order.events ?? []).map(event => ({
      from: event.from ?? null,
      to: event.to,
      actor: event.actor,
      at: iso(event.at),
    })),
    ledger: { paidWithCoins: order.ledgerId ?? null, refunded: order.refundLedgerId ?? null },
    placedAt: iso(order.placedAt),
    createdAt: iso((order as { createdAt?: Date }).createdAt),
  };
}
