import { getConfig } from '../../config/remote.js';
import type { NotificationPreferenceKey } from '../../contracts/index.js';
import { toCoins } from '../../lib/coins.js';
import { Errors } from '../../lib/errors.js';
import { OrderModel } from '../commerce/models.js';
import { DeviceModel } from '../devices/models.js';
import { CoinBalanceModel } from '../economy/models.js';
import { NotificationPreferencesModel, RefreshTokenModel, UserModel } from '../identity/models.js';
import { AppErrorModel, DeviceHealthModel, DevicePermissionsModel, EventModel } from '../telemetry/models.js';
import { toPermissionStatus, type StoredPermission } from '../telemetry/service.js';

/**
 * The operator's read of one member (BACKEND §14.14, RULES P15).
 *
 * Read-only, all of it. An operator looking at someone's account should not
 * be able to change it from the same screen, and the things support is
 * tempted to do from here — flip a permission, re-send a push — are not
 * things a server can do on a phone's behalf anyway.
 *
 * Nothing here computes anything new: it is the rows that already exist,
 * assembled in the order the questions get asked — who is this, when did
 * they install it, which build, when did they last sign in, when were they
 * last here, on which phones, and what do those phones allow.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const iso = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;

// ─── Finding the account ───────────────────────────────────────────────────

export interface FindUsersQuery {
  q: string;
  limit: number;
  offset: number;
  tier?: string;
  platform?: 'ios' | 'android';
  /** A state support asks for by name rather than by field. */
  status?: 'any' | 'frozen' | 'deleted' | 'unverified' | 'deleting';
  /** One subject switched off — the drill-down from the consent report. */
  silenced?: NotificationPreferenceKey;
  sort: 'newest' | 'oldest' | 'name' | 'trust';
}

/**
 * By id, email, phone or part of a name — whatever the person on the other
 * end of a support conversation actually gave. Newest accounts first, since
 * "the member who just signed up" is the most common thing being looked for.
 *
 * The filters are the ones a list is actually narrowed by: a trust tier, a
 * platform, and the four states that are asked for by name — frozen, deleted,
 * unverified, and deleting. `total` is the count the filters match, so a page
 * can say what it is a page of.
 */
