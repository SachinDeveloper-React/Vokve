import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { getConfig } from '../../config/remote.js';
import { localDayOf } from '../../lib/dates.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import {
  referralProgramSchema,
  referralSchema,
  type Referral,
  type ReferralProgram,
} from '../../contracts/index.js';
import { credit } from '../economy/service.js';
import { UserModel } from '../identity/models.js';
import { notify } from '../notifications/service.js';
import { ReferralCodeModel, ReferralModel } from './models.js';

/**
 * The alphabet a code is drawn from (RULES F1): upper-case and digits with
 * the four look-alikes removed, so a code read out over the phone or typed
 * from a screenshot cannot be got wrong by an O for a 0.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 7;

function randomCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

/**
 * What a typed code becomes before it is looked up: upper-case, with the
 * spaces and dashes a user adds for readability dropped. The look-alikes
 * need no forgiving — the alphabet has none of O, 0, I or 1 — so a code
 * with one in it is simply not a code.
 */
export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/**
 * The user's code, made on first need (F1 says at sign-up; making it lazily
 * is the same code, one write later, and survives users created before the
 * programme existed). Collisions are retried — at 32⁷ codes they are rare
 * enough that a second try is the whole strategy.
 */
export async function ensureCode(userId: string): Promise<string> {
  const existing = await ReferralCodeModel.findById(userId).lean();
  if (existing) return existing.code;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      await ReferralCodeModel.create({ _id: userId, code });
      return code;
    } catch (err) {
      const dup = (err as { code?: number }).code === 11000;
      if (!dup) throw err;
      // Either our own row landed from a concurrent call, or the code is taken.
      const mine = await ReferralCodeModel.findById(userId).lean();
      if (mine) return mine.code;
    }
  }
  throw new Error('Could not allocate a referral code');
}

function shareUrlFor(code: string): string {
  return `${env.SHARE_URL_BASE.replace(/\/$/, '')}/${code}`;
}

function shareMessageFor(code: string, inviteeCoins: number): string {
  return `Join me on VOKVE — walk, train and earn coins for real rewards. Use my code ${code} when you sign up and you get ${inviteeCoins} coins after your first workout: ${shareUrlFor(code)}`;
}

type ReferralRow = {
  _id: string; inviterId: string; inviteeId: string; code: string; status: string;
  appliedAt: Date; rewardedAt: Date | null; inviterCoins: number; inviteeCoins: number; inviterCapped: boolean;
};

/** The inviter's view of one referral: who joined and what it paid — or will. */
function toReferral(row: ReferralRow, name: string, timeZone: string, promised: number): Referral {
  return referralSchema.parse({
    id: row._id,
    name,
    joinedAt: localDayOf(row.appliedAt, timeZone),
    status: row.status === 'rewarded' ? 'rewarded' : 'pending',
    rewardCoins: row.status === 'rewarded' ? row.inviterCoins : promised,
  });
}

/** First names for a set of user ids, "A friend" for one that has gone. */
async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const users = await UserModel.find({ _id: { $in: ids } }, { name: 1 }).lean();
  const names = new Map<string, string>();
  for (const u of users) names.set(u._id, (u.name ?? '').split(' ')[0] || 'A friend');
  return names;
}

