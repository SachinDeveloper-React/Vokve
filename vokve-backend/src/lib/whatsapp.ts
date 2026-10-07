import { isProduction } from '../config/env.js';
import { logger } from './logger.js';

/**
 * WhatsApp messages to a member's own phone — the order updates they asked
 * for on the shipping page (RULES R17).
 *
 * No provider is wired yet, the same position SMS is in (D-31): outside
 * production a message is logged so the whole flow can be exercised; in
 * production the channel is not deliverable, so the option is not offered
 * at all rather than promised and dropped.
 */
type Transport = (phone: string, text: string) => Promise<void>;

let transport: Transport | null = null;

/** Tests capture what would have been sent. */
export function setWhatsAppTransport(next: Transport | null): void {
  transport = next;
}

export function isWhatsAppDeliverable(): boolean {
  // TODO: a WhatsApp Business provider (Gupshup / Meta Cloud API) and its templates.
  return transport !== null;
}

/** Offered where it can be delivered, and everywhere outside production. */
export function isWhatsAppUsable(): boolean {
  return isWhatsAppDeliverable() || !isProduction;
}

const masked = (phone: string) => `•••${phone.slice(-4)}`;

export async function sendWhatsApp(phone: string, text: string): Promise<void> {
  if (transport) {
    await transport(phone, text);
    return;
  }
  if (!isWhatsAppUsable()) return;
  logger.info({ phone: masked(phone), text, deliverable: false }, 'whatsapp.deliver');
}
