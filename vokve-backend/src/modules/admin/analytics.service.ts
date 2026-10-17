import { getConfig } from '../../config/remote.js';
import { toCoins } from '../../lib/coins.js';
import { addDays, localDayOf } from '../../lib/dates.js';
import { ActivityDailyModel } from '../activity/models.js';
import { OrderModel } from '../commerce/models.js';
import { DeviceModel } from '../devices/models.js';
import { CoinBalanceModel, CoinHoldModel, CoinLedgerModel } from '../economy/models.js';
import { UserModel } from '../identity/models.js';
import { FraudFlagModel } from '../integrity/models.js';
import { EventModel } from '../telemetry/models.js';

/**
 * The numbers the operator's own dashboard asks for (RULES P15, P18).
 *
 * Everything else under `/admin` answers a question about one member or one
 * install. This answers the two questions that are about the product: **is
 * it growing** and **is it being used** — and, because this one mints money,
 * **what has it cost**.
 *
 * Three rules it keeps, and they are what make the figures worth reading:
 *
 *   - **Every figure says where it came from.** "Active" from the device
 *     heartbeat is not "active" from the trail: the heartbeat is written by
 *     every authenticated request (RULES DV1), the trail is dropped on
 *     arrival for an account with usage analytics switched off (RULES P7).
 *     They are kept apart and labelled rather than added together.
 *   - **A day is the member's own day** (D-18). Everything bucketed by date
 *     is bucketed in the operator's zone, which is the zone the dashboard is
 *     being read in, and the window is named in the answer.
 *   - **Nothing is computed that a row does not already hold.** These are
 *     aggregations, not a second source of truth: a step figure here and a
 *     step figure on a member's own read are the same documents counted.
 *
 * One call rather than eight because a dashboard that loads eight endpoints
 * shows eight clocks, and the first thing an operator does with two of them
 * is wonder which is right.
 */

const DAY_MS = 86_400_000;
const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

export interface Point {
  date: string;
  [key: string]: string | number;
}

export interface AnalyticsOverview {
  window: {
    days: number;
    /** Local days, inclusive, in `timezone`. */
    from: string;
    to: string;
    timezone: string;
    generatedAt: string;
  };
  members: {
    total: number;
    /** Accounts not anonymised by the deletion job (RULES P5). */
    live: number;
    new: number;
    /** The same length of window immediately before it — the trend, not a guess at one. */
    newPrevious: number;
    emailVerified: number;
    phoneVerified: number;
    profileCompleted: number;
    frozen: number;
    deletionScheduled: number;
    deleted: number;
    byTrustTier: { tier: string; members: number }[];
    byCountry: { country: string; members: number }[];
    signupsByDay: Point[];
  };
  installs: {
    total: number;
    /** Not revoked: an install the account could still be counting on. */
    active: number;
    /** Signed in right now, which is the only state steps are counted in (D-56). */
    signedIn: number;
    new: number;
    /** Installs we hold an FCM token for — the ceiling on anything we can say. */
    pushable: number;
    /** Installs that have ever had a step snapshot accepted (RULES A28). */
    reportingSteps: number;
    byPlatform: { platform: string; installs: number; signedIn: number }[];
    byAppVersion: { appVersion: string; installs: number }[];
  };
  engagement: {
    /** Distinct accounts whose phones made a request — the heartbeat (RULES DV1). */
    dau: number;
    wau: number;
    mau: number;
    /** `dau / mau`, 0–1: how much of the month's audience is here today. */
    stickiness: number;
    /** From the trail, which an account can switch off (RULES P7). */
    events: number;
    sessions: number;
    screenViews: number;
    /** Accounts the trail saw at all in the window, for reading the two above against. */
    trailMembers: number;
    byDay: Point[];
    topScreens: { screen: string; views: number; members: number }[];
    topActions: { name: string; count: number; members: number }[];
  };
  activity: {
    /** Scored member-days in the window (RULES A20). */
    days: number;
    members: number;
    steps: number;
    verifiedSteps: number;
    /** `verifiedSteps / steps`, 0–1. The number the shadow report is judged on. */
    verifiedShare: number;
    verifiedDays: number;
    unverifiedDays: number;
    avgStepsPerMemberDay: number;
    distanceKm: number;
    activeMinutes: number;
    workouts: number;
    byDay: Point[];
  };
  economy: {
    coins: {
      /** Credited in the window, by where it came from (RULES E2's ledger). */
      earned: number;
      /** Spent or clawed back in the window — the negative rows. */
      spent: number;
      bySource: { source: string; coins: number; rows: number }[];
      byDay: Point[];
      /** The standing position, whatever the window: balances, escrow, lifetime. */
      balance: number;
      pending: number;
      held: number;
      lifetimeEarned: number;
    };
    orders: {
      count: number;
      /** Paise, as the orders were placed (RULES R11). */
      revenue: number;
      coinsUsed: number;
      /** Average order value in paise, money only. */
      aov: number;
      byStatus: { status: string; orders: number; revenue: number }[];
      byDay: Point[];
    };
  };
  integrity: {
    /** Flags raised in the window (RULES A27). */
    raised: number;
    open: number;
    confirmed: number;
    dismissed: number;
    hard: number;
    soft: number;
    /** Accounts carrying at least one of them. */
    members: number;
    byKind: { kind: string; flags: number; members: number }[];
  };
}

