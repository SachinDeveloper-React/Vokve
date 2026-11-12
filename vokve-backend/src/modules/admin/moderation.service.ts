import { z } from 'zod';
import { activityLevelSchema, fitnessGoalSchema, genderSchema, unitSystemSchema } from '../../contracts/index.js';
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
import { UserModel, UserSettingsModel } from '../identity/models.js';
import { notify } from '../notifications/service.js';
import { AuditLogModel } from '../platform/models.js';
import { logReading } from '../vitals/service.js';
import { page, pageFields } from './paging.js';

/**
 * The things an operator may change about an account, kept in their own file
 * so nothing on a reading screen can write by accident.
 *
 * Each is a decision rather than data: whether this account may go on
 * spending, a correction to what it was paid, and whether a contact detail
 * the member cannot prove is taken as proven. All three carry a reason, all
 * three write an audit row, and none touches what the member did — a frozen
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

// ─── A contact detail proven by hand (RULES O5) ────────────────────────────

/** Digits only, so `+91 98765 43210` and `9876543210` are the same number. */
const digitsOf = (value: string) => value.replace(/\D/g, '');

export const verifyContactBody = z
  .object({
    channel: z.enum(['phone', 'email']),
    /**
     * The address or number as the operator reads it on the account, typed
     * back. The panel's own rule for anything irreversible, and this is one:
     * there is no unverify, and verifying the wrong account's number lets it
     * spend. Compared on digits for a phone and lower-cased for an email, so
     * the check is on the value and not on how it was punctuated.
     */
    confirm: z.string().trim().min(3).max(190),
    /** Why this was done by hand. The whole point of the record. */
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export type VerifyContactBody = z.infer<typeof verifyContactBody>;

/**
 * Marks a phone number or an email address as proven, because the member
 * cannot prove it themselves.
 *
 * The case this exists for is the one that has no other answer: SMS does not
 * deliver to the member's number — no provider on this route, a carrier
 * dropping it, a number the gateway will not take — so `POST
 * /auth/verify-otp` can never succeed and the member is stuck behind
 * `requireVerifiedContacts` for good. Support has already confirmed who they
 * are by then; what is missing is not the identity, it is the code.
 *
 * **This unlocks spending.** Both contact details proven is what
 * `requireVerifiedContacts` gates redeeming, payouts and addresses on (RULES
 * O5, D-20), and the pair is also worth five points of trust score. So it
 * asks for the value typed back and for a reason, refuses an account that is
 * already verified rather than re-stamping the date, and writes the audit row
 * the member's own Overview tab shows.
 *
 * There is no way back. A verification undone would be a member who could
 * spend yesterday and cannot today, with nothing they did to explain it —
 * freezing the account is how that is answered instead.
 */
export async function verifyMemberContact(actor: string, userId: string, body: VerifyContactBody) {
  const user = await UserModel.findById(userId)
    .select({ email: 1, phone: 1, emailVerifiedAt: 1, phoneVerifiedAt: 1, deletedAt: 1 })
    .lean();
  if (!user) throw Errors.notFound('That member');
  if (user.deletedAt) {
    throw Errors.conflict('ALREADY_DELETED', 'That account has already been deleted and anonymised.');
  }

  const isPhone = body.channel === 'phone';
  const held = (isPhone ? user.phone : user.email) ?? '';
  const already = isPhone ? user.phoneVerifiedAt : user.emailVerifiedAt;
  if (already) {
    throw Errors.conflict(
      'ALREADY_VERIFIED',
      `Their ${isPhone ? 'number' : 'email address'} was already verified on ${already.toISOString().slice(0, 10)}.`,
    );
  }

  const matches = isPhone
    ? digitsOf(body.confirm) === digitsOf(held) && digitsOf(held).length > 0
    : body.confirm.trim().toLowerCase() === held.trim().toLowerCase();
  if (!matches) {
    throw Errors.validation({
      confirm: `That does not match the ${isPhone ? 'number' : 'address'} on this account.`,
    });
  }

  const now = new Date();
  await UserModel.updateOne(
    { _id: userId },
    { $set: isPhone ? { phoneVerifiedAt: now } : { emailVerifiedAt: now } },
  );

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'member.verify_contact',
    subjectType: 'user',
    subjectId: userId,
    before: { channel: body.channel, verifiedAt: null },
    after: { channel: body.channel, verifiedAt: now.toISOString(), target: held, reason: body.reason },
  });

  // Told, because the member is the one who was stuck: they tried, the code
  // never came, and nothing on their screen would otherwise change. Through
  // the same path every job uses, so their switches and quiet hours still
  // decide how it reaches them.
  const told = await notify({
    userId,
    topic: 'system',
    title: isPhone ? 'Your number is verified' : 'Your email is verified',
    message: isPhone
      ? 'We confirmed your mobile number for you. You can redeem rewards and add an address now.'
      : 'We confirmed your email address for you. You can redeem rewards now.',
  });

  const after = await UserModel.findById(userId)
    .select({ emailVerifiedAt: 1, phoneVerifiedAt: 1 })
    .lean();
  return {
    channel: body.channel,
    emailVerifiedAt: iso(after?.emailVerifiedAt),
    phoneVerifiedAt: iso(after?.phoneVerifiedAt),
    /** Both proven is what unlocks redeeming, so the answer says it outright. */
    canRedeem: Boolean(after?.emailVerifiedAt && after?.phoneVerifiedAt),
    told: { status: told.status, push: told.push },
  };
}

// ─── The profile, corrected for them ───────────────────────────────────────

