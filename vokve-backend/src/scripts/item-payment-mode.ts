import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { getConfig } from '../config/remote.js';
import { ShopItemModel } from '../modules/commerce/models.js';

/**
 * Sets how one item may be bought (RULES R11), without a deploy.
 *
 *   npm run item:mode                       # list every item and its mode
 *   npm run item:mode -- cap coins          # coins alone
 *   npm run item:mode -- cap money          # money alone
 *   npm run item:mode -- cap mixed          # coins towards part of it
 *   npm run item:mode -- cap default        # back to following the shop
 *
 * `default` clears the item's own setting, so it follows ⚙
 * `commerce.paymentMode` again. The change is live on the next
 * `GET /shop/items` — nothing is cached, so a pull-to-refresh in the app
 * is enough to see it.
 */
const MODES = ['coins', 'money', 'mixed', 'default'] as const;
type Mode = (typeof MODES)[number];

type Row = { _id: string; title: string; price: number; paymentMode?: string | null };

async function list(): Promise<void> {
  const shopDefault = (await getConfig()).commerce.paymentMode;
  const rows = (await ShopItemModel.find({ active: { $ne: false } })
    .sort({ sort: 1 })
    .lean()) as unknown as Row[];
  const width = Math.max(...rows.map(r => r._id.length), 8);
  console.log(`\nThe shop's default is '${shopDefault}'. ${rows.length} items:\n`);
  for (const row of rows) {
    const own = row.paymentMode ?? null;
    const effective = own ?? shopDefault;
    console.log(
      `  ${row._id.padEnd(width)}  ${effective.padEnd(6)}` +
        `${own ? '' : ' (from the shop)'}`.padEnd(18) +
        `₹${(row.price / 100).toFixed(2).padStart(9)}  ${row.title}`,
    );
  }
  console.log('\n  npm run item:mode -- <itemId> <coins|money|mixed|default>\n');
}

async function set(itemId: string, mode: Mode): Promise<void> {
  const value = mode === 'default' ? null : mode;
  const result = await ShopItemModel.updateOne({ _id: itemId }, { $set: { paymentMode: value } });
  if (result.matchedCount === 0) {
    throw new Error(`No item with id '${itemId}'. Run with no arguments to list them.`);
  }
  const shopDefault = (await getConfig()).commerce.paymentMode;
  console.log(
    value === null
      ? `${itemId} now follows the shop ('${shopDefault}').`
      : `${itemId} is now '${value}'.`,
  );
}

async function main(): Promise<void> {
  const [itemId, mode] = process.argv.slice(2);
  if (!itemId) {
    await list();
    return;
  }
  if (!mode || !(MODES as readonly string[]).includes(mode)) {
    throw new Error(`Give a mode: ${MODES.join(', ')}.`);
  }
  await set(itemId, mode as Mode);
}

connectMongo()
  .then(main)
  .catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(disconnectMongo);