export async function analyticsOverview(days: number, timeZone?: string): Promise<AnalyticsOverview> {
  const config = await getConfig();
  const timezone = timeZone ?? config.locale.timezone;
  const now = new Date();
  const to = localDayOf(now, timezone);
  const from = addDays(to, -(days - 1));
  // The instants the window covers. The local-day strings above are what the
  // step rollups are keyed by; these are for the collections that store an
  // instant, and the two are deliberately the same window read two ways.
  const since = new Date(now.getTime() - days * DAY_MS);
  const previousSince = new Date(now.getTime() - 2 * days * DAY_MS);
  const dayBucket = { $dateToString: { date: '$at', format: '%Y-%m-%d', timezone } };

  const [members, installs, heartbeat, trail, activity, coins, orders, flags] = await Promise.all([
    memberFigures(since, previousSince, timezone),
    installFigures(since),
    heartbeatFigures(now),
    trailFigures(since, dayBucket),
    activityFigures(from, to),
    coinFigures(since, timezone),
    orderFigures(since, timezone),
    flagFigures(since),
  ]);

  return {
    window: { days, from, to, timezone, generatedAt: now.toISOString() },
    members,
    installs,
    engagement: { ...heartbeat, ...trail },
    activity,
    economy: { coins, orders },
    integrity: flags,
  };
}

// ─── Who has signed up ─────────────────────────────────────────────────────

