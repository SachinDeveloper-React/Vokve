import fs from 'node:fs';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import type { PushMessage, PushResult, PushTransport } from './push.js';

/** FCM's own words for a token that will never work again. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Push over Firebase Cloud Messaging, built from the service account in
 * `FIREBASE_SERVICE_ACCOUNT` (the JSON, or a path to it). Loaded lazily and
 * only when configured, so the SDK is never initialised — or even imported —
 * on a laptop without credentials.
 *
 * Tokens FCM reports dead come back as `invalid`; the caller retires them.
 * Every other per-token failure is logged and counted as not sent.
 */
export async function createFcmTransport(): Promise<PushTransport | null> {
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;

  const json = raw.trim().startsWith('{') ? raw : fs.readFileSync(raw, 'utf8');
  const credential = JSON.parse(json) as { project_id?: string };
  const admin = await import('firebase-admin');
  const app = admin.default.apps.length
    ? admin.default.app()
    : admin.default.initializeApp({ credential: admin.default.credential.cert(credential as never) });
  const messaging = admin.default.messaging(app);
  logger.info({ project: credential.project_id }, 'push.fcm_ready');

  return {
    async send(tokens: string[], message: PushMessage): Promise<PushResult> {
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: 'high', notification: { channelId: 'vokve.default' } },
        apns: { payload: { aps: { sound: 'default' } } },
      });
      const invalid: string[] = [];
      response.responses.forEach((r, i) => {
        if (r.success) return;
        const code = r.error?.code ?? 'unknown';
        if (DEAD_TOKEN_CODES.has(code)) invalid.push(tokens[i]);
        else logger.warn({ code, message: r.error?.message }, 'push.fcm_failed');
      });
      return { sent: response.successCount, invalid };
    },
  };
}
