import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { getConfig } from '../../config/remote.js';
import { GOOGLE_ROOT_KEYS } from '../../lib/attestation/googleRoots.js';
import { verifyKeyAttestation } from '../../lib/attestation/keyAttestation.js';
import { revocationLookup } from '../../lib/attestation/revocation.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { verifyIntegrityToken, type PlayVerdict } from '../../lib/playIntegrity.js';
import { DeviceModel } from '../devices/models.js';
import { AuditLogModel } from '../platform/models.js';
import { AttestationRecordModel } from './models.js';

/**
 * Device integrity (BACKEND §7.5 L0): the Keystore key each install signs
 * its step snapshots with, accepted once against a fresh challenge, and the
 * Play Integrity verdicts its snapshots carry now and then.
 */

/** The roots a key chain must end in. Google's; a test swaps in its own. */
let trustedRoots: ReadonlySet<string> = GOOGLE_ROOT_KEYS;

export function setTrustedAttestationRoots(next: ReadonlySet<string> | null): void {
  trustedRoots = next ?? GOOGLE_ROOT_KEYS;
}

/**
 * A single-use challenge for the next key, bound to the device it was asked
 * for. Thirty-two random bytes, base64url: 43 bytes of ASCII, inside the
 * 1–128 a Keystore challenge may be.
 */
export async function issueAttestationChallenge(userId: string, deviceId: string) {
  const config = await getConfig();
  const challenge = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.integrity.challengeTtlSeconds * 1000);
  const updated = await DeviceModel.updateOne(
    { _id: deviceId, userId, revokedAt: null },
    { $set: { attestationChallenge: { value: challenge, expiresAt } } },
  );
  if (updated.matchedCount === 0) throw Errors.notFound('That device');
  return { challenge, expiresAt: expiresAt.toISOString() };
}

export const attestationBody = z.object({
  keyId: z.string().regex(/^[0-9a-fA-F]{64}$/),
  algorithm: z.string().max(64),
  publicKey: z.string().min(1).max(4096),
  certificateChain: z.array(z.string().min(1).max(16_384)).max(10),
  attested: z.boolean(),
  securityLevel: z.string().max(32),
  createdAt: z.number().nonnegative(),
});
export type AttestationBody = z.infer<typeof attestationBody>;

/**
 * Checks a key against the challenge it was made for and stores it as the
 * one this install signs with. A key whose chain proves nothing — a phone
 * that cannot attest, an emulator — is still stored, as unattested: steps
 * signed by it are scored for what it is. Two cases are refused outright:
 * a key that is not the one described, and a genuine chain made for some
 * other challenge, which can only be a replay.
 */