export async function findUsers(query: FindUsersQuery) {
  const trimmed = query.q.trim();
  const filter: Record<string, unknown> = {};
  if (trimmed) {
    filter.$or = [
      { _id: trimmed },
      { email: new RegExp(escapeRegExp(trimmed), 'i') },
      { phone: new RegExp(escapeRegExp(trimmed), 'i') },
      { name: new RegExp(escapeRegExp(trimmed), 'i') },
    ];
  }
  if (query.tier) filter['trust.tier'] = query.tier;
  switch (query.status) {
    case 'frozen':
      filter['flags.frozen'] = true;
      break;
    case 'deleted':
      filter.deletedAt = { $ne: null };
      break;
    case 'deleting':
      filter['deletion.scheduledAt'] = { $ne: null };
      filter.deletedAt = null;
      break;
    case 'unverified':
      // Either half unproven: the phone is the one that usually is, since
      // there is no SMS provider yet (D-31).
      filter.$and = [{ $or: [{ emailVerifiedAt: null }, { phoneVerifiedAt: null }] }];
      break;
    default:
      break;
  }
  if (query.platform) {
    // A platform belongs to an install, not to an account, so this reads as
    // "accounts with a live install on that platform". It ANDs with the
    // search above rather than replacing it.
    const ids = await DeviceModel.distinct('userId', { platform: query.platform, revokedAt: null });
    filter._id = { $in: ids };
  }
  if (query.silenced) {
    // The accounts that turned one subject off (RULES P14). Only accounts
    // with a preferences row can be in it: a member who never opened the
    // screen is on the default and has refused nothing, which is the same
    // distinction the consent report keeps as `untouched`.
    const silenced = await NotificationPreferencesModel.distinct('_id', {
      [`categories.${query.silenced}`]: false,
    });
    // ANDed with a platform filter rather than replacing it, so the two
    // narrow together instead of the later one winning.
    const existing = (filter._id as { $in?: string[] } | string | undefined) ?? undefined;
    const previous =
      existing && typeof existing === 'object' && Array.isArray(existing.$in) ? existing.$in : null;
    const ids = (silenced as unknown as string[]).map(String);
    filter._id = { $in: previous ? ids.filter(id => previous.includes(id)) : ids };
  }

  const order: Record<string, 1 | -1> =
    query.sort === 'oldest'
      ? { createdAt: 1 }
      : query.sort === 'name'
        ? { name: 1, createdAt: -1 }
        : query.sort === 'trust'
          ? { 'trust.score': 1, createdAt: -1 }
          : { createdAt: -1 };

  const [users, total] = await Promise.all([
    UserModel.find(filter)
      .select({ email: 1, phone: 1, name: 1, trust: 1, createdAt: 1, emailVerifiedAt: 1, phoneVerifiedAt: 1, deletedAt: 1, flags: 1, deletion: 1, country: 1 })
      .sort(order)
      .skip(query.offset)
      .limit(query.limit)
      .lean(),
    UserModel.countDocuments(filter),
  ]);

  const devices = users.length === 0 ? [] : await DeviceModel.aggregate<{
    _id: string; lastSeenAt: Date; devices: number; installedAt: Date; platform: string; appVersion: string;
  }>([
    { $match: { userId: { $in: users.map(u => u._id) }, revokedAt: null } },
    // Sorted first, so `$first` is the phone in use rather than any phone.
    { $sort: { lastSeenAt: -1 } },
    {
      $group: {
        _id: '$userId',
        lastSeenAt: { $max: '$lastSeenAt' },
        installedAt: { $min: '$firstSeenAt' },
        devices: { $sum: 1 },
        platform: { $first: '$platform' },
        appVersion: { $first: '$app.version' },
      },
    },
  ]);
  const byUser = new Map(devices.map(d => [d._id, d]));

  return {
    data: users.map(user => {
      const d = byUser.get(user._id);
      return {
        id: user._id,
        email: user.email,
        phone: user.phone,
        name: user.name ?? '',
        trust: { score: user.trust?.score ?? null, tier: user.trust?.tier ?? null },
        emailVerified: Boolean(user.emailVerifiedAt),
        phoneVerified: Boolean(user.phoneVerifiedAt),
        deleted: Boolean(user.deletedAt),
        frozen: user.flags?.frozen ?? false,
        legalHold: user.flags?.legalHold ?? false,
        deletionScheduledAt: iso(user.deletion?.scheduledAt),
        country: user.country ?? null,
        /** When the account was created — the sign-up, not the install. */
        createdAt: iso(user.createdAt),
        /** When this account first registered a phone: the install (RULES P16). */
        installedAt: iso(d?.installedAt),
        devices: d?.devices ?? 0,
        /** The phone in use, and what it is running. */
        platform: d?.platform ?? null,
        appVersion: d?.appVersion ?? null,
        lastSeenAt: iso(d?.lastSeenAt),
      };
    }),
    total,
    offset: query.offset,
    limit: query.limit,
    nextCursor: null,
  };
}

// ─── One member, in full ───────────────────────────────────────────────────

/**
 * Everything the server knows about a member in one answer: the account,
 * every install with its build and its dates, the live sessions, the wallet
 * and orders in one line each, how much of a trail there is, and what each
 * phone allows.
 *
 * One call rather than six because the questions are never asked
 * separately — "when did they install it, on what, and have they been back"
 * is a single question — and because an operator reading six answers has to
 * line up six clocks by hand.
 */
