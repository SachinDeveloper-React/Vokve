import type { ClientSession } from 'mongoose';
import { getConfig } from '../../config/remote.js';
import { withTransaction } from '../../db/mongo.js';
import { ApiError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { toCoins, toMilli } from '../../lib/coins.js';
import { logger } from '../../lib/logger.js';
import { CoinBalanceModel, CoinDailyCapModel, CoinHoldModel, CoinLedgerModel, type CoinSource } from './models.js';

/**
 * The only door to the ledger (RULES D1, D-03). Four verbs:
 *   credit  — pay coins now (workout, streak, challenge, referral, refund)
 *   hold    — escrow coins (steps), released or voided later
 *   release — move a hold into the ledger
 *   debit   — spend coins (purchase, streak restore)
 * Each is one MongoDB transaction and idempotent by (user, source, referenceType, referenceId).
 */

export interface EarnEvent {
  userId: string;
  source: Exclude<CoinSource, 'purchase'>;
  referenceType: string;
  referenceId: string;
  /** In coins. Converted to milli-coins here. */
  amount: number;
  title: string;
  localDay: string;
  /** Skip the daily ceiling — refunds and leaderboard payouts only (RULES E8d). */
  exemptFromCap?: boolean;
  actor?: string;
  deviceId?: string;
  appVersion?: string;
}

export interface EarnResult {
  granted: number;
  requested: number;
  capped: number;
  status: 'credited' | 'held' | 'already_done' | 'cap_reached';
  ledgerId?: string;
  holdId?: string;
}

// ─── Caps ──────────────────────────────────────────────────────────────────

interface CapDecision { grantMc: number; cappedMc: number }

/**
 * Consumes daily-cap headroom atomically. The conditional filter on
 * `totalMc` (and the per-source counter) is what stops two concurrent
 * credits from both passing (BACKEND §8.2.1). Partial grants are allowed;
 * the remainder is recorded as capped and dropped (RULES E8b).
 */
async function applyCaps(event: EarnEvent, requestedMc: number, session: ClientSession): Promise<CapDecision> {
  if (event.exemptFromCap || requestedMc <= 0) return { grantMc: requestedMc, cappedMc: 0 };

  const config = await getConfig();
  const dailyCapMc = toMilli(config.coins.dailyCap);
  const sourceCapCoins = (config.coins.sourceCaps as Record<string, number | undefined>)[event.source];
  const sourceCapMc = sourceCapCoins === undefined ? dailyCapMc : toMilli(sourceCapCoins);
  const id = `${event.userId}:${event.localDay}`;

  await CoinDailyCapModel.updateOne(
    { _id: id },
    { $setOnInsert: { _id: id, userId: event.userId, localDay: event.localDay, totalMc: 0, cappedMc: 0 } },
    { upsert: true, session },
  );

  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await CoinDailyCapModel.findById(id).session(session).lean();
    const usedTotal = doc?.totalMc ?? 0;
    const usedSource = (doc?.bySource as unknown as Record<string, number> | undefined)?.[event.source] ?? 0;
    const grantMc = Math.max(0, Math.min(requestedMc, dailyCapMc - usedTotal, sourceCapMc - usedSource));
    const cappedMc = requestedMc - grantMc;

    if (grantMc === 0) {
      await CoinDailyCapModel.updateOne({ _id: id }, { $inc: { cappedMc } }, { session });
      return { grantMc: 0, cappedMc };
    }

    const updated = await CoinDailyCapModel.updateOne(
      {
        _id: id,
        totalMc: { $lte: dailyCapMc - grantMc },
        $or: [{ [`bySource.${event.source}`]: { $exists: false } }, { [`bySource.${event.source}`]: { $lte: sourceCapMc - grantMc } }],
      },
      { $inc: { totalMc: grantMc, [`bySource.${event.source}`]: grantMc, cappedMc } },
      { session },
    );
    if (updated.modifiedCount === 1) return { grantMc, cappedMc };
    // Someone else consumed headroom between the read and the write — re-read.
  }
  throw new ApiError(409, 'CAP_CONTENTION', 'Please try again in a moment.');
}

// ─── Verbs ─────────────────────────────────────────────────────────────────

export async function credit(event: EarnEvent): Promise<EarnResult> {
  const requestedMc = toMilli(event.amount);
  if (requestedMc <= 0) return { granted: 0, requested: event.amount, capped: 0, status: 'already_done' };

  return withTransaction(async session => {
    const existing = await CoinLedgerModel.findOne(refFilter(event)).session(session).lean();
    if (existing) return { granted: toCoins(existing.amountMc), requested: event.amount, capped: 0, status: 'already_done', ledgerId: existing._id };

    const { grantMc, cappedMc } = await applyCaps(event, requestedMc, session);
    if (grantMc === 0) {
      logger.info({ userId: event.userId, source: event.source, requestedMc }, 'economy.cap_reached');
      return { granted: 0, requested: event.amount, capped: toCoins(cappedMc), status: 'cap_reached' };
    }

    const ledgerId = newId('led');
    await CoinLedgerModel.create([{
      _id: ledgerId, userId: event.userId, amountMc: grantMc, source: event.source,
      title: cappedMc > 0 ? `${event.title} (daily limit reached)` : event.title,
      referenceType: event.referenceType, referenceId: event.referenceId,
      actor: event.actor ?? 'system', deviceId: event.deviceId, appVersion: event.appVersion,
    }], { session });
    await CoinBalanceModel.updateOne(
      { _id: event.userId },
      { $inc: { balanceMc: grantMc, lifetimeEarnedMc: grantMc }, $set: { lastCreditAt: new Date() } },
      { upsert: true, session },
    );
    return { granted: toCoins(grantMc), requested: event.amount, capped: toCoins(cappedMc), status: 'credited', ledgerId };
  });
}

