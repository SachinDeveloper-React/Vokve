import { getConfig } from '../../config/remote.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { AddressModel } from '../commerce/models.js';
import { CoinLedgerModel } from '../economy/models.js';
import { FraudFlagModel } from './models.js';

/**
 * L7, the economic layer (RULES A19): the two signals that only show up at
 * the moment somebody takes the money out.
 *
 * Everything in L0–L6 judges how a day's steps were counted. This judges
 * what happens next, which is where a farm actually reveals itself: coins
 * minted and spent in the same hour, and one address behind several
 * accounts. Neither is proof of anything on its own — a genuinely keen new
 * member really does spend their first coins the day they earn them, and a
 * family shares a doorstep — so both are flags, and the gate behind them is
 * the trust tier's, not a refusal of its own (T5).
 *
 * Checked at checkout rather than nightly, because a flag that arrives after
 * the parcel has shipped is a record, not a control.
 */

export interface RedemptionCheck {
  userId: string;
  /** The member's own day, so the flag sits on the day they spent (D-18). */
  localDay: string;
  /** Coins going into this order; zero means there is nothing to farm here. */
  coinsApplied: number;
  addressId: string;
  now?: Date;
}

/**
 * Raises what this redemption shows, and answers with the kinds raised so
 * the caller can log them. Never throws: a flag that could not be written
 * must not stop somebody buying a yoga mat.
 */
export async function checkRedemption(check: RedemptionCheck): Promise<string[]> {
  try {
    const config = await getConfig();
    const now = check.now ?? new Date();
    const raised: string[] = [];

    if (check.coinsApplied > 0) {
      // The first coins this account ever earned. A redemption inside the
      // window is the shape of a farm: mint, spend, abandon.
      const first = await CoinLedgerModel.findOne({ userId: check.userId, amountMc: { $gt: 0 } })
        .sort({ createdAt: 1 })
        .select({ createdAt: 1, source: 1 })
        .lean();
      const firstAt = first?.createdAt ? new Date(first.createdAt).getTime() : null;
      const minutes = firstAt === null ? null : (now.getTime() - firstAt) / 60_000;
      if (minutes !== null && minutes <= config.trust.fastRedemptionMinutes) {
        raised.push(
          await raise(check, 'fast_redemption', {
            minutesSinceFirstCredit: Math.round(minutes),
            firstCreditSource: first?.source ?? null,
            coins: check.coinsApplied,
          }),
        );
      }
    }

    // One doorstep behind several accounts (A19). Matched on the street line
    // and the postcode, which is what a reused drop-off has in common; the
    // label, the name and the phone are whatever each account typed.
    const address = await AddressModel.findById(check.addressId).select({ line1: 1, postalCode: 1 }).lean();
    if (address) {
      const others = await AddressModel.distinct('userId', {
        userId: { $ne: check.userId },
        postalCode: address.postalCode,
        line1: new RegExp(`^${escapeRegExp(address.line1.trim())}$`, 'i'),
        deletedAt: null,
      });
      if (others.length + 1 >= config.trust.flagAtAccountsPerAddress) {
        raised.push(
          await raise(check, 'address_reuse', {
            accounts: others.length + 1,
            postalCode: address.postalCode,
          }),
        );
      }
    }

    return raised.filter(Boolean);
  } catch (err) {
    logger.warn({ err, userId: check.userId }, 'economic.check_failed');
    return [];
  }
}

/** One row per (user, day, kind), like every other layer's (A27). */
async function raise(check: RedemptionCheck, kind: string, details: Record<string, unknown>): Promise<string> {
  await FraudFlagModel.updateOne(
    { userId: check.userId, localDay: check.localDay, kind },
    {
      $setOnInsert: { _id: newId('flg'), userId: check.userId, localDay: check.localDay, kind, status: 'open' },
      $set: { layer: 'L7', severity: 'soft', deviceId: null, details, lastSeenAt: check.now ?? new Date() },
    },
    { upsert: true },
  );
  return kind;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
