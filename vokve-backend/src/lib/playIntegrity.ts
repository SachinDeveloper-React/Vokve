import fs from 'node:fs';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Play Integrity (standard requests): what only Google can say about a
 * device — that this exact build is the one Play distributed, and that the
 * phone passes its device checks. The app asks for a token bound to a signed
 * step snapshot's hash when the server wants a fresh verdict; the server
 * decodes it with Google and judges it here.
 */

/** `tokenPayloadExternal`, the parts judged. */
export interface IntegrityTokenPayload {
  requestDetails?: { requestPackageName?: string; requestHash?: string; timestampMillis?: string | number };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string; certificateSha256Digest?: string[]; versionCode?: string };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
  accountDetails?: { appLicensingVerdict?: string };
}

/** Decodes a token with Google. Built from the service account at boot; a stub in tests. */
export interface PlayIntegrityDecoder {
  decode(token: string, packageName: string): Promise<IntegrityTokenPayload>;
}

/**
 * - `pass`: Google vouches for the app and the device, for this snapshot.
 * - `fail`: Google answered, and something it said is wrong (`reasons`).
 * - `unavailable`: the phone could not get a token — no Play Store, an old
 *   Play services, a sideloaded build. What Play said is in `reasons`.
 * - `unverifiable`: a token arrived and this server has no way to decode it.
 * - `error`: decoding failed on Google's side or the network's.
 */
export type PlayVerdictName = 'pass' | 'fail' | 'unavailable' | 'unverifiable' | 'error';

export interface PlayVerdict {
  verdict: PlayVerdictName;
  reasons: string[];
  deviceRecognition: string[];
  appRecognition: string | null;
  licensing: string | null;
}

let decoder: PlayIntegrityDecoder | null = null;

export function setPlayIntegrityDecoder(next: PlayIntegrityDecoder | null): void {
  decoder = next;
}

/**
 * Builds the decoder from `PLAY_INTEGRITY_SERVICE_ACCOUNT` when it is set.
 * Called once at boot; a failure is logged and leaves tokens unverifiable,
 * never a crash on start.
 */
export async function configurePlayIntegrityFromEnv(): Promise<boolean> {
  const raw = env.PLAY_INTEGRITY_SERVICE_ACCOUNT;
  if (!raw) return false;
  try {
    const json = raw.trim().startsWith('{') ? raw : fs.readFileSync(raw, 'utf8');
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      credentials: JSON.parse(json),
      scopes: ['https://www.googleapis.com/auth/playintegrity'],
    });
    const client = await auth.getClient();
    decoder = {
      async decode(token, packageName) {
        const response = await client.request<{ tokenPayloadExternal?: IntegrityTokenPayload }>({
          url: `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
          method: 'POST',
          data: { integrityToken: token },
          timeout: 10_000,
        });
        return response.data.tokenPayloadExternal ?? {};
      },
    };
    logger.info('play_integrity.ready');
    return true;
  } catch (err) {
    logger.error({ err }, 'play_integrity.setup_failed');
    return false;
  }
}

export interface IntegrityExpectations {
  packageName: string;
  /** The snapshot's `payloadSha256` the token must be bound to. */
  requestHash: string;
  maxAgeMinutes: number;
  now: Date;
}

/** Judges a decoded token against what this request needs it to say. */
export function judgeIntegrity(payload: IntegrityTokenPayload, expect: IntegrityExpectations): PlayVerdict {
  const reasons: string[] = [];
  const request = payload.requestDetails ?? {};
  if (request.requestPackageName !== expect.packageName) reasons.push('wrong_package');
  if (request.requestHash !== expect.requestHash) reasons.push('request_hash_mismatch');
  const issuedAt = Number(request.timestampMillis ?? 0);
  if (!issuedAt || expect.now.getTime() - issuedAt > expect.maxAgeMinutes * 60_000) reasons.push('stale_token');

  const appRecognition = payload.appIntegrity?.appRecognitionVerdict ?? null;
  if (appRecognition !== 'PLAY_RECOGNIZED') reasons.push('app_not_recognized');

  const deviceRecognition = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  // Strong integrity is device integrity and more; basic alone is not enough.
  if (!deviceRecognition.includes('MEETS_DEVICE_INTEGRITY') && !deviceRecognition.includes('MEETS_STRONG_INTEGRITY')) {
    reasons.push('device_integrity');
  }

  const licensing = payload.accountDetails?.appLicensingVerdict ?? null;
  // An unlicensed install — sideloaded, not bought from Play — is evidence,
  // not a failure on its own: the app is free.
  if (licensing === 'UNLICENSED') reasons.push('unlicensed');

  const failed = reasons.some(reason => reason !== 'unlicensed');
  return { verdict: failed ? 'fail' : 'pass', reasons, deviceRecognition, appRecognition, licensing };
}

/** Decodes and judges a token; never throws — a failure is a verdict too. */
export async function verifyIntegrityToken(token: string, expect: IntegrityExpectations): Promise<PlayVerdict> {
  const empty = { deviceRecognition: [], appRecognition: null, licensing: null };
  if (!decoder) return { verdict: 'unverifiable', reasons: ['no_decoder'], ...empty };
  try {
    return judgeIntegrity(await decoder.decode(token, expect.packageName), expect);
  } catch (err) {
    logger.warn({ err }, 'play_integrity.decode_failed');
    return { verdict: 'error', reasons: ['decode_failed'], ...empty };
  }
}