export async function getProgram(userId: string, timeZone: string): Promise<ReferralProgram> {
  const { coins } = await getConfig();
  const [code, user, mine, applied] = await Promise.all([
    ensureCode(userId),
    UserModel.findById(userId, { createdAt: 1 }).lean(),
    ReferralModel.find({ inviterId: userId, status: { $ne: 'voided' } }).sort({ appliedAt: -1 }).lean(),
    ReferralModel.findOne({ inviteeId: userId, status: { $ne: 'voided' } }).lean(),
  ]);

  const monthKey = localDayOf(new Date(), timeZone).slice(0, 7);
  const rewarded = mine.filter(r => r.status === 'rewarded');
  const rewardedThisMonth = rewarded.filter(r => r.rewardedAt && localDayOf(r.rewardedAt, timeZone).slice(0, 7) === monthKey).length;

  const names = await namesFor([...mine.slice(0, 20).map(r => r.inviteeId), ...(applied ? [applied.inviterId] : [])]);

  const signedUpAt = (user as { createdAt?: Date } | null)?.createdAt ?? new Date();
  const applyBy = new Date(signedUpAt.getTime() + coins.referral.applyWindowDays * 86_400_000);
  const canApply = !applied && applyBy.getTime() > Date.now();

  return referralProgramSchema.parse({
    code,
    shareUrl: shareUrlFor(code),
    shareMessage: shareMessageFor(code, coins.referral.invitee),
    rewards: {
      inviter: coins.referral.inviter,
      invitee: coins.referral.invitee,
      qualifier: "your friend's first workout",
      monthlyInviterCap: coins.referral.monthlyInviterCap,
    },
    stats: {
      successful: rewarded.length,
      pending: mine.length - rewarded.length,
      coinsEarned: rewarded.reduce((sum, r) => sum + r.inviterCoins, 0),
      rewardedThisMonth,
    },
    referrals: mine.slice(0, 20).map(r => toReferral(r as ReferralRow, names.get(r.inviteeId) ?? 'A friend', timeZone, coins.referral.inviter)),
    applied: applied
      ? {
          code: applied.code,
          inviterName: names.get(applied.inviterId) ?? 'A friend',
          status: applied.status === 'rewarded' ? 'rewarded' : 'pending',
          rewardCoins: applied.status === 'rewarded' ? applied.inviteeCoins : coins.referral.invitee,
          appliedAt: applied.appliedAt.toISOString(),
        }
      : null,
    canApply,
    applyBy: canApply ? applyBy.toISOString() : null,
  });
}

export async function listReferrals(userId: string, timeZone: string, cursor: string | undefined, limit = 20) {
  const { coins } = await getConfig();
  const filter: Record<string, unknown> = { inviterId: userId, status: { $ne: 'voided' } };
  if (cursor) filter._id = { $lt: cursor }; // uuid v7 ids sort by time
  const rows = await ReferralModel.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const page = rows.slice(0, limit);
  const names = await namesFor(page.map(r => r.inviteeId));
  return {
    data: page.map(r => toReferral(r as ReferralRow, names.get(r.inviteeId) ?? 'A friend', timeZone, coins.referral.inviter)),
    nextCursor: rows.length > limit ? page[page.length - 1]._id : null,
  };
}

/**
 * Whether a typed code belongs to anyone, for the sign-up form to refuse a
 * bad one before the OTP is sent rather than after the account exists.
 * Returns the normalised code, or null.
 */
export async function findCode(rawCode: string): Promise<string | null> {
  const code = normaliseCode(rawCode);
  const owner = await ReferralCodeModel.exists({ code });
  return owner ? code : null;
}

/**
 * The sign-up path: the code was checked when the form was submitted and
 * rode on the OTP challenge, and the account has just been created. Nothing
 * here may fail the sign-up — a code whose owner vanished in between is
 * logged and let go, because the person in front of us has a verified
 * account and no way to retry this step.
 */
export async function applyCodeAtSignUp(userId: string, code: string, timeZone: string, deviceId?: string): Promise<void> {
  try {
    await applyCode(userId, code, timeZone, deviceId);
  } catch (err) {
    logger.warn({ err, userId, code }, 'referral.apply_at_signup_failed');
  }
}

/**
 * The invitee applies a friend's code (RULES F2): once, within the window
 * after sign-up, never their own. The referral opens `pending`; the coins
 * come when they qualify (F3). Errors are the ones the claim card words.
 */
