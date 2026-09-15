import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectMongo, disconnectMongo } from './db/mongo.js';
import { getKV } from './db/redis.js';
import { startScheduler } from './jobs/scheduler.js';
import { logger } from './lib/logger.js';

async function main() {
  await connectMongo();
  getKV();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, otpEcho: env.OTP_DEV_ECHO }, 'vokve-backend listening');
  });
  const stopScheduler = startScheduler();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopScheduler();
    server.close();
    await getKV().quit();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(err => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
