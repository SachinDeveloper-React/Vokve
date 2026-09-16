import { logger } from './logger.js';

export interface PushMessage {
  title: string;
  body: string;
  /** Small string map the app reads on tap — the topic, the row id. */
  data: Record<string, string>;
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

export async function sendPush(tokens: string[], message: PushMessage): Promise<PushResult> {
  if (tokens.length === 0) return { sent: 0, invalid: [] };
  if (!transport) {
    logger.debug({ tokens: tokens.length, title: message.title }, 'push.no_provider');
    return { sent: 0, invalid: [] };
  }
  return transport.send(tokens, message);
}
