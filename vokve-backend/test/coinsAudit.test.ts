import { describe, expect, it } from 'vitest';
import { addDays, localDayOf, localMidnightUtc } from '../src/lib/dates.js';
import { ChallengeCompletionModel } from '../src/modules/challenges/models.js';
import { CoinBalanceModel, CoinLedgerModel } from '../src/modules/economy/models.js';
import { auditCoins } from '../src/scripts/audit-coins.js';
import { writesFor } from '../src/scripts/reconcile-coins.js';
import { signUpAndRegister, type Session } from './helpers.js';

const ZONE = 'Asia/Kolkata';
const today = () => localDayOf(new Date(), ZONE);
const MILLI = 1000;

/**
 * The standing check over the books (RULES E7, E8, C4).
 *
 * Both coin bugs this came out of were found by reading a screenshot of the
 * admin ledger. That is not a way to find the third, so the invariants the
 * economy is supposed to hold are asked of the real collections on demand —
 * and these are the checks on the checker.
 */
describe('coins: the audit over every wallet', () => {
  /** A challenge paid at `paidAt`, with the completion behind it. */
  async function paidChallenge(session: Session, periodStart: string, paidAt: Date, coins = 10) {
    await ChallengeCompletionModel.create({
      _id: `${session.userId}:ch-10k-steps:${periodStart}`,
      userId: session.userId,
      challengeId: 'ch-10k-steps',
      cadence: 'daily',
      periodStart,
      periodEnd: periodStart,
      progress: 10_400,
      goal: 10_000,
      rewardCoins: coins,
      granted: coins,
      status: 'paid',
      completedAt: paidAt,
    });
    await CoinLedgerModel.create({
      _id: `led_${periodStart}_${session.userId.slice(-6)}`,
      userId: session.userId,
      amountMc: coins * MILLI,
      source: 'challenge',
      title: '10K Steps Challenge completed',
      referenceType: 'challenge',
      referenceId: `ch-10k-steps:${periodStart}`,
      createdAt: paidAt,
    });
    await CoinBalanceModel.updateOne(
      { _id: session.userId },
      { $inc: { balanceMc: coins * MILLI, lifetimeEarnedMc: coins * MILLI } },
      { upsert: true },
    );
  }

  it('finds nothing wrong with a day paid on the day', async () => {
    const session = await signUpAndRegister();
    await paidChallenge(session, today(), new Date());
    expect(await auditCoins()).toEqual([]);
  });

  it('finds nothing wrong with yesterday paid this morning — the grace is the point', async () => {
    const session = await signUpAndRegister();
    const yesterday = addDays(today(), -1);
    // Eight hours after yesterday's midnight: a phone syncing at breakfast.
    await paidChallenge(session, yesterday, new Date(localMidnightUtc(today(), ZONE).getTime() + 8 * 3_600_000));
    expect(await auditCoins()).toEqual([]);
  });

  it('catches a challenge paid for a day that had long closed, and reverses exactly it', async () => {
    const session = await signUpAndRegister();
    const longAgo = addDays(today(), -5);
    await paidChallenge(session, longAgo, new Date(), 25);

    const findings = await auditCoins();
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ check: 'retro_payout', userId: session.userId, coins: 25 });

    const writes = writesFor(findings, { retro: true, drift: null });
    expect(writes).toEqual([
      expect.objectContaining({
        userId: session.userId,
        amountMc: -25_000,
        referenceType: 'adjustment',
        referenceId: `reversal:challenge:ch-10k-steps:${longAgo}`,
        movesBalance: true,
      }),
    ]);
  });

  it('catches a wallet holding coins the ledger never recorded, and accounts for them without taking them', async () => {
    const session = await signUpAndRegister();
    await CoinBalanceModel.updateOne(
      { _id: session.userId },
      { $inc: { balanceMc: 5_000 * MILLI, lifetimeEarnedMc: 5_000 * MILLI } },
      { upsert: true },
    );

    const findings = await auditCoins();
    expect(findings.map(f => f.check).sort()).toEqual(['balance_drift', 'lifetime_drift']);

    // Named, or it is left alone: this must never run across a fleet.
    expect(writesFor(findings, { retro: true, drift: null })).toEqual([]);
    const writes = writesFor(findings, { retro: true, drift: session.userId });
    expect(writes).toEqual([
      expect.objectContaining({ amountMc: 5_000 * MILLI, referenceType: 'manual', movesBalance: false }),
    ]);
  });

  it('never claws back a wallet that is poorer than its ledger — that one wants a person', async () => {
    const session = await signUpAndRegister();
    await paidChallenge(session, today(), new Date(), 50);
    await CoinBalanceModel.updateOne({ _id: session.userId }, { $inc: { balanceMc: -20 * MILLI } });

    const findings = await auditCoins();
    expect(findings.find(f => f.check === 'balance_drift')).toMatchObject({ coins: -20 });
    expect(writesFor(findings, { retro: true, drift: session.userId })).toEqual([]);
  });

  it('catches a completion that claims coins with no row behind it', async () => {
    const session = await signUpAndRegister();
    await ChallengeCompletionModel.create({
      _id: `${session.userId}:ch-10k-steps:${today()}`,
      userId: session.userId,
      challengeId: 'ch-10k-steps',
      cadence: 'daily',
      periodStart: today(),
      periodEnd: today(),
      progress: 10_400,
      goal: 10_000,
      rewardCoins: 200,
      granted: 200,
      status: 'paid',
      completedAt: new Date(),
    });
    expect((await auditCoins()).map(f => f.check)).toContain('granted_no_row');
  });
});
