import mongoose from 'mongoose';
import { createApp } from './app.js';
import { devRoutesEnabled, env, isProduction } from './config/env.js';
import { connectMongo, disconnectMongo } from './db/mongo.js';
import { getKV } from './db/redis.js';
import { startScheduler } from './jobs/scheduler.js';
import { logger, logListening } from './lib/logger.js';
import { isAppleRevocationConfigured } from './lib/appleTokens.js';
import { alertChannels } from './lib/alerts.js';
import { mailDailyLimit } from './lib/mailHealth.js';
import { configurePlayIntegrityFromEnv } from './lib/playIntegrity.js';
import { configurePushFromEnv } from './lib/push.js';

/** Where a database lives, without the credentials in its URI. */
function hostOf(uri: string): string {
  try {
    const u = new URL(uri);
    return `${u.host}${u.pathname.length > 1 ? u.pathname : ''}`;
  } catch {
    return '(unparseable URI)';
  }
}

async function main() {
  logger.info(`starting vokve-backend (${env.NODE_ENV}) on port ${env.PORT} — connecting to MongoDB at ${hostOf(env.MONGODB_URI)}…`);
  await connectMongo();
  getKV();
  const push = await configurePushFromEnv();
  const integrity = await configurePlayIntegrityFromEnv();
  const app = createApp();
  const server = app.listen(env.PORT, err => {
    // Express 5 calls this on a failed bind too, with the error — without
    // this check a taken port printed "listening" while the old process kept
    // answering every request.
    if (err) {
      const inUse = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
      logger.fatal(
        { err },
        inUse
          ? `port ${env.PORT} is already in use — another server is still running. Find it with: lsof -nP -iTCP:${env.PORT} -sTCP:LISTEN`
          : `could not listen on port ${env.PORT}`,
      );
      process.exit(1);
    }
    logListening(env.PORT, {
      Environment: env.NODE_ENV,
      MongoDB: mongoose.connection.name,
      Redis: env.REDIS_URL ? hostOf(env.REDIS_URL) : 'in-memory (no REDIS_URL)',
      Push: push ? 'FCM' : 'off',
      'Play Integrity': integrity ? 'on' : 'off',
      Payments: env.PAYMENT_PROVIDER,
      'Apple sign-in': env.APPLE_CLIENT_IDS ? (isAppleRevocationConfigured() ? 'on, revocation on' : 'on, revocation OFF') : 'off',
      Alerts: alertChannels().join(', ') || 'OFF (nobody is told)',
      'Mail limit': mailDailyLimit() ? `${mailDailyLimit()}/day, warns at 80%` : 'not tracked',
      'Admin sign-in': !env.ADMIN_API_KEY ? 'off' : env.ADMIN_TOTP_SECRET ? 'key + authenticator code' : 'key only (no MFA)',
      'Dev routes': devRoutesEnabled ? 'on' : 'off',
      'OTP echo': env.OTP_DEV_ECHO ? 'on' : 'off',
      'Log level': env.LOG_LEVEL,
    });
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
  if (isProduction && env.PAYMENT_PROVIDER === 'mock') {
    // Only reachable through ALLOW_MOCK_PAYMENTS_IN_PRODUCTION — a stopgap
    // until the gateway is wired, so it says so on every boot.
    logger.warn('payments are MOCKED in production (ALLOW_MOCK_PAYMENTS_IN_PRODUCTION) — money orders are marked paid without money');
  }
  if (isProduction && env.ADMIN_API_KEY && !env.ADMIN_TOTP_SECRET) {
    // One static key is the whole of the operator's door: anyone who reads
    // it off a screen, a shell history or a chat holds every member's data
    // and the coin ledger. Said on every boot until a second factor is set
    // up (RULES Z7).
    logger.warn('the admin API opens with the admin key alone — run `npm run admin:totp` and set ADMIN_TOTP_SECRET so the panel also asks for an authenticator code');
  }
  if (isProduction && env.ADMIN_API_KEY && env.ADMIN_API_KEY.length < 32) {
    logger.warn('ADMIN_API_KEY is shorter than 32 characters — replace it with the output of `openssl rand -base64 36`');
  }
  if (env.APPLE_CLIENT_IDS && !isAppleRevocationConfigured()) {
    // Apple sign-in is live but nothing can be revoked: deleting an account
    // leaves VOKVE in the member's Apple ID, which App Review rejects
    // (RULES O16). Said on every boot until the key is in.
    logger.warn('Sign in with Apple is on but APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY are not set — account deletion cannot revoke Apple tokens');
  }
  if (Boolean(env.OPS_TELEGRAM_BOT_TOKEN) !== Boolean(env.OPS_TELEGRAM_CHAT_ID)) {
    logger.warn('Telegram alerts need both OPS_TELEGRAM_BOT_TOKEN and OPS_TELEGRAM_CHAT_ID — with one of them, nothing is sent there');
  }
  if (isProduction && !alertChannels().some(c => c !== 'email')) {
    // Email alone cannot report the one outage it shares with the OTPs
    // (RULES P20): when the SMTP account stops, its alarm stops with it.
    logger.warn('no alert channel besides email — a mail outage, the most likely one, cannot be reported. Set OPS_TELEGRAM_BOT_TOKEN + OPS_TELEGRAM_CHAT_ID or OPS_WEBHOOK_URL');
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
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