export async function submitAttestation(userId: string, deviceId: string, body: AttestationBody) {
  const config = await getConfig();
  const now = new Date();

  // Spent first, so a second submission against it fails whatever it carries.
  const device = await DeviceModel.findOneAndUpdate(
    { _id: deviceId, userId, revokedAt: null, 'attestationChallenge.expiresAt': { $gt: now } },
    { $unset: { attestationChallenge: 1 } },
  ).lean();
  const challenge = device?.attestationChallenge?.value;
  if (!device || !challenge) {
    throw Errors.conflict('ATTESTATION_CHALLENGE_INVALID', 'That check ran out of time. Please try again.');
  }

  const result = verifyKeyAttestation(body, {
    challenge,
    packageName: config.integrity.android.packageName || null,
    signingCertSha256: config.integrity.android.signingCertSha256.map(digest => digest.toLowerCase()),
    trustedRoots,
    isRevoked: await revocationLookup(),
    now,
  });
  const keyId = body.keyId.toLowerCase();

  await AttestationRecordModel.create({
    _id: newId('att'),
    userId,
    deviceId,
    provider: 'key_attestation',
    verdict: result.attested ? 'attested' : result.acceptable ? 'unattested' : 'refused',
    details: {
      keyId,
      failure: result.failure,
      securityLevel: result.securityLevel,
      verifiedBootState: result.verifiedBootState,
      deviceLocked: result.deviceLocked,
      attestationVersion: result.attestationVersion,
      packageNames: result.packageNames,
      revocationChecked: result.revocationChecked,
      chainLength: body.certificateChain.length,
      clientSaidAttested: body.attested,
    },
    checkedAt: now,
  });

  if (!result.acceptable) {
    logger.warn({ userId, deviceId, failure: result.failure }, 'attestation.refused');
    throw new ApiError(422, 'ATTESTATION_INVALID', 'This phone could not be verified. Please try again.', {
      failure: result.failure,
    });
  }

  await DeviceModel.updateOne(
    { _id: deviceId, userId },
    {
      $set: {
        attestation: {
          keyId,
          publicKey: body.publicKey,
          algorithm: body.algorithm,
          attested: result.attested,
          failure: result.failure,
          securityLevel: result.securityLevel,
          verifiedBootState: result.verifiedBootState,
          deviceLocked: result.deviceLocked,
          attestationVersion: result.attestationVersion,
          packageNames: result.packageNames,
          signatureDigests: result.signatureDigests,
          revocationChecked: result.revocationChecked,
          verifiedAt: now,
        },
      },
    },
  );

  // A Keystore key never leaves its phone, and the app attests afresh for
  // every account: the same key on two accounts is a forged submission
  // (RULES A18). Recorded here; the day scoring flags it.
  const shared = await DeviceModel.countDocuments({ 'attestation.keyId': keyId, userId: { $ne: userId } });
  if (shared > 0) {
    await AuditLogModel.create({
      actorType: 'system', action: 'attestation.key_shared', subjectType: 'user', subjectId: userId, deviceId,
      after: { keyId, accounts: shared + 1 },
    });
  }

  return { keyId, attested: result.attested, securityLevel: result.securityLevel };
}

/** The Cloud project tokens are requested for, or null when Play Integrity is not in use. */
export async function playIntegrityProjectNumber(): Promise<number | null> {
  const config = await getConfig();
  return env.PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER ?? config.integrity.playIntegrity.cloudProjectNumber ?? null;
}

/** Whether a device's last verdict is too old to stand for another snapshot. */
export function needsFreshVerdict(checkedAt: Date | null | undefined, freshHours: number, now: Date): boolean {
  return !checkedAt || now.getTime() - new Date(checkedAt).getTime() > freshHours * 3_600_000;
}

/** What a snapshot's sender said about Play Integrity: a token, or why there is none. */
export type IngestIntegrity = { token: string } | { error: string; retryable: boolean };

/**
 * Judges what a snapshot brought and records it as the device's latest
 * verdict, with a row of history. Never throws: no verdict is a verdict.
 */
export async function recordPlayIntegrity(
  userId: string,
  deviceId: string,
  integrity: IngestIntegrity,
  requestHash: string,
): Promise<PlayVerdict> {
  const config = await getConfig();
  const now = new Date();
  const verdict: PlayVerdict =
    'token' in integrity
      ? await verifyIntegrityToken(integrity.token, {
          packageName: config.integrity.android.packageName,
          requestHash,
          maxAgeMinutes: config.integrity.playIntegrity.maxTokenAgeMinutes,
          now,
        })
      : {
          verdict: 'unavailable',
          reasons: [integrity.error, ...(integrity.retryable ? ['retryable'] : [])],
          deviceRecognition: [],
          appRecognition: null,
          licensing: null,
        };

  await DeviceModel.updateOne(
    { _id: deviceId, userId },
    { $set: { playIntegrity: { ...verdict, checkedAt: now } } },
  );
  await AttestationRecordModel.create({
    _id: newId('att'), userId, deviceId, provider: 'play_integrity', verdict: verdict.verdict,
    details: { reasons: verdict.reasons, deviceRecognition: verdict.deviceRecognition,
      appRecognition: verdict.appRecognition, licensing: verdict.licensing, requestHash },
    checkedAt: now,
  });
  return verdict;
}
