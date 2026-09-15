/**
 * Runs the API on a throwaway in-memory MongoDB replica set — for a machine
 * without Docker or an Atlas string yet. Data is gone when the process exits;
 * the seed runs on every start so the catalogue is always there.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = replSet.getUri('vokve_dev');
process.env.OTP_DEV_ECHO = process.env.OTP_DEV_ECHO ?? 'true';

const { connectMongo } = await import('./db/mongo.js');
await connectMongo(process.env.MONGODB_URI);
const { seed } = await import('./seed/seed.js');
await seed();
const { createApp } = await import('./app.js');
const { env } = await import('./config/env.js');
const { logger } = await import('./lib/logger.js');
const { startScheduler } = await import('./jobs/scheduler.js');

createApp().listen(env.PORT, () => {
  logger.info({ port: env.PORT, mongo: 'in-memory replica set', otpEcho: env.OTP_DEV_ECHO }, 'vokve-backend listening (dev:memory)');
});
startScheduler();

process.on('SIGINT', async () => { await replSet.stop(); process.exit(0); });
