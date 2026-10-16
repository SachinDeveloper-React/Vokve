import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.OTP_DEV_ECHO = 'true';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
// The operator's door is open in tests, so the admin API can be exercised.
process.env.ADMIN_API_KEY = 'test-admin-key-test-admin-key';
delete process.env.REDIS_URL;
// No reaching out to a real mail server either. A developer's own `.env`
// carries working SMTP credentials, and every `signUpAndRegister` sends the
// email OTP — so a full run was quietly sending hundreds of real emails and
// then failing with `EMAIL_UNAVAILABLE` once the provider rate-limited it.
// `auth.test.ts` stands up a capturing transport and sets these on `env`
// itself for the tests that are actually about email.
// Emptied rather than deleted: `config/env.ts` does `import 'dotenv/config'`,
// and dotenv fills a variable that is *missing* — it leaves one that is
// already set, even to ''. A delete here would simply be undone by `.env`.
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.MAIL_FROM = '';
// And no live push provider: a developer's `.env` now carries a real Firebase
// service account, and a suite that initialised it would be one `sendPush`
// away from putting a test notification on a real phone. The tests that are
// about push stand up their own capturing transport (`setPushTransport`).
// Every form the resolver accepts has to be emptied, not just one — leaving
// the three keys set would hand the suite working credentials by the back door.
process.env.FIREBASE_PROJECT_ID = '';
process.env.FIREBASE_CLIENT_EMAIL = '';
process.env.FIREBASE_PRIVATE_KEY = '';
process.env.FIREBASE_SERVICE_ACCOUNT = '';
// No reaching out to Google from a test: the revocation list is stubbed where it matters.
process.env.ATTESTATION_STATUS_URL = '';
process.env.PLAY_INTEGRITY_PROJECT_ID = '';
process.env.PLAY_INTEGRITY_CLIENT_EMAIL = '';
process.env.PLAY_INTEGRITY_PRIVATE_KEY = '';
process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT = '';
delete process.env.PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER;

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  // Transactions need a replica set — a single-node one is enough.
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = replSet.getUri('vokve_test');
  const { connectMongo } = await import('../src/db/mongo.js');
  await connectMongo(process.env.MONGODB_URI);
  await mongoose.connection.db!.admin().command({ ping: 1 });
  // Ensure indexes exist before tests rely on unique constraints.
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));
});

afterEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map(c => c.deleteMany({})));
  const { invalidateConfig } = await import('../src/config/remote.js');
  invalidateConfig();
  // The in-memory KV holds rate-limit counters, idempotency replays and
  // burned step-up tokens; each test starts with none of another's. In
  // tests `quit()` only empties the map — the instance stays usable.
  const { getKV } = await import('../src/db/redis.js');
  await getKV().quit();
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});
