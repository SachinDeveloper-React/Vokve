import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import type { DailyActivity } from '../../contracts/index.js';
import { addDays, isValidTimeZone, localDayOf } from '../../lib/dates.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { sha256Hex, verifyEcdsaSha256 } from '../../lib/signatures.js';
import { DeviceModel } from '../devices/models.js';
import { needsFreshVerdict, playIntegrityProjectNumber, recordPlayIntegrity } from '../integrity/service.js';
import { AuditLogModel } from '../platform/models.js';
import {
  ActivitySampleModel,
  DeviceDayModel,
  IngestNonceModel,
  MotionWindowModel,
  StepSnapshotModel,
  StepUploadModel,
} from './models.js';
import { rollupDay, type DeviceProof } from './rollup.service.js';
import { countingWindow, cutToWindow, type CountingPeriod } from './counting.js';
import { classifyWindow, signedSnapshotSchema, summarise, type SignedSnapshot } from './snapshot.js';

/**
 * `POST /activity/ingest` (BACKEND §7.3): one day of steps, signed on the
 * phone by the Keystore key this device attested. The signature is checked
 * over the exact bytes that were signed and only then is anything in them
 * read — the counts, the sources, the minutes, the motion windows and the
 * raw Health Connect records all arrive inside it, so nothing outside the
 * signature is trusted.
 *
 * Two refusals are answered before the nonce is spent, so the phone can
 * send the same snapshot again: `ATTESTATION_REQUIRED` (no key on file for
 * this device, or a different one) and `INTEGRITY_REQUIRED` (a fresh Play
 * verdict is due). Everything that cannot be fixed by sending again is a 422,
 * which the phone takes as "drop this day".
 */

/** Thirty-two random bytes, base64url, single use, bound to the device that asked. */
export async function issueIngestNonce(userId: string, deviceId: string) {
  const config = await getConfig();
  const nonce = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.integrity.nonceTtlSeconds * 1000);
  await IngestNonceModel.create({ _id: nonce, userId, deviceId, expiresAt });
  return { nonce, expiresAt: expiresAt.toISOString() };
}

export const ingestBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  snapshot: z.object({
    keyId: z.string().regex(/^[0-9a-fA-F]{64}$/),
    algorithm: z.string().max(64),
    value: z.string().min(1).max(512),
    attested: z.boolean(),
    signedPayload: z.string().min(2).max(12 * 1024 * 1024),
    payloadSha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
  }),
  integrity: z
    .union([
      z.object({ token: z.string().min(1).max(8192) }),
      z.object({ error: z.string().min(1).max(200), retryable: z.boolean() }),
    ])
    .optional(),
});
export type IngestBody = z.infer<typeof ingestBody>;

export interface IngestContext {
  userId: string;
  deviceId: string;
  appVersion?: string;
  timezone: string;
}

export interface IngestResponse {
  day: DailyActivity;
  duplicate: boolean;
  coinsHeld: number;
  releaseAfter: string | null;
  streakEarned: boolean;
}

const unreadable = (message: string) => new ApiError(422, 'SNAPSHOT_INVALID', message);
const nonceInvalid = () => Errors.conflict('NONCE_INVALID', 'That sync ran out of time. Trying again.');