export async function userOverview(userId: string) {
  const user = await UserModel.findById(userId).lean();
  if (!user) throw Errors.notFound('That member');

  const now = Date.now();
  const since7 = new Date(now - 7 * DAY_MS);
  const since30 = new Date(now - 30 * DAY_MS);

  const [devices, snapshots, tokens, balance, orders, trail, lastView] = await Promise.all([
    DeviceModel.find({ userId }).sort({ lastSeenAt: -1 }).lean(),
    DevicePermissionsModel.find({ userId }).lean(),
    RefreshTokenModel.find({ userId, revokedAt: null, expiresAt: { $gt: new Date(now) } }).lean(),
    CoinBalanceModel.findById(userId).lean(),
    OrderModel.aggregate<{ _id: null; orders: number; payable: number; coinsUsed: number; lastAt: Date }>([
      { $match: { userId } },
      { $group: { _id: null, orders: { $sum: 1 }, payable: { $sum: '$payable' }, coinsUsed: { $sum: '$coinsUsed' }, lastAt: { $max: '$createdAt' } } },
    ]),
    EventModel.aggregate<{ _id: null; events: number; last7: number; last30: number; firstAt: Date; lastAt: Date }>([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          events: { $sum: 1 },
          last7: { $sum: { $cond: [{ $gte: ['$at', since7] }, 1, 0] } },
          last30: { $sum: { $cond: [{ $gte: ['$at', since30] }, 1, 0] } },
          firstAt: { $min: '$at' },
          lastAt: { $max: '$at' },
        },
      },
    ]),
    EventModel.findOne({ userId, name: 'screen_view', screen: { $ne: null } }).sort({ _id: -1 }).lean(),
  ]);

  const permissionsByDevice = new Map(snapshots.map(s => [s.deviceId, s]));
  const liveByDevice = new Map<string, { tokens: number; issuedAt: Date; lastRefreshAt: Date; expiresAt: Date }>();
  for (const token of tokens) {
    const key = token.deviceId ?? 'unbound';
    const created = token.createdAt ?? new Date(now);
    const current = liveByDevice.get(key);
    liveByDevice.set(key, {
      tokens: (current?.tokens ?? 0) + 1,
      issuedAt: current && current.issuedAt < created ? current.issuedAt : created,
      lastRefreshAt: current && current.lastRefreshAt > created ? current.lastRefreshAt : created,
      expiresAt: current && current.expiresAt > token.expiresAt ? current.expiresAt : token.expiresAt,
    });
  }

  const installs = devices.map(device => {
    const periods = device.counting ?? [];
    const open = periods.find(period => period.to === null);
    const closed = periods.filter(period => period.to !== null);
    const live = liveByDevice.get(device._id);
    const snapshot = permissionsByDevice.get(device._id);
    return {
      deviceId: device._id,
      platform: device.platform,
      /** The phone itself (RULES DV4), as `react-native-device-info` read it. */
      device: {
        brand: device.info?.brand ?? null,
        manufacturer: device.info?.manufacturer ?? null,
        model: device.info?.model ?? null,
        name: device.info?.deviceName ?? null,
        osVersion: device.info?.osVersion ?? null,
        isEmulator: device.info?.isEmulator ?? null,
        isTablet: device.info?.isTablet ?? null,
        totalMemoryMb: device.info?.totalMemoryMb ?? null,
        carrier: device.info?.carrier ?? null,
        locale: device.info?.locale ?? null,
        timezone: device.info?.timezone ?? null,
        screen: device.info?.screen?.w ? device.info.screen : null,
        hasBiometrics: device.info?.hasBiometrics ?? null,
      },
      app: {
        version: device.app?.version ?? null,
        build: device.app?.build ?? null,
        /** The build this install was first registered with — what they installed. */
        firstVersion: device.app?.firstVersion ?? null,
        bundleId: device.app?.bundleId ?? null,
      },
      /** When this phone first registered against this account: the install. */
      installedAt: iso(device.firstSeenAt),
      /** The last request from it — written at most once every five minutes (RULES DV1). */
      lastActiveAt: iso(device.lastSeenAt),
      revokedAt: iso(device.revokedAt),
      /** Signed in here now, and since when (D-56 keeps the periods). */
      signedIn: Boolean(open),
      signedInAt: iso(open?.from),
      lastSignedOutAt: iso(closed.length > 0 ? closed[closed.length - 1].to : null),
      logins: periods.length,
      /** A live refresh token is a session the phone can still use. */
      session: live
        ? { live: true, tokens: live.tokens, issuedAt: iso(live.issuedAt), lastRefreshAt: iso(live.lastRefreshAt), expiresAt: iso(live.expiresAt) }
        : { live: false, tokens: 0, issuedAt: null, lastRefreshAt: null, expiresAt: null },
      /** No token, no push — whatever the OS says about notifications. */
      push: {
        hasToken: Boolean(device.push?.token),
        updatedAt: iso(device.push?.updatedAt),
        invalidAt: iso(device.push?.invalidAt),
      },
      remindersScheduledAt: iso(device.remindersScheduledAt),
      integrity: {
        provider: device.integrity?.provider ?? null,
        verdict: device.integrity?.verdict ?? null,
        checkedAt: iso(device.integrity?.checkedAt),
        attested: device.attestation?.attested ?? null,
        securityLevel: device.attestation?.securityLevel ?? null,
      },
      signals: {
        rooted: device.signals?.rooted ?? null,
        emulator: device.signals?.emulator ?? null,
        debugBuild: device.signals?.debugBuild ?? null,
        hookingFramework: device.signals?.hookingFramework ?? null,
        mockLocation: device.signals?.mockLocation ?? null,
        developerMode: device.signals?.developerMode ?? null,
      },
      permissions: permissionSummary(snapshot?.permissions as StoredPermission[] | undefined, snapshot?.updatedAt),
    };
  });

  const events = trail[0];
  const orderTotals = orders[0];

  return {
    account: {
      id: user._id,
      name: user.name ?? '',
      email: user.email,
      phone: user.phone,
      emailVerifiedAt: iso(user.emailVerifiedAt),
      phoneVerifiedAt: iso(user.phoneVerifiedAt),
      /** The sign-up. The install is per phone, below. */
      signedUpAt: iso(user.createdAt),
      profileCompletedAt: iso(user.profileCompletedAt),
      gender: user.gender ?? null,
      dateOfBirth: user.dateOfBirth ?? null,
      country: user.country ?? null,
      timezone: user.timezone ?? null,
      trust: { score: user.trust?.score ?? null, tier: user.trust?.tier ?? null },
      flags: { frozen: user.flags?.frozen ?? false, legalHold: user.flags?.legalHold ?? false },
      deletion: { scheduledAt: iso(user.deletion?.scheduledAt), purgeAt: iso(user.deletion?.purgeAt), reason: user.deletion?.reason ?? null },
      lastExportAt: iso(user.lastExportAt),
      deletedAt: iso(user.deletedAt),
    },
    /** When they were last here, and how much of a trail there is to read. */
    activity: {
      /** The newest request from any of their phones (RULES DV1's heartbeat). */
      lastActiveAt: iso(devices[0]?.lastSeenAt),
      lastScreen: lastView?.screen ?? null,
      lastScreenAt: iso(lastView?.at),
      firstEventAt: iso(events?.firstAt),
      lastEventAt: iso(events?.lastAt),
      events: events?.events ?? 0,
      events7d: events?.last7 ?? 0,
      events30d: events?.last30 ?? 0,
    },
    wallet: {
      balance: toCoins(balance?.balanceMc ?? 0),
      pending: toCoins(balance?.pendingMc ?? 0),
      lifetimeEarned: toCoins(balance?.lifetimeEarnedMc ?? 0),
      lastCreditAt: iso(balance?.lastCreditAt),
      /** What the expiry window actually runs from (RULES E9). */
      lastStepSyncAt: iso(balance?.lastStepSyncAt),
    },
    orders: {
      count: orderTotals?.orders ?? 0,
      /** Paise, as the orders were placed (RULES R11). */
      payable: orderTotals?.payable ?? 0,
      /**
       * Coins, not milli-coins: `checkout` writes `q.coinsApplied` — whole
       * coins — and the member's own order screen reads the same field. A
       * `toCoins()` here (as this once had) turned a 300-coin order into 0.3.
       */
      coinsUsed: orderTotals?.coinsUsed ?? 0,
      lastAt: iso(orderTotals?.lastAt),
    },
    counts: {
      devices: devices.length,
      activeDevices: devices.filter(device => !device.revokedAt).length,
      logins: devices.reduce((total, device) => total + (device.counting?.length ?? 0), 0),
      liveSessions: liveByDevice.size,
    },
    installs,
  };
}

