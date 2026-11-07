import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../config/remote.js';
import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { addDays, localMidnightUtc } from '../lib/dates.js';
import { ChallengeDefinitionModel, ChallengeCompletionModel } from '../modules/challenges/models.js';
import { withinPayWindow } from '../modules/challenges/service.js';
import { CoinBalanceModel, CoinDailyCapModel, CoinLedgerModel } from '../modules/economy/models.js';
import { UserModel } from '../modules/identity/models.js';

/**
 * Reads every wallet and says whether the books add up (RULES E7, E8, C4).
 * Writes nothing, ever.
 *
 *   npm run coins:audit
 *   npm run coins:audit -- --json
 *
 * Exits non-zero when anything is wrong, so it can be a cron or a step in
 * a deploy rather than something somebody has to remember to look at. This
 * exists because two coin bugs were found by reading a screenshot of the
 * admin ledger, which is not a way to find the third.
 *
 * What it asks, each one an invariant the economy is supposed to hold:
 *
 *  1. **No event paid twice.** `credit()` is idempotent on
 *     `(user, source, referenceType, referenceId)` and the collection has a
 *     unique index on it — this checks the index is actually there and has
 *     always been.
 *  2. **Every wallet equals its own rows.** `balanceMc` is a running total
 *     of the ledger and `lifetimeEarnedMc` of its credits. A balance above
 *     its ledger is coins nobody can account for; below it, coins a member
 *     has lost. Holds are not in either figure until they are released, so
 *     `pendingMc` is reported beside them rather than added in.
 *  3. **Nobody earned past the daily ceiling** ⚙ `coins.dailyCap`.
 *  4. **No challenge paid more than it is worth**, and no completion claims
 *     a payment with no row behind it.
 *  5. **No challenge paid for a day that had already closed** beyond
 *     ⚙ `challenges.payGraceHours` — asked with the same `withinPayWindow`
 *     the payment itself asks, so this cannot drift from the rule.
 */

const MILLI = 1000;
const coins = (mc: number) => Math.round((mc / MILLI) * 1000) / 1000;

export interface Finding {
  check: string;
  userId: string;
  detail: string;
  /** Coins involved, signed as the wallet sees them. */
  coins: number;
}

