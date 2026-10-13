import { createApp } from './app.js';
import { devRoutesEnabled, env } from './config/env.js';
import { connectMongo, disconnectMongo } from './db/mongo.js';
import { getKV } from './db/redis.js';
import { startScheduler } from './jobs/scheduler.js';
import { logger } from './lib/logger.js';
import { configurePlayIntegrityFromEnv } from './lib/playIntegrity.js';
import { configurePushFromEnv } from './lib/push.js';

async function main() {
  await connectMongo();
  getKV();
  await configurePushFromEnv();
  await configurePlayIntegrityFromEnv();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, otpEcho: env.OTP_DEV_ECHO, devRoutes: devRoutesEnabled }, 'vokve-backend listening');
  });
  if (devRoutesEnabled) {
    // Loud on purpose: these write a member's own step count and run the
    // jobs by hand. Anybody reading the first screen of logs on a server
    // that should not have them should see them (RULES A26).
    logger.warn(
      { routes: ['POST /v1/dev/steps', 'POST /v1/dev/jobs/coin-expiry', 'POST /v1/dev/jobs/coin-expiry-warn'] },
      'developer endpoints are mounted — set NODE_ENV=production or DEV_ROUTES=false on a real deployment',
    );
  }
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