async function memberFigures(since: Date, previousSince: Date, timezone: string) {
  const [counts, tiers, countries, signups] = await Promise.all([
    UserModel.aggregate<{
      _id: null; total: number; live: number; fresh: number; previous: number;
      emailVerified: number; phoneVerified: number; profileCompleted: number;
      frozen: number; deletionScheduled: number; deleted: number;
    }>([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          live: { $sum: { $cond: [{ $eq: ['$deletedAt', null] }, 1, 0] } },
          fresh: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, 1, 0] } },
          previous: {
            $sum: { $cond: [{ $and: [{ $gte: ['$createdAt', previousSince] }, { $lt: ['$createdAt', since] }] }, 1, 0] },
          },
          emailVerified: { $sum: { $cond: [{ $ne: ['$emailVerifiedAt', null] }, 1, 0] } },
          phoneVerified: { $sum: { $cond: [{ $ne: ['$phoneVerifiedAt', null] }, 1, 0] } },
          profileCompleted: { $sum: { $cond: [{ $ne: ['$profileCompletedAt', null] }, 1, 0] } },
          frozen: { $sum: { $cond: ['$flags.frozen', 1, 0] } },
          deletionScheduled: { $sum: { $cond: [{ $ne: ['$deletion.scheduledAt', null] }, 1, 0] } },
          deleted: { $sum: { $cond: [{ $ne: ['$deletedAt', null] }, 1, 0] } },
        },
      },
    ]),
    UserModel.aggregate<{ _id: string | null; members: number }>([
      { $group: { _id: '$trust.tier', members: { $sum: 1 } } },
      { $sort: { members: -1 } },
    ]),
    UserModel.aggregate<{ _id: string | null; members: number }>([
      { $group: { _id: '$country', members: { $sum: 1 } } },
      { $sort: { members: -1 } },
      { $limit: 10 },
    ]),
    UserModel.aggregate<{ _id: string; members: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone } }, members: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const row = counts[0];
  return {
    total: row?.total ?? 0,
    live: row?.live ?? 0,
    new: row?.fresh ?? 0,
    newPrevious: row?.previous ?? 0,
    emailVerified: row?.emailVerified ?? 0,
    phoneVerified: row?.phoneVerified ?? 0,
    profileCompleted: row?.profileCompleted ?? 0,
    frozen: row?.frozen ?? 0,
    deletionScheduled: row?.deletionScheduled ?? 0,
    deleted: row?.deleted ?? 0,
    byTrustTier: tiers.map(tier => ({ tier: tier._id ?? 'unknown', members: tier.members })),
    byCountry: countries.map(country => ({ country: country._id ?? 'unknown', members: country.members })),
    signupsByDay: signups.map(day => ({ date: day._id, members: day.members })),
  };
}

// ─── What they installed it on ─────────────────────────────────────────────