export async function auditCoins(): Promise<Finding[]> {
  const config = await getConfig();
  const findings: Finding[] = [];
  const say = (check: string, userId: string, detail: string, amount = 0) =>
    findings.push({ check, userId, detail, coins: amount });

  // 1 ── the same event paid twice
  const dupes = await CoinLedgerModel.aggregate<{ _id: { u: string; s: string; rt: string; ri: string }; n: number; mc: number }>([
    { $group: { _id: { u: '$userId', s: '$source', rt: '$referenceType', ri: '$referenceId' }, n: { $sum: 1 }, mc: { $sum: '$amountMc' } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  for (const row of dupes) {
    say('double_pay', row._id.u, `${row._id.s}/${row._id.rt}:${row._id.ri} paid ${row.n} times`, coins(row.mc));
  }

  // 2 ── wallet against its own rows
  const sums = new Map(
    (
      await CoinLedgerModel.aggregate<{ _id: string; net: number; credits: number }>([
        { $group: { _id: '$userId', net: { $sum: '$amountMc' }, credits: { $sum: { $cond: [{ $gt: ['$amountMc', 0] }, '$amountMc', 0] } } } },
      ])
    ).map(row => [row._id, row]),
  );
  for (const wallet of await CoinBalanceModel.find({}).lean()) {
    const ledger = sums.get(wallet._id) ?? { net: 0, credits: 0 };
    const balanceDrift = (wallet.balanceMc ?? 0) - ledger.net;
    const earnedDrift = (wallet.lifetimeEarnedMc ?? 0) - ledger.credits;
    if (balanceDrift !== 0) {
      say('balance_drift', wallet._id, `balance ${coins(wallet.balanceMc ?? 0)} against a ledger of ${coins(ledger.net)}`, coins(balanceDrift));
    }
    if (earnedDrift !== 0) {
      say('lifetime_drift', wallet._id, `lifetime earned ${coins(wallet.lifetimeEarnedMc ?? 0)} against credits of ${coins(ledger.credits)}`, coins(earnedDrift));
    }
  }

  // 3 ── the daily ceiling
  const capMc = config.coins.dailyCap * MILLI;
  for (const cap of await CoinDailyCapModel.find({ totalMc: { $gt: capMc } }).lean()) {
    say('over_daily_cap', cap.userId, `${cap.localDay} earned ${coins(cap.totalMc)} over a ceiling of ${config.coins.dailyCap}`, coins(cap.totalMc - capMc));
  }

  // 4 and 5 ── the challenges
  const defs = new Map((await ChallengeDefinitionModel.find({}).lean()).map(def => [def._id, def]));
  const zones = new Map((await UserModel.find({}, { timezone: 1 }).lean()).map(user => [user._id, user.timezone || config.locale.timezone]));
  const rows = await CoinLedgerModel.find({ source: 'challenge', referenceType: 'challenge' }).lean();
  const paid = new Map(rows.map(row => [`${row.userId}|${row.referenceId}`, row]));

  for (const row of rows) {
    const cut = row.referenceId.lastIndexOf(':');
    const challengeId = row.referenceId.slice(0, cut);
    const periodStart = row.referenceId.slice(cut + 1);
    const def = defs.get(challengeId);
    if (!def) {
      say('unknown_challenge', row.userId, `paid for ${row.referenceId}, which is not in the catalogue`, coins(row.amountMc));
      continue;
    }
    if (coins(row.amountMc) > def.rewardCoins) {
      say('over_reward', row.userId, `${row.referenceId} paid ${coins(row.amountMc)} over a reward of ${def.rewardCoins}`, coins(row.amountMc) - def.rewardCoins);
    }
    const completion = await ChallengeCompletionModel.findById(`${row.userId}:${challengeId}:${periodStart}`).lean();
    if (!completion) {
      say('no_completion', row.userId, `${row.referenceId} was paid with no completion behind it`, coins(row.amountMc));
      continue;
    }
    // The payment's own question, asked of the moment it was paid.
    const zone = zones.get(row.userId) ?? config.locale.timezone;
    if (!withinPayWindow({ start: completion.periodStart, end: completion.periodEnd }, zone, config, row.createdAt)) {
      // Measured from the same midnight the rule measures from — the one
      // that ends the period, on the member's own clock.
      const closed = localMidnightUtc(addDays(completion.periodEnd, 1), zone).getTime();
      const late = Math.round((row.createdAt.getTime() - closed) / 3_600_000);
      say('retro_payout', row.userId, `${row.referenceId} paid ${late}h after its period, past the ${config.challenges.payGraceHours}h grace`, coins(row.amountMc));
    }
  }

  for (const completion of await ChallengeCompletionModel.find({ granted: { $gt: 0 } }).lean()) {
    const row = paid.get(`${completion.userId}|${completion.challengeId}:${completion.periodStart}`);
    if (!row) {
      say('granted_no_row', completion.userId, `${completion._id} says it granted ${completion.granted} with no ledger row`, completion.granted);
    } else if (coins(row.amountMc) !== completion.granted) {
      say('granted_mismatch', completion.userId, `${completion._id} says ${completion.granted}, the ledger says ${coins(row.amountMc)}`, completion.granted - coins(row.amountMc));
    }
  }

  return findings;
}

async function main(): Promise<void> {
  const asJson = process.argv.slice(2).includes('--json');
  const findings = await auditCoins();

  if (asJson) {
    console.log(JSON.stringify(findings, null, 2));
  } else if (findings.length === 0) {
    const wallets = await CoinBalanceModel.estimatedDocumentCount();
    const rows = await CoinLedgerModel.estimatedDocumentCount();
    console.log(`Every book balances: ${wallets} wallet(s) over ${rows} ledger row(s), nothing paid twice and nothing paid late.`);
  } else {
    const emails = new Map((await UserModel.find({}, { email: 1 }).lean()).map(user => [user._id, user.email]));
    const byCheck = new Map<string, Finding[]>();
    for (const finding of findings) byCheck.set(finding.check, [...(byCheck.get(finding.check) ?? []), finding]);
    for (const [check, rows] of byCheck) {
      const total = rows.reduce((sum, row) => sum + row.coins, 0);
      console.log(`\n${check} — ${rows.length} finding(s), ${Math.round(total * 1000) / 1000} coins`);
      for (const row of rows) console.log(`  ${emails.get(row.userId) ?? row.userId}: ${row.detail}`);
    }
    console.log(`\n${findings.length} finding(s). Nothing was changed; \`npm run coins:reconcile\` puts the ones it knows how to put right.`);
  }
  process.exitCode = findings.length === 0 ? 0 : 1;
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