/** What a phone allows, in one line each way, plus the refusals spelled out. */
function permissionSummary(permissions: StoredPermission[] | undefined, reportedAt: Date | undefined) {
  const rows = permissions ?? [];
  const by = (state: string) => rows.filter(row => row.state === state).map(row => row.key);
  return {
    reportedAt: iso(reportedAt),
    granted: by('granted'),
    denied: by('denied'),
    blocked: by('blocked'),
    unavailable: by('unavailable'),
    unknown: by('unknown'),
  };
}

// ─── Sign-ins ──────────────────────────────────────────────────────────────

/**
 * When this account signed in, on which phone, and on which build — newest
 * first, across every install.
 *
 * Read from the counting periods each install keeps (D-56), which is the
 * same record the step rules are judged against: a period opens at a
 * sign-in here and closes at the sign-out. That makes this list the truth
 * rather than a second log that could disagree with it — and it is why a
 * period still open is "signed in now", not a missing sign-out.
 */
export async function loginHistory(userId: string, limit: number) {
  const devices = await DeviceModel.find({ userId })
    .select({ platform: 1, info: 1, app: 1, counting: 1, firstSeenAt: 1, lastSeenAt: 1 })
    .lean();

  const logins = devices.flatMap(device =>
    (device.counting ?? []).map(period => ({
      at: period.from.toISOString(),
      until: iso(period.to),
      /** Still signed in on this phone. */
      open: period.to === null,
      deviceId: device._id,
      platform: device.platform,
      model: device.info?.model ?? null,
      osVersion: device.info?.osVersion ?? null,
      /** The build that signed in, where the install recorded it. */
      appVersion: period.appVersion ?? device.app?.version ?? null,
    })),
  );

  logins.sort((a, b) => b.at.localeCompare(a.at));
  const page = logins.slice(0, limit);
  return { data: page, total: logins.length, nextCursor: null };
}

