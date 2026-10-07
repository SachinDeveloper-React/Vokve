import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { newId } from '../lib/ids.js';
import { CoinBalanceModel, CoinLedgerModel } from '../modules/economy/models.js';
import { UserModel } from '../modules/identity/models.js';

/**
 * Puts coins into an account for testing (RULES E7), without walking for
 * them.
 *
 *   npm run coins:add -- you@example.com 5000
 *   npm run coins:add -- you@example.com        # just read the balance
 *
 * The daily ceiling (⚙ `coins.dailyCap`, 300) is deliberately **not**
 * applied: this is a top-up, not an earning, and a capped top-up would be
 * useless for testing a 1,992-coin order. The ledger row is written as a
 * `refund` so the wallet history still accounts for where the coins came
 * from — there is no `adjustment` source in the contract, and inventing
 * one would mean a client release.
 *
 * Development only. Nothing here is reachable from the API.
 */
const MILLI = 1000;

async function main(): Promise<void> {
  const [who, amountArg] = process.argv.slice(2);
  if (!who) {
    throw new Error('Give an email or a user id: npm run coins:add -- you@example.com 5000');
  }

  const user = await UserModel.findOne({
    $or: [{ _id: who }, { email: who }],
  })
    .collation({ locale: 'en', strength: 2 })
    .lean();
  if (!user) throw new Error(`No user matching '${who}'.`);

  const read = async () => {
    const bal = await CoinBalanceModel.findById(user._id).lean();
    return Math.floor((bal?.balanceMc ?? 0) / MILLI);
  };

  if (amountArg === undefined) {
    console.log(`${user.email} has ${await read()} coins.`);
    return;
  }

  const amount = Number(amountArg);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`'${amountArg}' is not a whole number of coins to add.`);
  }

  const amountMc = amount * MILLI;
  const ledgerId = newId('led');
  await CoinLedgerModel.create({
    _id: ledgerId,
    userId: user._id,
    amountMc,
    source: 'refund',
    title: 'Manual top-up',
    referenceType: 'manual',
    referenceId: ledgerId,
    actor: 'system',
  });
  await CoinBalanceModel.updateOne(
    { _id: user._id },
    { $inc: { balanceMc: amountMc, lifetimeEarnedMc: amountMc }, $set: { lastCreditAt: new Date() } },
    { upsert: true },
  );

  console.log(`Added ${amount} coins to ${user.email}. Balance is now ${await read()}.`);
}

connectMongo()
  .then(main)
  .catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(disconnectMongo);