export async function hold(event: EarnEvent, releaseAfter: Date | null): Promise<EarnResult> {
  const requestedMc = toMilli(event.amount);
  if (requestedMc <= 0) return { granted: 0, requested: event.amount, capped: 0, status: 'already_done' };

  return withTransaction(async session => {
    const existing = await CoinHoldModel.findOne(refFilter(event)).session(session).lean();
    if (existing) return { granted: toCoins(existing.amountMc), requested: event.amount, capped: 0, status: 'already_done', holdId: existing._id };

    // Holds consume the cap on the day earned (RULES E8a).
    const { grantMc, cappedMc } = await applyCaps(event, requestedMc, session);
    if (grantMc === 0) return { granted: 0, requested: event.amount, capped: toCoins(cappedMc), status: 'cap_reached' };

    const holdId = newId('hld');
    await CoinHoldModel.create([{
      _id: holdId, userId: event.userId, amountMc: grantMc, source: event.source, title: event.title,
      referenceType: event.referenceType, referenceId: event.referenceId, releaseAfter, status: 'held',
    }], { session });
    await CoinBalanceModel.updateOne({ _id: event.userId }, { $inc: { pendingMc: grantMc } }, { upsert: true, session });
    return { granted: toCoins(grantMc), requested: event.amount, capped: toCoins(cappedMc), status: 'held', holdId };
  });
}

export async function release(holdId: string): Promise<'released' | 'noop'> {
  return withTransaction(async session => {
    const h = await CoinHoldModel.findOneAndUpdate({ _id: holdId, status: 'held' }, { $set: { status: 'released' } }, { session, new: true });
    if (!h) return 'noop';
    await CoinLedgerModel.create([{
      _id: newId('led'), userId: h.userId, amountMc: h.amountMc, source: h.source, title: h.title,
      referenceType: h.referenceType, referenceId: h.referenceId, holdId: h._id,
    }], { session });
    await CoinBalanceModel.updateOne(
      { _id: h.userId },
      { $inc: { balanceMc: h.amountMc, pendingMc: -h.amountMc, lifetimeEarnedMc: h.amountMc }, $set: { lastCreditAt: new Date() } },
      { session },
    );
    return 'released';
  });
}

export async function voidHold(holdId: string, reason: string): Promise<'voided' | 'noop'> {
  return withTransaction(async session => {
    const h = await CoinHoldModel.findOneAndUpdate({ _id: holdId, status: 'held' }, { $set: { status: 'voided', reason } }, { session, new: true });
    if (!h) return 'noop';
    await CoinBalanceModel.updateOne({ _id: h.userId }, { $inc: { pendingMc: -h.amountMc } }, { session });
    return 'voided';
  });
}

export interface SpendIntent {
  userId: string;
  source: 'purchase' | 'streak';
  referenceType: string;
  referenceId: string;
  amount: number;
  title: string;
  idempotencyKey?: string;
  deviceId?: string;
  appVersion?: string;
}

/** Conditional `$gte` on the balance is the overspend guard (RULES E4, D-03). */
export async function debit(intent: SpendIntent): Promise<{ ledgerId: string; balance: number }> {
  const amountMc = toMilli(intent.amount);
  if (amountMc <= 0) throw new ApiError(422, 'INVALID_AMOUNT', 'Nothing to spend.');

  return withTransaction(async session => {
    const existing = await CoinLedgerModel.findOne(refFilter(intent)).session(session).lean();
    if (existing) {
      const bal = await CoinBalanceModel.findById(intent.userId).session(session).lean();
      return { ledgerId: existing._id, balance: toCoins(bal?.balanceMc ?? 0) };
    }
    const bal = await CoinBalanceModel.findOneAndUpdate(
      { _id: intent.userId, balanceMc: { $gte: amountMc } },
      { $inc: { balanceMc: -amountMc } },
      { session, new: true },
    ).lean();
    if (!bal) {
      const current = await CoinBalanceModel.findById(intent.userId).session(session).lean();
      const balance = toCoins(current?.balanceMc ?? 0);
      throw new ApiError(422, 'INSUFFICIENT_COINS', `You need ${fmt(intent.amount - balance)} more coins for this.`, { required: intent.amount, balance });
    }
    const ledgerId = newId('led');
    await CoinLedgerModel.create([{
      _id: ledgerId, userId: intent.userId, amountMc: -amountMc, source: intent.source, title: intent.title,
      referenceType: intent.referenceType, referenceId: intent.referenceId, idempotencyKey: intent.idempotencyKey ?? null,
      actor: 'user', deviceId: intent.deviceId, appVersion: intent.appVersion,
    }], { session });
    return { ledgerId, balance: toCoins(bal.balanceMc) };
  });
}

function refFilter(e: { userId: string; source: string; referenceType: string; referenceId: string }) {
  return { userId: e.userId, source: e.source, referenceType: e.referenceType, referenceId: e.referenceId };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
