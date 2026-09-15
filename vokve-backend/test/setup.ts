import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.OTP_DEV_ECHO = 'true';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
delete process.env.REDIS_URL;

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
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});
