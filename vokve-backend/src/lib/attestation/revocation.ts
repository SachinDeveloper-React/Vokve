import { env } from '../../config/env.js';
import { logger } from '../logger.js';

/** `{ entries: { <serial hex>: { status, reason } } }`, as Google publishes it. */
export type RevocationEntries = Record<string, { status?: string; reason?: string }>;

/** Where the list comes from. Google's endpoint in production; a stub in tests. */
export type RevocationSource = () => Promise<RevocationEntries>;

/** Google asks for at most a daily fetch; an hour keeps a revocation from waiting a day. */
const REFRESH_MS = 60 * 60 * 1000;

function sourceFromEnv(): RevocationSource | null {
  const url = env.ATTESTATION_STATUS_URL.trim();
  if (!url) return null;
  return async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`attestation status ${response.status}`);
    const body = (await response.json()) as { entries?: RevocationEntries };
    return body.entries ?? {};
  };
}

let source: RevocationSource | null = sourceFromEnv();
let cache: { at: number; entries: RevocationEntries } | null = null;

/** Tests swap in a fixed list, or `null` for none. */
export function setRevocationSource(next: RevocationSource | null): void {
  source = next;
  cache = null;
}

/** Google keys the list by the serial in lowercase hex, without leading zeros. */
export function normaliseSerial(serialHex: string): string {
  return BigInt(`0x${serialHex}`).toString(16);
}

/**
 * A lookup into the revocation list, or null when there is no list to look
 * in — not configured, or never fetched successfully. A failed refresh keeps
 * the last good list: a revocation is never forgotten because Google was
 * slow to answer once.
 */
export async function revocationLookup(): Promise<((serialHex: string) => boolean) | null> {
  if (!source) return null;
  if (!cache || Date.now() - cache.at > REFRESH_MS) {
    try {
      cache = { at: Date.now(), entries: await source() };
    } catch (err) {
      logger.warn({ err }, 'attestation.status_unavailable');
      if (!cache) return null;
    }
  }
  const entries = cache.entries;
  return serialHex => Object.prototype.hasOwnProperty.call(entries, normaliseSerial(serialHex));
}
