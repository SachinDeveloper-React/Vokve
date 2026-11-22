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
const { logger, logListening } = await import('./lib/logger.js');
const { startScheduler } = await import('./jobs/scheduler.js');
const { configurePlayIntegrityFromEnv } = await import('./lib/playIntegrity.js');
await configurePlayIntegrityFromEnv();

createApp().listen(env.PORT, err => {
  if (err) {
    logger.fatal({ err }, `could not listen on port ${env.PORT} — is another server still running? lsof -nP -iTCP:${env.PORT} -sTCP:LISTEN`);
    process.exit(1);
  }
  logListening(env.PORT, {
    Environment: env.NODE_ENV,
    MongoDB: 'in-memory replica set (wiped on exit)',
    'OTP echo': env.OTP_DEV_ECHO ? 'on' : 'off',
    'Log level': env.LOG_LEVEL,
  }, 'vokve-backend (dev:memory) is running');
});
startScheduler();

process.on('SIGINT', async () => { await replSet.stop(); process.exit(0); });