async function installFigures(since: Date) {
  const signedInPeriod = { $elemMatch: { to: null } };
  const [counts, byPlatform, byVersion] = await Promise.all([
    DeviceModel.aggregate<{
      _id: null; total: number; active: number; fresh: number; pushable: number; reportingSteps: number;
    }>([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$revokedAt', null] }, 1, 0] } },
          fresh: { $sum: { $cond: [{ $gte: ['$firstSeenAt', since] }, 1, 0] } },
          pushable: { $sum: { $cond: [{ $ifNull: ['$push.token', false] }, 1, 0] } },
          reportingSteps: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$stepSync.uploadedAt', null] }, null] }, 1, 0] } },
        },
      },
    ]),
    DeviceModel.aggregate<{ _id: string; installs: number; signedIn: number }>([
      { $match: { revokedAt: null } },
      {
        $group: {
          _id: '$platform',
          installs: { $sum: 1 },
          signedIn: {
            $sum: {
              $cond: [
                { $gt: [{ $size: { $filter: { input: { $ifNull: ['$counting', []] }, cond: { $eq: ['$$this.to', null] } } } }, 0] },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { installs: -1 } },
    ]),
    DeviceModel.aggregate<{ _id: string | null; installs: number }>([
      { $match: { revokedAt: null } },
      { $group: { _id: '$app.version', installs: { $sum: 1 } } },
      { $sort: { installs: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const row = counts[0];
  const signedIn = await DeviceModel.countDocuments({ revokedAt: null, counting: signedInPeriod });
  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    signedIn,
    new: row?.fresh ?? 0,
    pushable: row?.pushable ?? 0,
    reportingSteps: row?.reportingSteps ?? 0,
    byPlatform: byPlatform.map(p => ({ platform: p._id, installs: p.installs, signedIn: p.signedIn })),
    byAppVersion: byVersion.filter(v => v._id).map(v => ({ appVersion: v._id as string, installs: v.installs })),
  };
}

/**
 * Active accounts, from the heartbeat rather than the trail.
 *
 * `devices.lastSeenAt` is stamped by any authenticated request, at most once
 * every five minutes (RULES DV1), for every account — including the ones
 * that have switched usage analytics off. So it answers "how many accounts
 * were here" where the trail can only answer "how many let us watch".
 *
 * It is current state, not a stream: one row per install holding its newest
 * contact. That is why these are three rolling windows and not a series —
 * the daily series under `byDay` comes from the trail, which does keep one.
 */
async function heartbeatFigures(now: Date) {
  const activeSince = (ms: number) =>
    DeviceModel.distinct('userId', { lastSeenAt: { $gte: new Date(now.getTime() - ms) } }).then(ids => ids.length);
  const [dau, wau, mau] = await Promise.all([activeSince(DAY_MS), activeSince(7 * DAY_MS), activeSince(30 * DAY_MS)]);
  return { dau, wau, mau, stickiness: mau > 0 ? Math.round((dau / mau) * 1000) / 1000 : 0 };
}

// ─── What they did in the app ──────────────────────────────────────────────

async function trailFigures(since: Date, dayBucket: unknown) {
  const match = { $match: { at: { $gte: since } } };
  const [totals, byDay, screens, actions] = await Promise.all([
    EventModel.aggregate<{ _id: null; events: number; screenViews: number; members: string[]; sessions: string[] }>([
      match,
      {
        $group: {
          _id: null,
          events: { $sum: 1 },
          screenViews: { $sum: { $cond: [{ $eq: ['$name', 'screen_view'] }, 1, 0] } },
          members: { $addToSet: '$userId' },
          sessions: { $addToSet: '$sessionId' },
        },
      },
    ]),
    EventModel.aggregate<{ _id: string; events: number; members: string[]; sessions: string[] }>([
      match,
      { $group: { _id: dayBucket, events: { $sum: 1 }, members: { $addToSet: '$userId' }, sessions: { $addToSet: '$sessionId' } } },
      { $sort: { _id: 1 } },
    ]),
    EventModel.aggregate<{ _id: string; views: number; members: string[] }>([
      { $match: { at: { $gte: since }, name: 'screen_view', screen: { $ne: null } } },
      { $group: { _id: '$screen', views: { $sum: 1 }, members: { $addToSet: '$userId' } } },
      { $sort: { views: -1, _id: 1 } },
      { $limit: 20 },
    ]),
    EventModel.aggregate<{ _id: string; count: number; members: string[] }>([
      { $match: { at: { $gte: since }, name: { $ne: 'screen_view' } } },
      { $group: { _id: '$name', count: { $sum: 1 }, members: { $addToSet: '$userId' } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 20 },
    ]),
  ]);

  // A build that sends no session id still writes rows; a null is not a visit.
  const realSessions = (ids: (string | null)[]) => ids.filter(id => typeof id === 'string' && id.length > 0).length;
  const row = totals[0];
  return {
    events: row?.events ?? 0,
    sessions: realSessions(row?.sessions ?? []),
    screenViews: row?.screenViews ?? 0,
    trailMembers: row?.members.length ?? 0,
    byDay: byDay.map(day => ({
      date: day._id,
      events: day.events,
      members: day.members.length,
      sessions: realSessions(day.sessions),
    })),
    topScreens: screens.map(screen => ({ screen: screen._id, views: screen.views, members: screen.members.length })),
    topActions: actions.map(action => ({ name: action._id, count: action.count, members: action.members.length })),
  };
}

// ─── What they walked ──────────────────────────────────────────────────────

async function activityFigures(from: string, to: string) {
  const match = { $match: { localDay: { $gte: from, $lte: to } } };
  const [totals, byDay] = await Promise.all([
    ActivityDailyModel.aggregate<{
      _id: null; days: number; members: string[]; steps: number; verifiedSteps: number;
      verifiedDays: number; distanceKm: number; activeMinutes: number; workouts: number;
    }>([
      match,
      {
        $group: {
          _id: null,
          days: { $sum: 1 },
          members: { $addToSet: '$userId' },
          steps: { $sum: '$steps' },
          verifiedSteps: { $sum: '$verifiedSteps' },
          verifiedDays: { $sum: { $cond: ['$verified', 1, 0] } },
          distanceKm: { $sum: '$distanceKm' },
          activeMinutes: { $sum: '$activeMinutes' },
          workouts: { $sum: '$workoutsCompleted' },
        },
      },
    ]),
    ActivityDailyModel.aggregate<{
      _id: string; members: number; steps: number; verifiedSteps: number; verifiedDays: number; days: number;
    }>([
      match,
      {
        $group: {
          _id: '$localDay',
          members: { $addToSet: '$userId' },
          steps: { $sum: '$steps' },
          verifiedSteps: { $sum: '$verifiedSteps' },
          verifiedDays: { $sum: { $cond: ['$verified', 1, 0] } },
          days: { $sum: 1 },
        },
      },
      { $project: { members: { $size: '$members' }, steps: 1, verifiedSteps: 1, verifiedDays: 1, days: 1 } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const row = totals[0];
  const days = row?.days ?? 0;
  const steps = row?.steps ?? 0;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    days,
    members: row?.members.length ?? 0,
    steps,
    verifiedSteps: row?.verifiedSteps ?? 0,
    verifiedShare: steps > 0 ? round((row?.verifiedSteps ?? 0) / steps) : 0,
    verifiedDays: row?.verifiedDays ?? 0,
    unverifiedDays: days - (row?.verifiedDays ?? 0),
    avgStepsPerMemberDay: days > 0 ? Math.round(steps / days) : 0,
    distanceKm: round(row?.distanceKm ?? 0),
    activeMinutes: row?.activeMinutes ?? 0,
    workouts: row?.workouts ?? 0,
    byDay: byDay.map(day => ({
      date: day._id,
      members: day.members,
      steps: day.steps,
      verifiedSteps: day.verifiedSteps,
      verifiedDays: day.verifiedDays,
      unverifiedDays: day.days - day.verifiedDays,
    })),
  };
}

// ─── What it cost ──────────────────────────────────────────────────────────

/**
 * The coins, from the ledger and the balances.
 *
 * The ledger is append-only (RULES E2), so what was credited in a window is
 * the sum of its positive rows and what was spent the sum of its negative
 * ones — nothing has to be inferred from a balance that has moved since.
 * The balances and the escrow are the standing position, which is not a
 * window figure at all and is not presented as one.
 */
async function coinFigures(since: Date, timezone: string) {
  const [bySource, byDay, balances, held] = await Promise.all([
    CoinLedgerModel.aggregate<{ _id: string; milli: number; rows: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$source', milli: { $sum: '$amountMc' }, rows: { $sum: 1 } } },
      { $sort: { milli: -1 } },
    ]),
    CoinLedgerModel.aggregate<{ _id: string; earned: number; spent: number }>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone } },
          earned: { $sum: { $cond: [{ $gt: ['$amountMc', 0] }, '$amountMc', 0] } },
          spent: { $sum: { $cond: [{ $lt: ['$amountMc', 0] }, '$amountMc', 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    CoinBalanceModel.aggregate<{ _id: null; balance: number; pending: number; lifetime: number }>([
      { $group: { _id: null, balance: { $sum: '$balanceMc' }, pending: { $sum: '$pendingMc' }, lifetime: { $sum: '$lifetimeEarnedMc' } } },
    ]),
    CoinHoldModel.aggregate<{ _id: null; milli: number }>([
      { $match: { status: 'held' } },
      { $group: { _id: null, milli: { $sum: '$amountMc' } } },
    ]),
  ]);

  const earned = byDay.reduce((sum, day) => sum + day.earned, 0);
  const spent = byDay.reduce((sum, day) => sum + day.spent, 0);
  const balance = balances[0];
  return {
    earned: toCoins(earned),
    spent: toCoins(Math.abs(spent)),
    bySource: bySource.map(source => ({ source: source._id, coins: toCoins(source.milli), rows: source.rows })),
    byDay: byDay.map(day => ({ date: day._id, earned: toCoins(day.earned), spent: toCoins(Math.abs(day.spent)) })),
    balance: toCoins(balance?.balance ?? 0),
    pending: toCoins(balance?.pending ?? 0),
    held: toCoins(held[0]?.milli ?? 0),
    lifetimeEarned: toCoins(balance?.lifetime ?? 0),
  };
}

async function orderFigures(since: Date, timezone: string) {
  const [totals, byStatus, byDay] = await Promise.all([
    OrderModel.aggregate<{ _id: null; count: number; revenue: number; coinsUsed: number }>([
      { $match: { placedAt: { $gte: since } } },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$payable' }, coinsUsed: { $sum: '$coinsUsed' } } },
    ]),
    OrderModel.aggregate<{ _id: string; orders: number; revenue: number }>([
      { $match: { placedAt: { $gte: since } } },
      { $group: { _id: '$status', orders: { $sum: 1 }, revenue: { $sum: '$payable' } } },
      { $sort: { orders: -1 } },
    ]),
    OrderModel.aggregate<{ _id: string; orders: number; revenue: number; coinsUsed: number }>([
      { $match: { placedAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { date: '$placedAt', format: '%Y-%m-%d', timezone } },
          orders: { $sum: 1 },
          revenue: { $sum: '$payable' },
          coinsUsed: { $sum: '$coinsUsed' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const row = totals[0];
  const count = row?.count ?? 0;
  return {
    count,
    revenue: row?.revenue ?? 0,
    // Whole coins on the order row (see `admin/service.ts`), not milli-coins.
    coinsUsed: row?.coinsUsed ?? 0,
    aov: count > 0 ? Math.round((row?.revenue ?? 0) / count) : 0,
    byStatus: byStatus.map(status => ({ status: status._id, orders: status.orders, revenue: status.revenue })),
    byDay: byDay.map(day => ({ date: day._id, orders: day.orders, revenue: day.revenue, coinsUsed: day.coinsUsed })),
  };
}

// ─── What the layers made of it ────────────────────────────────────────────

async function flagFigures(since: Date) {
  const [totals, byKind] = await Promise.all([
    FraudFlagModel.aggregate<{
      _id: null; raised: number; open: number; confirmed: number; dismissed: number;
      hard: number; soft: number; members: string[];
    }>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          raised: { $sum: 1 },
          open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
          confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } },
          dismissed: { $sum: { $cond: [{ $eq: ['$status', 'dismissed'] }, 1, 0] } },
          hard: { $sum: { $cond: [{ $eq: ['$severity', 'hard'] }, 1, 0] } },
          soft: { $sum: { $cond: [{ $eq: ['$severity', 'soft'] }, 1, 0] } },
          members: { $addToSet: '$userId' },
        },
      },
    ]),
    FraudFlagModel.aggregate<{ _id: string; flags: number; members: string[] }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$kind', flags: { $sum: 1 }, members: { $addToSet: '$userId' } } },
      { $sort: { flags: -1 } },
      { $limit: 20 },
    ]),
  ]);

  const row = totals[0];
  return {
    raised: row?.raised ?? 0,
    open: row?.open ?? 0,
    confirmed: row?.confirmed ?? 0,
    dismissed: row?.dismissed ?? 0,
    hard: row?.hard ?? 0,
    soft: row?.soft ?? 0,
    members: row?.members.length ?? 0,
    byKind: byKind.map(kind => ({ kind: kind._id, flags: kind.flags, members: kind.members.length })),
  };
}

/**
 * The newest accounts, for the dashboard's own "who just signed up" strip.
 *
 * `findUsers('')` already answers this, and this is deliberately not that
 * call: it adds nothing per account, so the dashboard does not pay for a
 * per-user device aggregate to print five names.
 */
export async function recentSignups(limit: number) {
  const users = await UserModel.find({}, { name: 1, email: 1, phone: 1, createdAt: 1, country: 1, trust: 1 })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return {
    data: users.map(user => ({
      id: user._id,
      name: user.name ?? '',
      email: user.email,
      phone: user.phone,
      country: user.country ?? null,
      trust: { score: user.trust?.score ?? null, tier: user.trust?.tier ?? null },
      signedUpAt: iso(user.createdAt),
    })),
  };
}