/**
 * What an operator may correct on an account: the same fields the member's
 * own `PATCH /me` takes, with the same bounds, plus the two contact details.
 *
 * A contact detail is the one change that is more than a correction, so it
 * behaves differently: the new address or number is **not** taken as
 * proven — its verification stamp is cleared, exactly as the member's own
 * change would leave it until the code came back — and "Mark verified" is
 * the separate, typed-back step for when support has proven it some other
 * way. A Google account still signs in by `googleId`, not by the address.
 */
export const profileBody = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    email: z.string().trim().toLowerCase().email('That does not look like an email address').optional(),
    phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'A number looks like +919876543210').optional(),
    avatarUrl: z.string().url().nullable().optional(),
    heightCm: z.number().min(90).max(250).nullable().optional(),
    weightKg: z.number().min(25).max(300).nullable().optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date looks like 1994-03-21').nullable().optional(),
    gender: genderSchema.nullable().optional(),
    goal: fitnessGoalSchema.optional(),
    activityLevel: activityLevelSchema.optional(),
    units: unitSystemSchema.optional(),
    weeklyGoalWorkouts: z.number().int().min(1).max(14).optional(),
    country: z.string().trim().regex(/^[A-Z]{2}$/, 'A country is two letters, like IN').optional(),
    /** Required, as on every other write against an account. */
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export type ProfileBody = z.infer<typeof profileBody>;

const PROFILE_FIELDS = [
  'name', 'email', 'phone', 'avatarUrl', 'heightCm', 'weightKg', 'dateOfBirth', 'gender',
  'goal', 'activityLevel', 'units', 'weeklyGoalWorkouts', 'country',
] as const;

/** The profile as the edit form needs it: every field it can change, as stored. */
export function profileOf(user: Record<string, any>) {
  return {
    name: user.name ?? '',
    email: user.email ?? '',
    phone: user.phone ?? null,
    avatarUrl: user.avatarUrl ?? null,
    heightCm: user.heightCm ?? null,
    weightKg: user.weightKg ?? null,
    dateOfBirth: user.dateOfBirth ?? null,
    gender: user.gender ?? null,
    goal: user.goal ?? 'stay_active',
    activityLevel: user.activityLevel ?? 'moderate',
    units: user.units ?? 'metric',
    weeklyGoalWorkouts: user.weeklyGoalWorkouts ?? 4,
    country: user.country ?? 'IN',
    emailVerifiedAt: iso(user.emailVerifiedAt),
    phoneVerifiedAt: iso(user.phoneVerifiedAt),
  };
}

export async function updateMemberProfile(actor: string, userId: string, body: ProfileBody) {
  const before = await UserModel.findById(userId).lean();
  if (!before) throw Errors.notFound('That member');
  if (before.deletedAt) {
    throw Errors.conflict('ALREADY_DELETED', 'That account has already been deleted and anonymised.');
  }

  // Only what actually differs: a form posts every box, and an audit row
  // listing ten "changes" that changed nothing hides the one that did.
  const set: Record<string, unknown> = {};
  for (const key of PROFILE_FIELDS) {
    const next = body[key];
    if (next === undefined) continue;
    const held = (before as Record<string, unknown>)[key] ?? null;
    if (next !== held) set[key] = next;
  }
  if (Object.keys(set).length === 0) throw Errors.validation({ name: 'Nothing to change — every box says what is already there.' });

  if (set.email !== undefined) {
    const taken = await UserModel.exists({ _id: { $ne: userId }, email: set.email })
      .collation({ locale: 'en', strength: 2 });
    if (taken) throw Errors.validation({ email: 'Another account already signs in with that address.' });
    set.emailVerifiedAt = null;
  }
  if (set.phone !== undefined) {
    if (await UserModel.exists({ _id: { $ne: userId }, phone: set.phone })) {
      throw Errors.validation({ phone: 'Another account already has that number.' });
    }
    set.phoneVerifiedAt = null;
  }

  await UserModel.updateOne({ _id: userId }, { $set: set });
  // Units live in two places for the member (profile and settings), and the
  // app reads settings: kept in step the way the member's own save does.
  if (set.units !== undefined) {
    await UserSettingsModel.updateOne({ _id: userId }, { $set: { units: set.units } }, { upsert: true });
  }
  // A weight is a reading too (RULES V4), the same as when the member saves it.
  if (typeof set.weightKg === 'number') {
    await logReading(userId, { id: `admin-profile-${Date.now()}`, kind: 'weight', value: set.weightKg });
  }

  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action: 'member.profile',
    subjectType: 'user',
    subjectId: userId,
    before: Object.fromEntries(Object.keys(set).map(key => [key, (before as Record<string, unknown>)[key] ?? null])),
    after: { ...set, reason: body.reason },
  });

  const after = await UserModel.findById(userId).lean();
  return { changed: Object.keys(set).filter(key => !key.endsWith('VerifiedAt')), profile: profileOf(after!) };
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

export const auditQuery = z.object(pageFields(50, 200));
export type AuditQuery = z.infer<typeof auditQuery>;

/**
 * Every operator action on this member, newest first.
 *
 * The panel's own receipt: a verdict, a re-score, a goal set, a message
 * sent, a freeze, an adjustment. Shown on the account it was done to,
 * because that is where the next person asks "who did this".
 */
export async function memberAudit(userId: string, query: AuditQuery) {
  const filter = { subjectType: 'user', subjectId: userId };
  const [rows, total] = await Promise.all([
    AuditLogModel.find(filter).sort({ at: -1 }).skip(query.offset).limit(query.limit).lean(),
    AuditLogModel.countDocuments(filter),
  ]);
  return page(
    rows.map(row => ({
      id: String(row._id),
      action: row.action,
      actorType: row.actorType,
      actorId: row.actorId ?? null,
      before: row.before ?? null,
      after: row.after ?? null,
      at: iso((row as { at?: Date }).at),
    })),
    total,
    query,
  );
}
