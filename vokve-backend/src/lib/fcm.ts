import { resolveServiceAccount } from '../config/serviceAccount.js';
import { logger } from './logger.js';
import type { PushMessage, PushResult, PushTransport } from './push.js';

/** FCM's own words for a token that will never work again. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Push over Firebase Cloud Messaging, built from the service account the
 * environment carries (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
 * `FIREBASE_PRIVATE_KEY`). Loaded lazily and only when configured, so the
 * SDK is never initialised — or even imported — on a laptop without
 * credentials.
 *
 * Tokens FCM reports dead come back as `invalid`; the caller retires them.
 * Every other per-token failure is logged and counted as not sent.
 */
export async function createFcmTransport(): Promise<PushTransport | null> {
  const credential = resolveServiceAccount('FIREBASE');
  if (!credential) return null;

  const admin = await import('firebase-admin');
  const app = admin.default.apps.length
    ? admin.default.app()
    : admin.default.initializeApp({ credential: admin.default.credential.cert(credential as never) });
  const messaging = admin.default.messaging(app);
  logger.info({ project: credential.project_id }, 'push.fcm_ready');

  return {
    async send(tokens: string[], message: PushMessage): Promise<PushResult> {
      // What a message's own lifetime means to each provider: FCM takes a
      // duration, APNs an instant to stop trying at. Both drop the message
      // at it rather than delivering it late.
      const ttl = message.ttlSeconds;
      const androidTtl: { ttl?: number } = ttl === undefined ? {} : { ttl: ttl * 1000 };
      const apnsExpiry: Record<string, string> =
        ttl === undefined
          ? {}
          : { 'apns-expiration': String(Math.floor(Date.now() / 1000) + ttl) };
      // A silent message carries no notification block at all: with one,
      // Android shows the tray entry itself and never hands the payload to
      // the background handler, which is the whole point of sending it.
      // `high` priority is what gets it past Doze; on iOS the background
      // push type and `content-available` are the equivalent, and APNs
      // caps those at priority 5.
      const response = await messaging.sendEachForMulticast(
        message.silent
          ? {
              tokens,
              data: message.data,
              android: { priority: 'high', ...androidTtl },
              apns: {
                headers: {
                  'apns-push-type': 'background',
                  'apns-priority': '5',
                  ...apnsExpiry,
                },
                payload: { aps: { 'content-available': 1 } },
              },
            }
          : {
              tokens,
              notification: { title: message.title ?? '', body: message.body ?? '' },
              data: message.data,
              android: { priority: 'high', ...androidTtl, notification: { channelId: 'vokve.default' } },
              apns: {
                // Spelled out rather than left to the default: an alert at
                // priority 10 is delivered at once instead of being held for
                // a moment the system finds convenient, which for a message
                // about a minute is the whole point.
                headers: {
                  'apns-push-type': 'alert',
                  'apns-priority': '10',
                  ...apnsExpiry,
                },
                payload: { aps: { sound: 'default' } },
              },
            },
      );
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
