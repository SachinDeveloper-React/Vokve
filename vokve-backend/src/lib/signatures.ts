import { createHash, createPublicKey, verify } from 'node:crypto';

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Whether `signature` (base64 DER ECDSA, SHA-256) was made over the UTF-8
 * bytes of `data` by the key whose SubjectPublicKeyInfo is `spkiBase64` —
 * the `SHA256withECDSA` a Keystore key signs with. Anything malformed is a
 * plain `false`: a signature that cannot be read did not verify.
 */
export function verifyEcdsaSha256(spkiBase64: string, data: string, signature: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });
    return verify('sha256', Buffer.from(data, 'utf8'), { key, dsaEncoding: 'der' }, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
