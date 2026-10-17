import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { withTransaction } from '../../db/mongo.js';
import { toCoins, toMilli } from '../../lib/coins.js';
import { localDayOf } from '../../lib/dates.js';
import { Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { AchievementDefinitionModel, UserAchievementModel } from '../challenges/models.js';
import { unlockAchievement } from '../challenges/service.js';
import { CoinBalanceModel, CoinLedgerModel } from '../economy/models.js';
import { credit } from '../economy/service.js';
import { UserModel } from '../identity/models.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * The two things an operator may change about an account, kept in their own
 * file so nothing on a reading screen can write by accident.
 *
 * Both are decisions rather than data: whether this account may go on
 * spending, and a correction to what it was paid. Both carry a reason, both
 * write an audit row, and neither touches what the member did — a frozen
 * account keeps its days, its badges and its history.
 */

const iso = (at: Date | null | undefined): string | null => at?.toISOString() ?? null;

// ─── Whether the account may go on ─────────────────────────────────────────

export const statusBody = z
  .object({
    /**
     * Frozen: the account stays readable and stops being able to spend
     * (RULES T4). It is not a deletion and not a ban — it is the pause while
     * something is being worked out.
     */
    frozen: z.boolean().optional(),
    /**
     * A legal hold keeps the account out of the deletion job's way: a member
     * who asked to be deleted while a dispute is open is not purged until
     * the hold comes off (RULES P5).
     */
    legalHold: z.boolean().optional(),
    /** Required. An account state nobody can explain is worse than the state. */
    reason: z.string().trim().min(3).max(300),
  })
  .strict()
  .refine(body => body.frozen !== undefined || body.legalHold !== undefined, 'Change something');
export type StatusBody = z.infer<typeof statusBody>;

export async function setMemberStatus(actor: string, userId: string, body: StatusBody) {
  const user = await UserModel.findById(userId).select({ flags: 1, deletion: 1, deletedAt: 1 }).lean();
  if (!user) throw Errors.notFound('That member');
  if (user.deletedAt) {
    // Nothing to freeze: the row has already been anonymised, and pretending
    // otherwise would leave an operator thinking they had acted.
    throw Errors.conflict('ALREADY_DELETED', 'That account has already been deleted and anonymised.');
  }

  const set: Record<string, unknown> = {};
  if (body.frozen !== undefined) set['flags.frozen'] = body.frozen;
  if (body.legalHold !== undefined) set['flags.legalHold'] = body.legalHold;
  await UserModel.updateOne({ _id: userId }, { $set: set });

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'member.status',
    subjectType: 'user',
    subjectId: userId,
    before: { frozen: user.flags?.frozen ?? false, legalHold: user.flags?.legalHold ?? false },
    after: { ...body },
  });

  const after = await UserModel.findById(userId).select({ flags: 1, deletion: 1 }).lean();
  return {
    frozen: after?.flags?.frozen ?? false,
    legalHold: after?.flags?.legalHold ?? false,
    deletion: {
      scheduledAt: iso(after?.deletion?.scheduledAt),
      purgeAt: iso(after?.deletion?.purgeAt),
      reason: after?.deletion?.reason ?? null,
    },
  };
}

// ─── A correction to what they were paid (RULES E2) ────────────────────────

