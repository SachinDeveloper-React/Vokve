import { toCoins } from '../../lib/coins.js';
import { Errors } from '../../lib/errors.js';
import { addDays, localDayOf } from '../../lib/dates.js';
import { ActivityDailyModel } from '../activity/models.js';
import { rollupDay } from '../activity/rollup.service.js';
import { CoinHoldModel } from '../economy/models.js';
import { voidHold } from '../economy/service.js';
import { UserModel } from '../identity/models.js';
import { AttestationRecordModel, FraudFlagModel } from '../integrity/models.js';
import { updateTrust } from '../integrity/trust.service.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * The fraud review queue (BACKEND §14.5, RULES A27).
 *
 * The layers have been flagging days since the first snapshot, and nothing
 * read the flags: a detection nobody ever sees is a detection that does not
 * exist. This is the one part of the operator's surface that writes, because
 * a queue without a verdict is a list — and the two verdicts are the two
 * RULES T7 names: confirmed, which voids what the day was holding, and
 * dismissed, which gives back the trust the open flag was costing.
 *
 * Neither verdict rewrites the day. What the evidence showed stays as it
 * was; the flag's `status` is the judgement about it.
 */

const DAY_MS = 86_400_000;
const iso = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;

export interface QueueQuery {
  status: 'open' | 'confirmed' | 'dismissed' | 'any';
  severity: 'hard' | 'soft' | 'any';
  days: number;
  limit: number;
}

/**
 * Accounts with something to answer for, worst first: hard flags before
 * soft ones, then how many, then how recent.
 *
 * By account rather than by flag, because the question an operator is
 * actually asking is "who is doing this", and one afternoon of shaking a
 * phone writes a dozen flags that all mean the same thing.
 */
export async function fraudQueue(query: QueueQuery) {
  const since = new Date(Date.now() - query.days * DAY_MS);
  const match: Record<string, unknown> = { createdAt: { $gte: since } };
  if (query.status !== 'any') match.status = query.status;
  if (query.severity !== 'any') match.severity = query.severity;
  else match.severity = { $in: ['hard', 'soft'] };

  const rows = await FraudFlagModel.aggregate<{
    _id: string; hard: number; soft: number; info: number; open: number;
    kinds: string[]; days: string[]; lastSeenAt: Date; devices: string[];
  }>([
    { $match: match },
    {
      $group: {
        _id: '$userId',
        hard: { $sum: { $cond: [{ $eq: ['$severity', 'hard'] }, 1, 0] } },
        soft: { $sum: { $cond: [{ $eq: ['$severity', 'soft'] }, 1, 0] } },
        info: { $sum: { $cond: [{ $eq: ['$severity', 'info'] }, 1, 0] } },
        open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
        kinds: { $addToSet: '$kind' },
        days: { $addToSet: '$localDay' },
        devices: { $addToSet: '$deviceId' },
        lastSeenAt: { $max: '$lastSeenAt' },
      },
    },
    { $sort: { hard: -1, soft: -1, lastSeenAt: -1 } },
    { $limit: query.limit },
  ]);

  const userIds = rows.map(row => row._id);
  const [users, held, steps] = await Promise.all([
    UserModel.find({ _id: { $in: userIds } })
      .select({ name: 1, email: 1, phone: 1, trust: 1, createdAt: 1, flags: 1 })
      .lean(),
    CoinHoldModel.aggregate<{ _id: string; amountMc: number; holds: number }>([
      { $match: { userId: { $in: userIds }, status: 'held' } },
      { $group: { _id: '$userId', amountMc: { $sum: '$amountMc' }, holds: { $sum: 1 } } },
    ]),
    ActivityDailyModel.aggregate<{ _id: string; steps: number; verifiedSteps: number; days: number }>([
      { $match: { userId: { $in: userIds }, localDay: { $gte: localDayOf(since, 'UTC') } } },
      { $group: { _id: '$userId', steps: { $sum: '$steps' }, verifiedSteps: { $sum: '$verifiedSteps' }, days: { $sum: 1 } } },
    ]),
  ]);
  const byUser = new Map(users.map(user => [user._id, user]));
  const byHeld = new Map(held.map(row => [row._id, row]));
  const bySteps = new Map(steps.map(row => [row._id, row]));

  return {
    days: query.days,
    data: rows.map(row => {
      const user = byUser.get(row._id);
      const activity = bySteps.get(row._id);
      return {
        userId: row._id,
        name: user?.name ?? '',
        email: user?.email ?? null,
        phone: user?.phone ?? null,
        trust: { score: user?.trust?.score ?? null, tier: user?.trust?.tier ?? null },
        frozen: user?.flags?.frozen ?? false,
        flags: { hard: row.hard, soft: row.soft, info: row.info, open: row.open },
        /** What they were flagged for, so the queue reads as a reason rather than a count. */
        kinds: [...row.kinds].sort(),
        days: [...row.days].sort().reverse().slice(0, 10),
        devices: row.devices.filter((id): id is string => Boolean(id)),
        lastFlagAt: iso(row.lastSeenAt),
        /** Coins still in escrow — what a confirmation would void (RULES T7). */
        heldCoins: toCoins(byHeld.get(row._id)?.amountMc ?? 0),
        holds: byHeld.get(row._id)?.holds ?? 0,
        /** What the period shows against what it verified: the gap is the claim. */
        steps: activity?.steps ?? 0,
        verifiedSteps: activity?.verifiedSteps ?? 0,
        activeDays: activity?.days ?? 0,
      };
    }),
    nextCursor: null,
  };
}