export async function ingestSnapshot(ctx: IngestContext, body: IngestBody, now = new Date()): Promise<IngestResponse> {
  const config = await getConfig();
  const { snapshot } = body;
  const payloadSha256 = snapshot.payloadSha256.toLowerCase();

  // The same snapshot again is answered as it was the first time (A10).
  const seen = await StepUploadModel.findOne({ userId: ctx.userId, payloadSha256 }, { response: 1 }).lean();
  if (seen?.response) return { ...(seen.response as IngestResponse), duplicate: true };

  // The hash and the signature are over these bytes, and nothing else.
  if (sha256Hex(snapshot.signedPayload) !== payloadSha256) {
    throw unreadable('That step snapshot was damaged on the way.');
  }

  const device = await DeviceModel.findOne(
    { _id: ctx.deviceId, userId: ctx.userId, revokedAt: null },
    { attestation: 1, playIntegrity: 1, counting: 1 },
  ).lean();
  const key = device?.attestation;
  if (!key?.keyId || !key.publicKey || key.keyId !== snapshot.keyId.toLowerCase()) {
    throw new ApiError(403, 'ATTESTATION_REQUIRED', 'This phone needs to confirm it is genuine before steps can sync.');
  }
  if (!verifyEcdsaSha256(key.publicKey, snapshot.signedPayload, snapshot.value)) {
    // The right key's id over the wrong bytes: tampering, or a bug worth knowing about.
    await AuditLogModel.create({
      actorType: 'system', action: 'ingest.bad_signature', subjectType: 'device', subjectId: ctx.deviceId,
      after: { userId: ctx.userId, keyId: key.keyId, payloadSha256 },
    });
    throw new ApiError(422, 'SNAPSHOT_SIGNATURE_INVALID', 'That step snapshot could not be verified.');
  }

  let parsed: SignedSnapshot;
  try {
    parsed = signedSnapshotSchema.parse(JSON.parse(snapshot.signedPayload));
  } catch {
    throw unreadable('That step snapshot could not be read.');
  }
  if (parsed.date !== body.date) throw unreadable('That step snapshot is for a different day.');

  // Issued here, to this device, and still unspent — checked now, spent below.
  const nonceFilter = { _id: parsed.nonce, userId: ctx.userId, deviceId: ctx.deviceId, expiresAt: { $gt: now } };
  if (!(await IngestNonceModel.exists(nonceFilter))) throw nonceInvalid();

  // The day boundary is the phone's own midnight (A3); a day too old or not
  // yet begun there is refused (A8).
  const zone = isValidTimeZone(parsed.clock.timezone) ? parsed.clock.timezone : ctx.timezone;
  const today = localDayOf(now, zone);
  if (parsed.date > today || parsed.date < addDays(today, -config.activity.maxAgeDays)) {
    throw new ApiError(422, 'SNAPSHOT_DATE_OUT_OF_RANGE', 'That day can no longer be synced.', { date: parsed.date, today });
  }

  const cloudProjectNumber = await playIntegrityProjectNumber();
  if (
    cloudProjectNumber &&
    !body.integrity &&
    needsFreshVerdict(device?.playIntegrity?.checkedAt, config.integrity.playIntegrity.freshHours, now)
  ) {
    throw new ApiError(403, 'INTEGRITY_REQUIRED', 'This phone needs a fresh integrity check.', { cloudProjectNumber });
  }

  // Two requests racing with one nonce: exactly one gets past here.
  if (!(await IngestNonceModel.findOneAndDelete(nonceFilter).lean())) throw nonceInvalid();

  let play: DeviceProof['play'] = device?.playIntegrity?.verdict
    ? { verdict: device.playIntegrity.verdict, reasons: device.playIntegrity.reasons ?? [] }
    : null;
  if (body.integrity) {
    const verdict = await recordPlayIntegrity(ctx.userId, ctx.deviceId, body.integrity, payloadSha256);
    play = { verdict: verdict.verdict, reasons: verdict.reasons };
  }

  const localDay = parsed.date;
  const signedAt = new Date(parsed.signedAt);
  const uploadId = newId('upl');
  await StepUploadModel.create({
    _id: uploadId,
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    localDay,
    payloadSha256,
    keyId: key.keyId,
    signedAt,
    deviceSteps: parsed.deviceSteps,
    recoveredSteps: parsed.recoveredSteps,
    suspectSteps: parsed.suspectSteps,
    resolvedSteps: parsed.resolved.steps,
    integrityVerdict: play?.verdict ?? null,
    appVersion: ctx.appVersion,
    receivedAt: now,
  });

  await storeEvidence(ctx, parsed, {
    uploadId,
    localDay,
    zone,
    counting: device?.counting ?? null,
    signedAt,
    payloadSha256,
    keyId: key.keyId,
    signature: snapshot.value,
    signedPayload: snapshot.signedPayload,
    proof: {
      key: {
        attested: Boolean(key.attested),
        failure: key.failure ?? null,
        verifiedBootState: key.verifiedBootState ?? null,
        deviceLocked: key.deviceLocked ?? null,
      },
      play,
    },
    now,
  });

  const result = await rollupDay(ctx.userId, localDay, now);
  const response: IngestResponse = { ...result, duplicate: false };
  await StepUploadModel.updateOne({ _id: uploadId }, { $set: { response } });
  return response;
}

interface Stored {
  uploadId: string;
  localDay: string;
  /** The phone's own zone, the one its day is counted in. */
  zone: string;
  /** When the account counted on this install (D-56); null where none were kept. */
  counting: CountingPeriod[] | null;
  signedAt: Date;
  payloadSha256: string;
  keyId: string;
  signature: string;
  signedPayload: string;
  proof: DeviceProof;
  now: Date;
}

/**
 * The device-day's evidence and its verbatim snapshot are replaced only by a
 * newer one: a snapshot that arrives late, behind a newer one, still adds
 * its records and windows, and leaves the day as the newer one described it.
 */
