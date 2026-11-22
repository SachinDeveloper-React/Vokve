import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { getConfig } from '../../config/remote.js';
import { GOOGLE_ROOT_KEYS } from '../../lib/attestation/googleRoots.js';
import { AppAttestError, verifyAppAttestation } from '../../lib/attestation/appAttest.js';
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

/** The root an App Attest chain must end in: Apple's, unless a test swaps in its own (PEM). */
let appAttestRoot: string | undefined;

export function setAppAttestRoot(pem: string | null): void {
  appAttestRoot = pem ?? undefined;
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
  /**
   * iOS (react-native-step-tracker-pro-ios): App Attest's attestation, whose
   * client data binds the challenge to this key. Null or absent from an
   * iPhone that cannot attest (a simulator); never sent by Android.
   */
  appAttest: z
    .object({
      keyId: z.string().min(1).max(128),
      attestationObject: z.string().min(1).max(32_768),
      clientData: z.string().min(1).max(512),
      environment: z.enum(['development', 'production']),
    })
    .nullish(),
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

  if (body.appAttest || device.platform === 'ios') {
    return submitAppAttestation(userId, deviceId, body, challenge, config, now);
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
          provider: 'key_attestation',
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

/**
 * An iPhone's key (react-native-step-tracker-pro-ios): a Secure Enclave key
 * App Attest vouched for. The same three outcomes as Android's chain:
 * attested; kept as unattested (a phone that cannot attest, or a server not
 * told the team id); refused — a forged or replayed attestation.
 */
async function submitAppAttestation(
  userId: string,
  deviceId: string,
  body: AttestationBody,
  challenge: string,
  config: Awaited<ReturnType<typeof getConfig>>,
  now: Date,
) {
  const keyId = body.keyId.toLowerCase();
  // The key itself first, as on Android: its id is its hash.
  if (createHash('sha256').update(Buffer.from(body.publicKey, 'base64')).digest('hex') !== keyId) {
    await recordAppAttest(userId, deviceId, 'refused', { keyId, failure: 'key_mismatch' }, now);
    throw new ApiError(422, 'ATTESTATION_INVALID', 'This phone could not be verified. Please try again.', { failure: 'key_mismatch' });
  }

  const ios = config.integrity.ios;
  const teamId = env.APPLE_TEAM_ID ?? ios.teamId;
  let failure: string | null = null;
  let appAttest: { keyId: string; credentialPublicKey: string; environment: string; counter: number } | undefined;

  if (!body.appAttest) {
    failure = 'app_attest_unavailable';
  } else if (!teamId) {
    failure = 'app_attest_not_configured';
  } else {
    const environments = env.NODE_ENV === 'production'
      ? ios.environments
      : [...new Set([...ios.environments, 'development' as const])];
    try {
      const verified = verifyAppAttestation(
        {
          attestationObject: body.appAttest.attestationObject,
          keyId: body.appAttest.keyId,
          clientData: body.appAttest.clientData,
          signingPublicKey: body.publicKey,
        },
        { challenge, teamId, bundleId: ios.bundleId, environments, now, rootPem: appAttestRoot },
      );
      appAttest = {
        keyId: body.appAttest.keyId,
        credentialPublicKey: verified.credentialPublicKey,
        environment: verified.environment,
        counter: 0,
      };
    } catch (error) {
      const reason = error instanceof AppAttestError ? error.failure : 'malformed';
      await recordAppAttest(userId, deviceId, 'refused', { keyId, failure: reason }, now);
      logger.warn({ userId, deviceId, failure: reason, message: (error as Error).message }, 'attestation.app_attest_refused');
      throw new ApiError(422, 'ATTESTATION_INVALID', 'This phone could not be verified. Please try again.', { failure: reason });
    }
  }

  const attested = appAttest !== undefined;
  await recordAppAttest(userId, deviceId, attested ? 'attested' : 'unattested', {
    keyId, failure, environment: appAttest?.environment ?? null, clientSaidAttested: body.attested,
  }, now);

  await DeviceModel.updateOne(
    { _id: deviceId, userId },
    {
      $set: {
        attestation: {
          keyId,
          publicKey: body.publicKey,
          algorithm: body.algorithm,
          attested,
          failure,
          securityLevel: body.securityLevel,
          provider: 'app_attest',
          appAttest,
          verifiedAt: now,
        },
      },
    },
  );

  // A Secure Enclave key never leaves its phone: on two accounts it is forged (A18).
  const shared = await DeviceModel.countDocuments({ 'attestation.keyId': keyId, userId: { $ne: userId } });
  if (shared > 0) {
    await AuditLogModel.create({
      actorType: 'system', action: 'attestation.key_shared', subjectType: 'user', subjectId: userId, deviceId,
      after: { keyId, accounts: shared + 1 },
    });
  }

  return { keyId, attested, securityLevel: body.securityLevel };
}

async function recordAppAttest(
  userId: string,
  deviceId: string,
  verdict: 'attested' | 'unattested' | 'refused',
  details: Record<string, unknown>,
  now: Date,
) {
  await AttestationRecordModel.create({
    _id: newId('att'), userId, deviceId, provider: 'app_attest', verdict, details, checkedAt: now,
  });
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