/**
 * One account's case file: every flag, the days behind them with the layer
 * scores that produced them, what each phone had proved at the time, and
 * the coins the days are still holding.
 *
 * The evidence, not a verdict: an operator confirming a flag should be
 * looking at the day's own numbers, because the one thing a queue must
 * never do is make it easier to punish than to check.
 */
export async function fraudCase(userId: string, days: number) {
  const user = await UserModel.findById(userId)
    .select({ name: 1, email: 1, phone: 1, trust: 1, flags: 1, createdAt: 1, timezone: 1 })
    .lean();
  if (!user) throw Errors.notFound('That member');

  // Their days, in their own zone (D-18).
  const today = localDayOf(new Date(), user.timezone || 'Asia/Kolkata');
  const since = addDays(today, -days);
  const [flags, activity, holds, attestations] = await Promise.all([
    FraudFlagModel.find({ userId, localDay: { $gte: since } }).sort({ localDay: -1, severity: 1 }).lean(),
    ActivityDailyModel.find({ userId, localDay: { $gte: since } }).sort({ localDay: -1 }).lean(),
    CoinHoldModel.find({ userId, source: 'steps' }).sort({ createdAt: -1 }).limit(60).lean(),
    AttestationRecordModel.find({ userId }).sort({ checkedAt: -1 }).limit(20).lean(),
  ]);

  return {
    user: {
      id: user._id,
      name: user.name ?? '',
      email: user.email,
      phone: user.phone,
      trust: { score: user.trust?.score ?? null, tier: user.trust?.tier ?? null },
      frozen: user.flags?.frozen ?? false,
      signedUpAt: iso(user.createdAt),
    },
    flags: flags.map(flag => ({
      id: flag._id,
      localDay: flag.localDay,
      layer: flag.layer,
      kind: flag.kind,
      severity: flag.severity,
      status: flag.status,
      deviceId: flag.deviceId ?? null,
      details: flag.details ?? null,
      firstSeenAt: iso(flag.createdAt),
      lastSeenAt: iso(flag.lastSeenAt),
    })),
    days: activity.map(day => ({
      localDay: day.localDay,
      steps: day.steps ?? 0,
      verifiedSteps: day.verifiedSteps ?? 0,
      pedometerSteps: day.pedometerSteps ?? 0,
      verified: day.verified ?? false,
      plausibility: day.plausibility ?? null,
      layers: day.layers ?? null,
      flags: day.flags ?? [],
      hardRejects: day.hardRejects ?? [],
      deviceCount: day.deviceCount ?? 0,
      /** Per device: what it counted, what it proved, and what the layers made of it. */
      devices: ((day.breakdown as { devices?: Record<string, unknown>[] } | undefined)?.devices ?? []).map(device => ({
        deviceId: device.deviceId,
        phone: device.phone,
        candidate: device.candidate,
        source: device.source,
        verified: device.verified,
        verifiedSteps: device.verifiedSteps,
        plausibility: device.plausibility,
        layers: device.layers,
        hard: device.hard,
        flags: device.flags,
        proof: device.proof,
        counting: device.counting ?? null,
      })),
    })),
    holds: holds.map(hold => ({
      id: hold._id,
      amount: toCoins(hold.amountMc),
      status: hold.status,
      reason: hold.reason ?? null,
      /** `activity_day` holds carry the day in their reference. */
      localDay: hold.referenceType === 'activity_day' ? String(hold.referenceId).split(':')[0] : null,
      releaseAfter: iso(hold.releaseAfter),
      createdAt: iso(hold.createdAt),
    })),
    attestations: attestations.map(record => ({
      deviceId: record.deviceId,
      provider: record.provider,
      verdict: record.verdict,
      details: record.details ?? null,
      checkedAt: iso(record.checkedAt),
    })),
  };
}