// ─── The trail (RULES P13) ─────────────────────────────────────────────────

export interface ActivityQuery {
  cursor?: string;
  limit: number;
  name?: string;
  screen?: string;
  from?: string;
  to?: string;
}

/**
 * One member's trail, newest first: every screen they opened and everything
 * they did, as the app reported it. Cursored on `_id`, which is time-ordered
 * (uuid v7), so a page cannot shift under a reader while rows arrive.
 */
export async function activity(userId: string, query: ActivityQuery) {
  const filter: Record<string, unknown> = { userId };
  if (query.name) filter.name = query.name;
  if (query.screen) filter.screen = query.screen;
  const at: Record<string, Date> = {};
  if (query.from) at.$gte = new Date(query.from);
  if (query.to) at.$lte = new Date(query.to);
  if (Object.keys(at).length > 0) filter.at = at;
  if (query.cursor) filter._id = { $lt: query.cursor };

  const rows = await EventModel.find(filter).sort({ _id: -1 }).limit(query.limit + 1).lean();
  const page = rows.slice(0, query.limit);
  return {
    data: page.map(row => ({
      id: row._id,
      name: row.name,
      screen: row.screen ?? null,
      at: row.at.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      sessionId: row.sessionId ?? null,
      props: row.props ?? null,
      deviceId: row.deviceId,
      platform: row.platform ?? null,
      appVersion: row.appVersion ?? null,
      build: row.build ?? null,
    })),
    nextCursor: rows.length > query.limit ? page[page.length - 1]._id : null,
  };
}