export async function applyCode(userId: string, rawCode: string, timeZone: string, deviceId?: string): Promise<ReferralProgram> {
  const { coins } = await getConfig();
  const code = normaliseCode(rawCode);

  const existing = await ReferralModel.findOne({ inviteeId: userId }).lean();
  if (existing) throw Errors.conflict('REFERRAL_ALREADY_APPLIED', 'You have already joined on a code.', { code: existing.code });

  const user = await UserModel.findById(userId, { createdAt: 1 }).lean();
  const signedUpAt = (user as { createdAt?: Date } | null)?.createdAt ?? new Date();
  const applyBy = new Date(signedUpAt.getTime() + coins.referral.applyWindowDays * 86_400_000);
  if (applyBy.getTime() <= Date.now()) {
    throw new ApiError(422, 'REFERRAL_WINDOW_CLOSED', `A code can only be applied within ${coins.referral.applyWindowDays} days of joining.`, { applyBy: applyBy.toISOString() });
  }

  const owner = await ReferralCodeModel.findOne({ code }).lean();
  if (!owner) throw new ApiError(404, 'REFERRAL_CODE_INVALID', 'That code does not match anyone. Check it and try again.', { code });
  if (owner._id === userId) throw new ApiError(422, 'REFERRAL_SELF', 'That is your own code — share it with a friend instead.');

  try {
    await ReferralModel.create({
      _id: newId('ref'), inviterId: owner._id, inviteeId: userId, code, status: 'pending',
      attribution: { link: 'code', deviceId },
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw Errors.conflict('REFERRAL_ALREADY_APPLIED', 'You have already joined on a code.');
    throw err;
  }

  const names = await namesFor([userId]);
  await notify({
    userId: owner._id, topic: 'reward', preference: 'referrals',
    title: `${names.get(userId) ?? 'A friend'} joined on your code`,
    message: `You get ${coins.referral.inviter} coins when they finish their first workout.`,
    dedupeKey: `referral-applied:${userId}`,
  });
  return getProgram(userId, timeZone);
}

/**
 * The qualifying event (RULES F3): the invitee's first plausible workout.
 * Called from the workout save; a no-op for everyone who is not a pending
 * invitee, which is nearly every save. Pays both sides through the ledger
 * (the referral source cap applies), the inviter only while under the
 * monthly cap (F4) — the invitee's bonus is theirs regardless.
 */
export async function qualifyReferral(inviteeId: string, localDay: string, timeZone: string, deviceId?: string): Promise<void> {
  const referral = await ReferralModel.findOne({ inviteeId, status: 'pending' });
  if (!referral) return;
  const { coins } = await getConfig();

  // The inviter's calendar month, counted the same way the programme's
  // stats count it (F4). UTC month bounds widened by a day, then filtered
  // per row in the zone, as the wallet's month summary does.
  const monthKey = localDay.slice(0, 7);
  const [y, m] = monthKey.split('-').map(Number);
  const rewardedRows = await ReferralModel.find(
    { inviterId: referral.inviterId, status: 'rewarded', rewardedAt: { $gte: new Date(Date.UTC(y, m - 1, 1) - 86_400_000), $lt: new Date(Date.UTC(y, m, 1) + 86_400_000) } },
    { rewardedAt: 1 },
  ).lean();
  const rewardedThisMonth = rewardedRows.filter(r => r.rewardedAt && localDayOf(r.rewardedAt, timeZone).slice(0, 7) === monthKey).length;
  const inviterCapped = rewardedThisMonth >= coins.referral.monthlyInviterCap;

  const [inviter, invitee] = await Promise.all([
    inviterCapped
      ? Promise.resolve(null)
      : credit({
          userId: referral.inviterId, source: 'referral', referenceType: 'referral', referenceId: referral._id,
          amount: coins.referral.inviter, title: 'Friend joined VOKVE', localDay, actor: 'system', deviceId,
        }),
    credit({
      userId: inviteeId, source: 'referral', referenceType: 'referral', referenceId: referral._id,
      amount: coins.referral.invitee, title: 'Welcome bonus — joined on a code', localDay, actor: 'system', deviceId,
    }),
  ]);

  referral.status = 'rewarded';
  referral.qualifiedAt = new Date();
  referral.rewardedAt = new Date();
  referral.inviterCoins = inviter?.granted ?? 0;
  referral.inviteeCoins = invitee.granted;
  referral.inviterCapped = inviterCapped;
  await referral.save();
  logger.info({ referral: referral._id, inviter: referral.inviterCoins, invitee: referral.inviteeCoins, inviterCapped }, 'referral.rewarded');

  const names = await namesFor([inviteeId]);
  await Promise.all([
    notify({
      userId: referral.inviterId, topic: 'reward', preference: 'referrals',
      title: inviterCapped ? 'A referral qualified' : `${referral.inviterCoins} coins from a referral`,
      message: inviterCapped
        ? `${names.get(inviteeId) ?? 'A friend'} finished their first workout. You have reached this month's referral limit, so this one does not pay.`
        : `${names.get(inviteeId) ?? 'A friend'} finished their first workout and your coins are in.`,
      dedupeKey: `referral-rewarded:${referral._id}:inviter`,
    }),
    notify({
      userId: inviteeId, topic: 'reward', preference: 'referrals',
      title: `${referral.inviteeCoins} coins welcome bonus`,
      message: 'Your first workout unlocked the bonus from the code you joined on.',
      dedupeKey: `referral-rewarded:${referral._id}:invitee`,
    }),
  ]);
}