export interface VerdictResult {
  flag: { id: string; kind: string; localDay: string; severity: string; status: string };
  /** Holds voided by a confirmation (RULES T7); empty on a dismissal. */
  voided: { id: string; amount: number }[];
  trust: { score: number; tier: string; previousTier: string } | null;
}

/**
 * Confirms a flag: the day's step coins in escrow are voided (RULES T7) and
 * the trust score is recomputed with the flag no longer in doubt.
 *
 * Only what the day was *holding* is voided. Coins already released are a
 * ledger entry, and a ledger is corrected by a compensating row (RULES E2) —
 * a clawback, which is a decision about money and belongs with the
 * operator's own tools rather than behind a button in a review queue.
 */
export async function confirmFlag(actor: string, flagId: string, note?: string): Promise<VerdictResult> {
  return decide(actor, flagId, 'confirmed', note);
}

/** Dismisses it: the day stands, and the score the open flag was costing comes back. */
export async function dismissFlag(actor: string, flagId: string, note?: string): Promise<VerdictResult> {
  return decide(actor, flagId, 'dismissed', note);
}

async function decide(
  actor: string,
  flagId: string,
  status: 'confirmed' | 'dismissed',
  note?: string,
): Promise<VerdictResult> {
  const flag = await FraudFlagModel.findById(flagId).lean();
  if (!flag) throw Errors.notFound('That flag');

  const before = flag.status;
  await FraudFlagModel.updateOne({ _id: flagId }, { $set: { status, reviewedAt: new Date(), reviewedBy: actor, reviewNote: note ?? null } });

  const voided: VerdictResult['voided'] = [];
  if (status === 'confirmed') {
    const holds = await CoinHoldModel.find({
      userId: flag.userId,
      source: 'steps',
      referenceType: 'activity_day',
      referenceId: new RegExp(`^${flag.localDay}:`),
      status: 'held',
    }).lean();
    for (const hold of holds) {
      if ((await voidHold(hold._id, `fraud flag confirmed: ${flag.kind}`)) === 'voided') {
        voided.push({ id: hold._id, amount: toCoins(hold.amountMc) });
      }
    }
  }

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: `fraud.${status}`,
    subjectType: 'user',
    subjectId: flag.userId,
    before: { status: before },
    after: { status, flagId, kind: flag.kind, localDay: flag.localDay, voided: voided.length, note: note ?? null },
  });

  const trust = await updateTrust(flag.userId, flag.localDay).catch(() => null);
  return {
    flag: { id: flagId, kind: flag.kind, localDay: flag.localDay, severity: flag.severity, status },
    voided,
    trust,
  };
}

/**
 * Scores a day again from the evidence already stored.
 *
 * What a threshold change would have done to a real day, without waiting
 * for that phone to send anything: the snapshots are kept per device-day,
 * so the layers can be run over them as often as the config moves. Nothing
 * is re-read from the phone and nothing is re-credited that was not already
 * owed (RULES A4's high-water mark).
 */
export async function rescoreDay(actor: string, userId: string, localDay: string) {
  const before = await ActivityDailyModel.findById(`${userId}:${localDay}`, { verifiedSteps: 1, verified: 1, plausibility: 1 }).lean();
  const result = await rollupDay(userId, localDay);
  const after = await ActivityDailyModel.findById(`${userId}:${localDay}`, { verifiedSteps: 1, verified: 1, plausibility: 1, hardRejects: 1, flags: 1 }).lean();
  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'fraud.rescore', subjectType: 'user', subjectId: userId,
    before: { localDay, verified: before?.verified ?? null, verifiedSteps: before?.verifiedSteps ?? null, plausibility: before?.plausibility ?? null },
    after: { verified: after?.verified ?? null, verifiedSteps: after?.verifiedSteps ?? null, plausibility: after?.plausibility ?? null },
  });
  return {
    localDay,
    before: { verified: before?.verified ?? null, verifiedSteps: before?.verifiedSteps ?? null, plausibility: before?.plausibility ?? null },
    after: {
      verified: after?.verified ?? null,
      verifiedSteps: after?.verifiedSteps ?? null,
      plausibility: after?.plausibility ?? null,
      hardRejects: after?.hardRejects ?? [],
      flags: after?.flags ?? [],
    },
    day: result.day,
  };
}
