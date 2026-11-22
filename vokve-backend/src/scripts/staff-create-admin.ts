import { connectMongo, disconnectMongo } from '../db/mongo.js';
import { createFirstAdmin } from '../modules/staff/service.js';

/**
 * The first admin (RULES Z9) — or another one, when every admin is locked
 * out and the panel's break-glass key is not to hand.
 *
 *   npm run staff:create-admin -- owner@vokve.app "Owner Name"
 *
 * Prints a temporary password once. The first sign-in asks for a new one
 * and for an authenticator app, before anything else opens. Uses the
 * database in `.env` — check which one that is before running it.
 */
async function main(): Promise<void> {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ').trim();
  if (!email || !email.includes('@') || name.length < 2) {
    console.error('Usage: npm run staff:create-admin -- <email> "<name>"');
    process.exit(1);
  }
  await connectMongo();
  try {
    const password = await createFirstAdmin(email, name);
    console.log(`\nAdmin created: ${email.trim().toLowerCase()} (${name})`);
    console.log(`Temporary password (shown once): ${password}`);
    console.log('Sign in to the panel with it; you will be asked to choose a new password and set up an authenticator app.\n');
  } finally {
    await disconnectMongo();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
