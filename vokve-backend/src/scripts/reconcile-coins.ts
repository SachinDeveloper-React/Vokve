import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { newId } from '../lib/ids.js';
import { CoinBalanceModel, CoinLedgerModel } from '../modules/economy/models.js';
import { UserModel } from '../modules/identity/models.js';
import { auditCoins, type Finding } from './audit-coins.js';

/**
 * Puts right what `npm run coins:audit` found, and nothing else.
 *
 *   npm run coins:reconcile                      # say what would happen
 *   npm run coins:reconcile -- --apply
 *   npm run coins:reconcile -- --apply --retro   # only the late challenges
 *
 * Dry by default: this moves real balances, so writing has to be asked for
 * out loud. Idempotent — every row it writes carries a `referenceId` the
 * unique index already guards, so a second run finds nothing left to do.
 *
 * Two kinds of finding, and it refuses the rest:
 *
 * - **`retro_payout`** — a challenge paid for a day that had already closed
 *   past ⚙ `challenges.payGraceHours`. The credit row **stays**: it is what
 *   happened, and deleting it would leave a completion claiming a payment
 *   with nothing behind it. A matching negative row is written beside it
 *   and the balance comes down by the same amount. `lifetimeEarnedMc` is
 *   left alone, exactly as the expiry sweep leaves it: the invariant the
 *   audit checks is that it equals the sum of the *credits*, and a reversal
 *   is a debit.
 *
 * - **`balance_drift` upwards** — a wallet holding coins the ledger cannot
 *   account for, which is what a hand-written balance or a top-up from
 *   before `coins:add` wrote its row leaves behind. The coins are **not**
 *   taken away: the member has been spending them for weeks and clawing
 *   them back is the one outcome nobody asked for. A `Manual top-up` row is
 *   written for exactly the gap, the balance is untouched, and the books
 *   agree from then on. `--drift` has to name the member, so this can never
 *   run across a fleet and quietly mint whatever a real bug has leaked.
 *
 * A drift *downwards* — a wallet poorer than its ledger — is never touched
 * here. That is a member owed coins, and it wants a person looking at it.
 */

const MILLI = 1000;

interface Write {
  userId: string;
  amountMc: number;
  title: string;
  referenceType: string;
  referenceId: string;
  /** Whether the balance moves with the row. */
  movesBalance: boolean;
  why: string;
}

/** The ledger rows a set of findings calls for. Pure, so the dry run and the write cannot disagree. */
export function writesFor(findings: Finding[], only: { retro: boolean; drift: string | null }): Write[] {
  const writes: Write[] = [];
  for (const finding of findings) {
    if (finding.check === 'retro_payout' && only.retro) {
      // `ch-acheck:2026-11-02 paid 68h after …` — the reference is the first word.
      const reference = finding.detail.split(' ')[0];
      writes.push({
        userId: finding.userId,
        amountMc: -Math.round(finding.coins * MILLI),
        title: 'Challenge coins reversed',
        // `reversal:<type>:<id>`, so the row can still say which day it is
        // about: `earnedPeriodsFor` reads the reversed reference out of it.
        referenceType: 'adjustment',
        referenceId: `reversal:challenge:${reference}`,
        movesBalance: true,
        why: `${reference} was paid outside the grace`,
      });
    }
    if (finding.check === 'balance_drift' && finding.coins > 0 && finding.userId === only.drift) {
      writes.push({
        userId: finding.userId,
        amountMc: Math.round(finding.coins * MILLI),
        title: 'Manual top-up',
        referenceType: 'manual',
        referenceId: `drift:${finding.userId}`,
        movesBalance: false,
        why: `${finding.coins} coins in the wallet that the ledger never recorded`,
      });
    }
  }
  return writes;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const driftFor = args.includes('--drift') ? (args[args.indexOf('--drift') + 1] ?? null) : null;
  // Naming neither means both; naming one means only that one.
  const asked = args.includes('--retro') || driftFor !== null;
  const only = { retro: !asked || args.includes('--retro'), drift: driftFor };

  const findings = await auditCoins();
  const unhandled = findings.filter(f => !['retro_payout', 'balance_drift', 'lifetime_drift'].includes(f.check));
  const writes = writesFor(findings, only);

  if (writes.length === 0) {
    console.log('Nothing to reconcile.');
  }
  for (const write of writes) {
    const sign = write.amountMc > 0 ? '+' : '';
    console.log(
      `${apply ? 'writing' : 'would write'}  ${write.userId}  ${sign}${write.amountMc / MILLI} coins  ${write.referenceType}:${write.referenceId}` +
        `  (${write.movesBalance ? 'balance moves' : 'balance untouched'}) — ${write.why}`,
    );
  }

  if (apply) {
    for (const write of writes) {
      try {
        await CoinLedgerModel.create({
          _id: newId('led'),
          userId: write.userId,
          amountMc: write.amountMc,
          source: 'refund',
          title: write.title,
          referenceType: write.referenceType,
          referenceId: write.referenceId,
          actor: 'system',
        });
      } catch (err) {
        // Already reconciled: the unique index is the second run's answer.
        if ((err as { code?: number }).code === 11000) {
          console.log(`  already done: ${write.referenceType}:${write.referenceId}`);
          continue;
        }
        throw err;
      }
      if (write.movesBalance) {
        await CoinBalanceModel.updateOne({ _id: write.userId }, { $inc: { balanceMc: write.amountMc } });
      }
    }
    const left = await auditCoins();
    console.log(`\nDone. The audit now finds ${left.length} finding(s).`);
    for (const finding of left) console.log(`  ${finding.check}: ${finding.userId} — ${finding.detail}`);
  } else {
    console.log(`\nDry run — nothing was written. Add --apply to write.`);
  }

  if (unhandled.length > 0) {
    console.log(`\n${unhandled.length} finding(s) this script will not touch, because they want a person:`);
    const emails = new Map((await UserModel.find({}, { email: 1 }).lean()).map(u => [u._id, u.email]));
    for (const finding of unhandled) console.log(`  ${finding.check}: ${emails.get(finding.userId) ?? finding.userId} — ${finding.detail}`);
  }
}

/**
 * Run as a command, not imported: the tests pull `auditCoins` and
 * `writesFor` in to check them, and a top-level connect would fight the
 * harness's own in-memory replica set for the mongoose singleton.
 */
const runAsCommand = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (runAsCommand) {
  connectMongo()
    .then(main)
    .catch(err => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(disconnectMongo);
}