async function storeEvidence(ctx: IngestContext, parsed: SignedSnapshot, stored: Stored): Promise<void> {
  const config = await getConfig();
  const dayId = `${ctx.deviceId}:${stored.localDay}`;
  const existing = await DeviceDayModel.findById(dayId, { signedAt: 1, lastRecordModifiedAt: 1, lastWindowStartedAt: 1 }).lean();
  const isNewer = !existing || existing.signedAt.getTime() <= stored.signedAt.getTime();

  const records = (parsed.healthConnectRecords?.records ?? []).filter(
    record => record.lastModifiedTime > (existing?.lastRecordModifiedAt ?? 0),
  );
  await insertNew(
    ActivitySampleModel,
    records.map(record => ({
      _id: `${ctx.userId}:hc:${record.id}:${record.lastModifiedTime}`,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      localDay: stored.localDay,
      provider: 'health_connect',
      sampleId: record.id,
      recordType: record.recordType ?? (record.distanceMeters !== undefined ? 'distance' : 'steps'),
      value: record.count ?? record.distanceMeters ?? 0,
      startTime: new Date(record.startTime),
      endTime: new Date(record.endTime),
      origin: record.packageName,
      recordingMethod: record.recordingMethod,
      device: record.device ?? null,
      lastModifiedAt: record.lastModifiedTime ? new Date(record.lastModifiedTime) : null,
      receivedAt: stored.now,
    })),
  );

  const windows = (parsed.motionWindows ?? []).filter(window => window.startedAt > (existing?.lastWindowStartedAt ?? 0));
  await insertNew(
    MotionWindowModel,
    windows.map(window => ({
      _id: `${ctx.deviceId}:${window.startedAt}`,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      localDay: stored.localDay,
      startedAt: new Date(window.startedAt),
      durationMs: window.durationMs,
      sampleCount: window.sampleCount,
      dominantFrequencyHz: window.dominantFrequencyHz,
      variance: window.variance,
      zeroCrossingRate: window.zeroCrossingRate,
      peakRatio: window.peakRatio,
      stepsDuringWindow: window.stepsDuringWindow,
      class: classifyWindow(window, config.activity.thresholds),
    })),
  );

  // Reduced rather than spread: a day can carry thousands of records.
  const markers = {
    lastRecordModifiedAt: records.reduce((max, record) => Math.max(max, record.lastModifiedTime), 0),
    lastWindowStartedAt: windows.reduce((max, window) => Math.max(max, window.startedAt), 0),
  };

  if (!isNewer) {
    await DeviceDayModel.updateOne({ _id: dayId }, { $max: markers });
    return;
  }

  // Only the steps taken while the account was signed in on this phone are
  // its own (D-56): the day is cut to that time before it is judged.
  const window = countingWindow(stored.counting, stored.localDay, stored.zone);
  const cut = window ? cutToWindow(parsed, window) : null;
  const evidence = summarise(cut?.snapshot ?? parsed, config.activity);
  if (window && cut) evidence.counting = { window, leftOut: cut.leftOut };

  await DeviceDayModel.updateOne(
    { _id: dayId },
    {
      $set: {
        userId: ctx.userId,
        deviceId: ctx.deviceId,
        localDay: stored.localDay,
        uploadId: stored.uploadId,
        signedAt: stored.signedAt,
        evidence,
        proof: stored.proof,
      },
      $max: markers,
    },
    { upsert: true },
  );
  await StepSnapshotModel.replaceOne(
    { _id: dayId },
    {
      _id: dayId,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      localDay: stored.localDay,
      uploadId: stored.uploadId,
      keyId: stored.keyId,
      signature: stored.signature,
      signedPayload: stored.signedPayload,
      payloadSha256: stored.payloadSha256,
      signedAt: stored.signedAt,
      receivedAt: stored.now,
      expiresAt: new Date(stored.now.getTime() + config.activity.rawSnapshotRetentionDays * 86_400_000),
    },
    { upsert: true },
  );
}

/** Inserts what is not there yet; a row already stored is the dedupe working, not an error. */
async function insertNew(
  model: { insertMany(docs: Record<string, unknown>[], options: { ordered: boolean }): Promise<unknown> },
  docs: Record<string, unknown>[],
): Promise<void> {
  if (docs.length === 0) return;
  try {
    await model.insertMany(docs, { ordered: false });
  } catch (err) {
    const writeErrors = (err as { writeErrors?: { code?: number; err?: { code?: number } }[] }).writeErrors;
    const onlyDuplicates =
      (err as { code?: number }).code === 11000 ||
      (Array.isArray(writeErrors) && writeErrors.length > 0 && writeErrors.every(e => (e.code ?? e.err?.code) === 11000));
    if (!onlyDuplicates) throw err;
  }
}
