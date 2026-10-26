import { hasServiceAccount } from '../config/serviceAccount.js';
import { logger } from './logger.js';

export interface PushMessage {
  /** Left out by a silent message: there is nothing to show. */
  title?: string;
  body?: string;
  /** Small string map the app reads on tap — the topic, the row id. */
  data: Record<string, string>;
  /**
   * Data only: no notification block, so the OS shows nothing and wakes the
   * app's background handler instead (RULES A28). What the app does with it
   * is in `data`; a silent message with no `data` would be a no-op that
   * still spent a wake-up, so the type asks for one.
   */
  silent?: boolean;
  /**
   * How long this message is worth delivering, in seconds. Past it the
   * provider drops it instead of holding it for the next time the phone is
   * reachable.
   *
   * Left out, a message lives as long as FCM and APNs will keep it — hours,
   * and a day in FCM's case. That is right for an order update and wrong for
   * anything about a moment: a hydration reminder handed over at midnight
   * for a 19:00 time is not a late reminder, it is a reminder for a time
   * that has gone, arriving next to the one that was actually due.
   */
  ttlSeconds?: number;
}

export interface PushResult {
  sent: number;
  /** Tokens the provider said are dead; the caller retires them. */
  invalid: string[];
}

/** What a push provider has to be able to do. FCM later; a capturing stub in tests. */
export interface PushTransport {
  send(tokens: string[], message: PushMessage): Promise<PushResult>;
}

/**
 * Push delivery, behind the same "no provider means no channel" rule the SMS
 * and email senders follow. Nothing is configured yet — FCM needs a service
 * account this repo does not carry — so every send is logged and counted as
 * not sent. The feed row is written regardless; the notification centre is
 * the channel that always works.
 */
let transport: PushTransport | null = null;

/** Tests swap in a capturing stub; production wires FCM here when it exists. */
export function setPushTransport(next: PushTransport | null): void {
  transport = next;
}

export function isPushConfigured(): boolean {
  return transport !== null;
}

/**
 * Wires FCM when the service account is configured. Called once at boot;
 * a failure to build the transport is logged and leaves the feed-only
 * behaviour, never a crash on start.
 */
export async function configurePushFromEnv(): Promise<boolean> {
  // Nothing configured: do not even load the SDK.
  if (!hasServiceAccount('FIREBASE')) return false;
  try {
    const { createFcmTransport } = await import('./fcm.js');
    const fcm = await createFcmTransport();
    if (fcm) transport = fcm;
    return fcm !== null;
  } catch (err) {
    logger.error({ err }, 'push.fcm_setup_failed');
    return false;
  }
}

export async function sendPush(tokens: string[], message: PushMessage): Promise<PushResult> {
  if (tokens.length === 0) return { sent: 0, invalid: [] };
  if (!transport) {
    logger.debug({ tokens: tokens.length, title: message.title, silent: message.silent === true }, 'push.no_provider');
    return { sent: 0, invalid: [] };
  }
  try {
    return await transport.send(tokens, message);
  } catch (err) {
    // A provider outage is not the caller's problem to handle: the feed row
    // is already written, and the tick will not retry a push that failed.
    logger.error({ err, tokens: tokens.length }, 'push.send_failed');
    return { sent: 0, invalid: [] };
  }
}
