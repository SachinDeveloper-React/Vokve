import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { unpinRetiredDefaults } from '../config/retired.js';

/**
 * Unpins config a database is still holding from an older build's defaults
 * (D-112) — the vokve.app links above all.
 *
 *   npm run config:retired-defaults             # says what it would change
 *   npm run config:retired-defaults -- --apply  # changes it
 *
 * Only a value that is *exactly* what an older build shipped is touched;
 * anything somebody typed is listed and left alone. `npm run seed` does the
 * same on its way through, so a re-seeded database is already clean.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const { unpinned, kept } = await unpinRetiredDefaults(apply);

  if (unpinned.length === 0) {
    console.log('\nNothing stored is pinned to an old default.');
  } else {
    console.log(`\n${apply ? 'Unpinned' : 'Would unpin'} ${unpinned.length} key(s) — each now follows the code's default:\n`);
    for (const row of unpinned) console.log(`  ${row.path.padEnd(34)} was ${JSON.stringify(row.was)}`);
  }
  if (kept.length > 0) {
    console.log('\nStill naming vokve.app, but not a value any build shipped — change these on the panel (Contact & links):\n');
    for (const row of kept) console.log(`  ${row.path.padEnd(34)} ${JSON.stringify(row.value)}`);
  }
  if (!apply && unpinned.length > 0) console.log('\nRun again with --apply to make the change.');
  console.log('');
}

connectMongo()
  .then(main)
  .catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(disconnectMongo);
