import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time codes (RFC 6238) — the six digits an authenticator app
 * shows, and the operator's second factor on the admin surface (RULES Z7).
 *
 * SHA-1, thirty-second steps and six digits, because that is the profile
 * every authenticator app speaks without being told otherwise; the secret is
 * the strength, not the hash. Written here rather than pulled in as a
 * package: it is thirty lines of HMAC, and a dependency on the login path of
 * the operator's door is a dependency worth not having.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** A fresh 160-bit secret, base32 — the size RFC 4226 recommends. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for one thirty-second step. */
export function totpAt(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function totpCounter(at = Date.now()): number {
  return Math.floor(at / 1000 / STEP_SECONDS);
}

/**
 * Which step the code belongs to, or null. One step either side is allowed
 * for a phone clock a few seconds out; the caller burns the step it returns,
 * so a code read over a shoulder cannot be used a second time.
 */
export function verifyTotp(secret: string, code: string, at = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpCounter(at);
  const offered = Buffer.from(code);
  for (const counter of [now, now - 1, now + 1]) {
    if (timingSafeEqual(Buffer.from(totpAt(secret, counter)), offered)) return counter;
  }
  return null;
}

/** What an authenticator app scans. */
export function totpUri(secret: string, label: string, issuer = 'VOKVE Admin'): string {
  const name = encodeURIComponent(`${issuer}:${label}`);
  return `otpauth://totp/${name}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
