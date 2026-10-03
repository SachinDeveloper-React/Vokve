import { getConfig } from '../../config/remote.js';
import { addDays } from '../../lib/dates.js';
import { ActivityDailyModel } from '../activity/models.js';
import { AddressModel } from '../commerce/models.js';
import { UserModel } from '../identity/models.js';
import { AuditLogModel } from '../platform/models.js';
import { FraudFlagModel } from './models.js';

/**
 * The trust score and tier (RULES §T), recomputed after every scored day.
 * In shadow mode (T9) both are stored and nothing reads them to decide
 * anything — the hold window and the caps stay those of `normal` — so two
 * weeks of real data can show what the thresholds would have done.
 */

const TIER_RANK: Record<string, number> = { restricted: 0, watch: 1, normal: 2, trusted: 3 };
const DAY_MS = 86_400_000;

export interface TrustUpdate {
  score: number;
  tier: string;
  previousTier: string;
}

export async function updateTrust(userId: string, today: string, now = new Date()): Promise<TrustUpdate | null> {
  const config = await getConfig();
  const user = await UserModel.findById(userId).lean();
  if (!user || user.deletedAt) return null;
  const previousTier = user.trust?.tier ?? 'normal';
  // Banned is an admin's decision (T8); no score undoes it.
  if (previousTier === 'banned') return { score: user.trust?.score ?? 0, tier: 'banned', previousTier };

  const since = addDays(today, -30);
  const [days, openFlags, recentFlags, clean90, hasAddress] = await Promise.all([
    ActivityDailyModel.find({ userId, localDay: { $gte: since }, plausibility: { $ne: null } }, { localDay: 1, plausibility: 1, source: 1 })
      .sort({ localDay: 1 }).lean(),
    FraudFlagModel.countDocuments({ userId, status: 'open', severity: { $in: ['hard', 'soft'] }, localDay: { $gte: since } }),
    FraudFlagModel.countDocuments({
      userId, severity: { $in: ['hard', 'soft'] }, createdAt: { $gte: new Date(now.getTime() - config.trust.upgradeCleanDays * DAY_MS) },
    }),
    FraudFlagModel.countDocuments({ userId, severity: { $in: ['hard', 'soft'] }, localDay: { $gte: addDays(today, -90) } }),
    AddressModel.exists({ userId, deletedAt: null }),
  ]);

  let score = config.trust.newAccountScore;
  for (const day of days) {
    score = config.trust.ewmaAlpha * (day.plausibility ?? score) + (1 - config.trust.ewmaAlpha) * score;
  }
  score -= Math.min(config.trust.maxFlagPenalty, openFlags * config.trust.flagPenalty);
  if (days.some(day => day.source === 'health_connect')) score += 5;
  if (user.emailVerifiedAt && user.phoneVerifiedAt) score += 5;
  if (hasAddress) score += 3;
  const createdAt = (user as { createdAt?: Date }).createdAt;
  if (createdAt && now.getTime() - new Date(createdAt).getTime() >= 90 * DAY_MS && clean90 === 0) score += 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const tiers = config.trust.tiers;
  let tier = score >= tiers.trusted ? 'trusted' : score >= tiers.normal ? 'normal' : score >= tiers.watch ? 'watch' : 'restricted';
  // Down at once; up only after a clean stretch (T6).
  if ((TIER_RANK[tier] ?? 2) > (TIER_RANK[previousTier] ?? 2) && recentFlags > 0) tier = previousTier;

  await UserModel.updateOne({ _id: userId }, { $set: { 'trust.score': score, 'trust.tier': tier, 'trust.updatedAt': now } });
  if (tier !== previousTier) {
    await AuditLogModel.create({
      actorType: 'system', actorId: 'trust', action: 'trust.tier_changed', subjectType: 'user', subjectId: userId,
      before: { tier: previousTier, score: user.trust?.score ?? null }, after: { tier, score, shadow: config.trust.shadow },
    });
  }
  return { score, tier, previousTier };
}
