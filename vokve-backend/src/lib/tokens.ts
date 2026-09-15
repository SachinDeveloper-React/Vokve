import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessClaims {
  sub: string;
  tier: string;
}

export function signAccessToken(claims: AccessClaims): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + env.ACCESS_TOKEN_TTL_SECONDS * 1000;
  const token = jwt.sign(claims, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'vokve',
  });
  return { token, expiresAt };
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { issuer: 'vokve' });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') return null;
    return { sub: payload.sub, tier: String((payload as Record<string, unknown>).tier ?? 'normal') };
  } catch {
    return null;
  }
}

/** Opaque refresh tokens: random, stored hashed (RULES Z1). */
export function newRefreshToken(): { token: string; hash: string } {
  const token = `rt_${crypto.randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
