import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Authenticator secrets, encrypted at rest (AES-256-GCM).
 *
 * A TOTP secret is a second password that cannot be hashed — the server has
 * to compute codes from it — so a copy of the database would otherwise be a
 * copy of every second factor. The key is derived from `JWT_SECRET`; during
 * a rotation the previous secret still decrypts, and `needsReseal` tells the
 * caller to write the value back under the new one.
 */

const keyOf = (secret: string) => createHash('sha256').update(`vokve-staff-totp:${secret}`).digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(env.JWT_SECRET), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

function openWith(sealed: string, secret: string): string | null {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function open(sealed: string): { plain: string; needsReseal: boolean } | null {
  const current = openWith(sealed, env.JWT_SECRET);
  if (current !== null) return { plain: current, needsReseal: false };
  if (env.JWT_SECRET_PREVIOUS) {
    const previous = openWith(sealed, env.JWT_SECRET_PREVIOUS);
    if (previous !== null) return { plain: previous, needsReseal: true };
  }
  return null;
}