export const adjustBody = z
  .object({
    /** Positive credits, negative claws back. Coins, not milli-coins. */
    amount: z.number().refine(value => value !== 0, 'Nothing to adjust').refine(
      value => Math.abs(value) <= 10_000,
      'More than 10,000 coins in one adjustment needs a decision above this panel',
    ),
    /** What the member will see in their wallet. */
    title: z.string().trim().min(3).max(80),
    /** Why, for the audit log and for whoever reads it next. */
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export type AdjustBody = z.infer<typeof adjustBody>;

/**
 * Credits or claws back coins, as a **new row**.
 *
 * The ledger is append-only (RULES E2): nothing already in it is edited, and
 * a correction is a compensating row — which is why a clawback here reads in
 * the member's own wallet as a line they can see rather than as coins that
 * quietly vanished. This is the tool the fraud queue points at: confirming a
 * flag voids what a day was *holding*, and coins already released are a
 * ledger entry that only a row like this can answer.
 *
 * A credit goes through `credit()` with the daily ceiling waived, so it
 * cannot be refused by a cap the operator cannot see. A clawback is written
 * here, in a transaction, and is refused rather than clamped when the
 * balance will not cover it: a balance that cannot go below zero would
 * otherwise turn "take 500 back" into "take whatever is left", silently.
 */
export async function adjustMemberCoins(actor: string, userId: string, body: AdjustBody) {
  const user = await UserModel.findById(userId).select({ timezone: 1, deletedAt: 1 }).lean();
  if (!user) throw Errors.notFound('That member');
  if (user.deletedAt) throw Errors.conflict('ALREADY_DELETED', 'That account has been deleted and anonymised.');

  const config = await getConfig();
  const localDay = localDayOf(new Date(), user.timezone || config.locale.timezone);
  const reference = newId('adj');

  if (body.amount > 0) {
    const result = await credit({
      userId,
      source: 'refund',
      referenceType: 'admin_adjustment',
      referenceId: reference,
      amount: body.amount,
      title: body.title,
      localDay,
      // An operator's correction is not earnings: the daily ceiling is there
      // to bound what the product pays out, not what support puts right.
      exemptFromCap: true,
      actor,
    });
    await AuditLogModel.create({
      actorType: 'admin', actorId: actor, action: 'member.coins_credited', subjectType: 'user', subjectId: userId,
      before: null,
      after: { amount: body.amount, title: body.title, reason: body.reason, ledgerId: result.ledgerId ?? null, reference },
    });
    const balance = await CoinBalanceModel.findById(userId).lean();
    return {
      direction: 'credit' as const,
      amount: result.granted,
      ledgerId: result.ledgerId ?? null,
      balance: toCoins(balance?.balanceMc ?? 0),
    };
  }

  const amountMc = toMilli(Math.abs(body.amount));
  const result = await withTransaction(async session => {
    const balance = await CoinBalanceModel.findOneAndUpdate(
      { _id: userId, balanceMc: { $gte: amountMc } },
      { $inc: { balanceMc: -amountMc } },
      { session, new: true },
    ).lean();
    if (!balance) {
      const current = await CoinBalanceModel.findById(userId).session(session).lean();
      throw Errors.validation({
        amount: `That would take more than the balance holds — they have ${toCoins(current?.balanceMc ?? 0)} coins.`,
      });
    }
    const ledgerId = newId('led');
    await CoinLedgerModel.create(
      [
        {
          _id: ledgerId,
          userId,
          amountMc: -amountMc,
          source: 'refund',
          title: body.title,
          referenceType: 'admin_adjustment',
          referenceId: reference,
          actor,
        },
      ],
      { session },
    );
    return { ledgerId, balance: toCoins(balance.balanceMc) };
  });

  await AuditLogModel.create({
    actorType: 'admin', actorId: actor, action: 'member.coins_clawed_back', subjectType: 'user', subjectId: userId,
    before: null,
    after: { amount: body.amount, title: body.title, reason: body.reason, ledgerId: result.ledgerId, reference },
  });

  return { direction: 'clawback' as const, amount: Math.abs(body.amount), ledgerId: result.ledgerId, balance: result.balance };
}

// ─── Giving a badge by hand (RULES C7) ─────────────────────────────────────

export const grantBadgeBody = z
  .object({
    achievementId: z.string().trim().min(1).max(80),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export type GrantBadgeBody = z.infer<typeof grantBadgeBody>;

/**
 * Unlocks one badge for one member, through the same path the rules use.
 *
 * Deliberately `unlockAchievement` rather than an insert: that function is
 * the one that pays what the badge is worth when ⚙
 * `coins.achievements.enabled` is on, tells the member, and is idempotent on
 * the (member, badge) id — so granting a badge somebody already holds is a
 * no-op rather than a second notification.
 *
 * `via` records that an operator did it, which is the difference between a
 * badge the rules gave and one support did. A badge is never taken back,
 * here or anywhere: that is the rule, not an omission.
 */
export async function grantBadge(actor: string, userId: string, body: GrantBadgeBody) {
  const [user, definition, held] = await Promise.all([
    UserModel.findById(userId).select({ timezone: 1, deletedAt: 1 }).lean(),
    AchievementDefinitionModel.findById(body.achievementId).lean(),
    UserAchievementModel.findById(`${userId}:${body.achievementId}`).lean(),
  ]);
  if (!user) throw Errors.notFound('That member');
  if (user.deletedAt) throw Errors.conflict('ALREADY_DELETED', 'That account has been deleted and anonymised.');
  if (!definition) throw Errors.notFound('That badge');
  if (held) {
    return {
      achievementId: body.achievementId,
      label: definition.label,
      granted: false,
      already: true,
      unlockedAt: iso(held.achievedAt),
      via: held.via,
      rewardCoins: definition.rewardCoins ?? 0,
    };
  }

  const config = await getConfig();
  const granted = await unlockAchievement(
    userId,
    body.achievementId,
    `admin:${actor}`,
    new Date(),
    user.timezone || config.locale.timezone,
  );

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'member.badge_granted',
    subjectType: 'user',
    subjectId: userId,
    before: null,
    after: {
      achievementId: body.achievementId,
      label: definition.label,
      rewardCoins: definition.rewardCoins ?? 0,
      paid: config.coins.achievements.enabled,
      reason: body.reason,
    },
  });

  return {
    achievementId: body.achievementId,
    label: definition.label,
    granted,
    already: false,
    unlockedAt: new Date().toISOString(),
    via: `admin:${actor}`,
    rewardCoins: definition.rewardCoins ?? 0,
    /** Whether those coins were actually minted, or are waiting on the switch. */
    paid: config.coins.achievements.enabled,
  };
}

// ─── What has been done to this account ────────────────────────────────────

export const auditQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

/**
 * Every operator action on this member, newest first.
 *
 * The panel's own receipt: a verdict, a re-score, a goal set, a message
 * sent, a freeze, an adjustment. Shown on the account it was done to,
 * because that is where the next person asks "who did this".
 */
export async function memberAudit(userId: string, limit: number) {
  const rows = await AuditLogModel.find({ subjectType: 'user', subjectId: userId })
    .sort({ at: -1 })
    .limit(limit)
    .lean();
  return {
    data: rows.map(row => ({
      id: String(row._id),
      action: row.action,
      actorType: row.actorType,
      actorId: row.actorId ?? null,
      before: row.before ?? null,
      after: row.after ?? null,
      at: iso((row as { at?: Date }).at),
    })),
  };
}
