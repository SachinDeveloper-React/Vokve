import { env } from '../config/env.js';
import { getKV } from '../db/redis.js';
import { alertChannels, raiseAlert } from '../lib/alerts.js';
import { mailDailyLimit } from '../lib/mailHealth.js';

/**
 * Sends one test alarm down every configured channel (RULES P20), so the
 * first message anybody sees on the alerts channel is not a real outage.
 *
 *   npm run alerts:test
 *
 * Uses the same `.env` as the server. Its key carries the time, so it is
 * never swallowed by the hour's cooldown of a previous test.
 */
async function main() {
  const channels = alertChannels();
  if (channels.length === 0) {
    console.error('No alert channel is set. Add OPS_TELEGRAM_BOT_TOKEN + OPS_TELEGRAM_CHAT_ID, or OPS_WEBHOOK_URL, to .env.');
    process.exit(1);
  }
  console.log(`Sending a test alert to: ${channels.join(', ')}`);
  await raiseAlert({
    key: `test:${Date.now()}`,
    severity: 'warning',
    title: 'Test alert from vokve-backend',
    lines: [
      'If you can read this, alarms reach you here.',
      `Channels: ${channels.join(', ')}. Mail limit tracked: ${mailDailyLimit() ?? 'no'}.`,
      `Sent ${new Date().toISOString()} from NODE_ENV=${env.NODE_ENV}.`,
    ],
  });
  console.log('Sent. A channel that refused it is named above as alerts.channel_refused / alerts.channel_unreachable.');
  await getKV().quit();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