/**
 * The same trail read as a shape rather than a list: which screens this
 * member opens and how often, what they actually do there, how many visits,
 * and the daily count — bucketed in **their** timezone, because a day that
 * starts at our midnight is not a day they lived (D-18).
 */
export async function activitySummary(userId: string, days: number) {
  const user = await UserModel.findById(userId).select({ timezone: 1 }).lean();
  if (!user) throw Errors.notFound('That member');
  const timezone = user.timezone || 'Asia/Kolkata';
  const since = new Date(Date.now() - days * DAY_MS);
  const match = { $match: { userId, at: { $gte: since } } };

  const [totals, screens, actions, byDay] = await Promise.all([
    EventModel.aggregate<{ _id: null; events: number; sessions: string[]; firstAt: Date; lastAt: Date }>([
      match,
      { $group: { _id: null, events: { $sum: 1 }, sessions: { $addToSet: '$sessionId' }, firstAt: { $min: '$at' }, lastAt: { $max: '$at' } } },
    ]),
    EventModel.aggregate<{ _id: string; views: number; lastAt: Date }>([
      { $match: { userId, at: { $gte: since }, name: 'screen_view', screen: { $ne: null } } },
      { $group: { _id: '$screen', views: { $sum: 1 }, lastAt: { $max: '$at' } } },
      { $sort: { views: -1, _id: 1 } },
      { $limit: 50 },
    ]),
    EventModel.aggregate<{ _id: string; count: number; lastAt: Date }>([
      { $match: { userId, at: { $gte: since }, name: { $ne: 'screen_view' } } },
      { $group: { _id: '$name', count: { $sum: 1 }, lastAt: { $max: '$at' } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 50 },
    ]),
    EventModel.aggregate<{ _id: string; events: number; screens: number }>([
      match,
      {
        $group: {
          _id: { $dateToString: { date: '$at', format: '%Y-%m-%d', timezone } },
          events: { $sum: 1 },
          screens: { $sum: { $cond: [{ $eq: ['$name', 'screen_view'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const summary = totals[0];
  return {
    days,
    timezone,
    events: summary?.events ?? 0,
    // A build that sends no session id still counts as one visit's worth of
    // rows, so nulls are not counted as a session of their own.
    sessions: (summary?.sessions ?? []).filter(id => typeof id === 'string' && id.length > 0).length,
    firstAt: iso(summary?.firstAt),
    lastAt: iso(summary?.lastAt),
    screens: screens.map(s => ({ screen: s._id, views: s.views, lastAt: s.lastAt.toISOString() })),
    actions: actions.map(a => ({ name: a._id, count: a.count, lastAt: a.lastAt.toISOString() })),
    byDay: byDay.map(d => ({ date: d._id, events: d.events, screens: d.screens })),
  };
}

// ─── Permissions (RULES P14) ───────────────────────────────────────────────

/**
 * What every install of this account is and is not allowed to do, beside
 * enough of the device to know which phone is being talked about — and
 * whether the server has a push token for it at all, which is the other
 * half of "why did the reminder not arrive".
 */
export async function devicePermissions(userId: string) {
  const [devices, snapshots] = await Promise.all([
    DeviceModel.find({ userId })
      .select({ platform: 1, info: 1, app: 1, push: 1, lastSeenAt: 1, firstSeenAt: 1, revokedAt: 1, remindersScheduledAt: 1 })
      .sort({ lastSeenAt: -1 })
      .lean(),
    DevicePermissionsModel.find({ userId }).lean(),
  ]);
  const byDevice = new Map(snapshots.map(s => [s.deviceId, s]));

  return {
    data: devices.map(device => {
      const snapshot = byDevice.get(device._id);
      return {
        deviceId: device._id,
        platform: device.platform,
        model: device.info?.model ?? null,
        brand: device.info?.brand ?? null,
        osVersion: device.info?.osVersion ?? null,
        appVersion: device.app?.version ?? null,
        firstSeenAt: iso(device.firstSeenAt),
        lastSeenAt: iso(device.lastSeenAt),
        revoked: Boolean(device.revokedAt),
        /** A device with no token cannot be pushed to whatever the OS says. */
        hasPushToken: Boolean(device.push?.token),
        /** Whether this install claims the hydration plan is scheduled locally (RULES Y6). */
        remindersScheduledAt: iso(device.remindersScheduledAt),
        permissions: ((snapshot?.permissions ?? []) as StoredPermission[]).map(toPermissionStatus),
        history: (snapshot?.history ?? []).map(h => ({ key: h.key, from: h.from ?? null, to: h.to, at: h.at.toISOString() })),
        reportedAt: iso(snapshot?.updatedAt),
      };
    }),
    nextCursor: null,
  };
}

/**
 * Why this member is unhappy, as far as the phones have said (RULES P17).
 *
 * Two feeds, read together because the answer is usually in both: what each
 * install says about itself — the tracker's service, Health Connect's
 * grants, the sync — and what has gone wrong in the app. Beside each
 * install it also puts the one thing the server knows and the phone does
 * not: when that install last actually reported steps (`stepSync`, A28).
 *
 * A health report is marked `stale` past ⚙ `telemetry.health.staleHours`,
 * because a week-old verdict shown as current is worse than none: an
 * install that has stopped reporting at all is itself the finding.
 */
export async function deviceHealth(userId: string, errorLimit = 25) {
  const config = await getConfig();
  const [devices, health, errors, errorTotal] = await Promise.all([
    DeviceModel.find({ userId })
      .select({ platform: 1, info: 1, app: 1, lastSeenAt: 1, revokedAt: 1, stepSync: 1, counting: 1 })
      .sort({ lastSeenAt: -1 })
      .lean(),
    DeviceHealthModel.find({ userId }).lean(),
    AppErrorModel.find({ userId }).sort({ lastAt: -1 }).limit(errorLimit).lean(),
    AppErrorModel.countDocuments({ userId }),
  ]);
  const byDevice = new Map(health.map(row => [row.deviceId, row]));
  const staleBefore = Date.now() - config.telemetry.health.staleHours * 3_600_000;

  return {
    devices: devices.map(device => {
      const report = byDevice.get(device._id);
      const open = (device.counting ?? []).some(period => period.to === null);
      return {
        deviceId: device._id,
        platform: device.platform,
        model: device.info?.model ?? null,
        brand: device.info?.brand ?? null,
        // What the phone said at registration. The tracker's own answer is
        // in `health.tracking.manufacturer`, and that is the one the OEM
        // rules are about — they can differ on a rebadged device.
        manufacturer: device.info?.manufacturer ?? null,
        appVersion: device.app?.version ?? null,
        lastSeenAt: iso(device.lastSeenAt),
        revoked: Boolean(device.revokedAt),
        /** Whether the account is signed in on this install right now (D-56). */
        signedIn: open,
        /** The server's own half of the picture (RULES A28). */
        stepSync: {
          uploadedAt: iso(device.stepSync?.uploadedAt),
          nudgedAt: iso(device.stepSync?.nudgedAt),
          remindedAt: iso(device.stepSync?.remindedAt),
        },
        health: report
          ? {
              at: iso(report.at),
              stale: report.at.getTime() < staleBefore,
              tracking: report.tracking ?? null,
              healthConnect: report.healthConnect ?? null,
              sync: report.sync ?? null,
            }
          : null,
      };
    }),
    errors: {
      total: errorTotal,
      data: errors.map(error => ({
        fingerprint: error.fingerprint,
        kind: error.kind,
        name: error.name ?? null,
        message: error.message,
        scope: error.scope ?? null,
        screen: error.screen ?? null,
        fatal: error.fatal,
        count: error.count,
        firstAt: iso(error.firstAt),
        lastAt: iso(error.lastAt),
        appVersion: error.appVersion ?? null,
        build: error.build ?? null,
        osVersion: error.osVersion ?? null,
        deviceId: error.deviceId,
        context: error.context ?? null,
        stack: error.stack ?? null,
      })),
    },
  };
}
