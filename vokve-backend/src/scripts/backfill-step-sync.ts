import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { DeviceModel } from '../modules/devices/models.js';
import { CoinBalanceModel } from '../modules/economy/models.js';

/**
 * Backfills `coin_balances.lastStepSyncAt` from the installs that have
 * already reported (RULES E9).
 *
 *   npm run coins:backfill-sync -- --dry    # count, change nothing
 *   npm run coins:backfill-sync
 *
 * The idle-expiry window used to run from the newest credit and now runs
 * from the newest step sync, which the ingest path stamps as it accepts a
 * snapshot. Every member who synced *before* that shipped has no stamp, so
 * without this they look like a member who has never synced and stay on the
 * old credit clock until their next upload — which for someone who last
 * earned eighty-five days ago means a wallet swept while their phone was
 * reporting every single day. Run it once, with the deploy.
 *
 * Revoked installs count: the question is whether this member has ever
 * reported, and a phone they have since replaced reported all the same.
 * Being generous here costs a member nothing and being strict costs them
 * their balance.
 *
 * Idempotent. A wallet that already carries a stamp is left alone, so a
 * second run cannot drag a live one backwards, and a wallet that does not
 * exist yet is skipped rather than created — nothing with no coins in it can
 * expire, and its first credit will arrive with a fresh clock anyway.
 */
async function main(): Promise<void> {
  const dry = process.argv.slice(2).includes('--dry');

  const synced = await DeviceModel.aggregate<{ _id: string; at: Date }>([
    { $match: { 'stepSync.uploadedAt': { $ne: null } } },
    { $group: { _id: '$userId', at: { $max: '$stepSync.uploadedAt' } } },
  ]);

  if (synced.length === 0) {
    console.log('No install has reported yet; nothing to backfill.');
    return;
  }

  // `lastStepSyncAt: null` also matches the documents written before the
  // field existed, which have no such key at all.
  const pending = await CoinBalanceModel.countDocuments({
    _id: { $in: synced.map(row => row._id) },
    lastStepSyncAt: null,
  });

  if (dry) {
    console.log(`${synced.length} member(s) have reported; ${pending} wallet(s) would be stamped.`);
    return;
  }

  const result = await CoinBalanceModel.bulkWrite(
    synced.map(row => ({
      updateOne: {
        filter: { _id: row._id, lastStepSyncAt: null },
        update: { $set: { lastStepSyncAt: row.at } },
      },
    })),
  );

  console.log(`Stamped ${result.modifiedCount} wallet(s) from ${synced.length} member(s) that have reported.`);
}

connectMongo()
  .then(main)
  .catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(disconnectMongo);
