import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { invalidateConfig } from '../src/config/remote.js';
import { localDayOf, addDays } from '../src/lib/dates.js';
import { setPlayIntegrityDecoder, type IntegrityTokenPayload } from '../src/lib/playIntegrity.js';
import {
  ActivityDailyModel,
  ActivitySampleModel,
  DeviceDayModel,
  IngestNonceModel,
  MotionWindowModel,
  StepSnapshotModel,
  StepUploadModel,
} from '../src/modules/activity/models.js';
import { DeviceModel } from '../src/modules/devices/models.js';
import { CoinBalanceModel, CoinHoldModel, CoinLedgerModel } from '../src/modules/economy/models.js';
import { releaseDueHolds } from '../src/modules/economy/holds.service.js';
import { FraudFlagModel } from '../src/modules/integrity/models.js';
import { setTrustedAttestationRoots } from '../src/modules/integrity/service.js';
import { AppConfigModel, AuditLogModel } from '../src/modules/platform/models.js';
import { attestKey, makeCa, signSnapshot, snapshotPayload, type DayShape, type TestCa, type TestKey } from './attestation.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

let ca: TestCa;

beforeAll(() => {
  ca = makeCa();
});

afterEach(() => {
  setTrustedAttestationRoots(null);
  setPlayIntegrityDecoder(null);
});

const today = () => localDayOf(new Date(), 'Asia/Kolkata');

async function setConfig(key: string, value: Record<string, unknown>) {
  await AppConfigModel.updateOne({ _id: key }, { $set: { value } }, { upsert: true });
  invalidateConfig();
}

/** A signed-up user whose phone has attested a key through the real routes. */
async function attested(session?: Session): Promise<{ session: Session; key: TestKey }> {
  setTrustedAttestationRoots(new Set([ca.rootSpkiSha256]));
  const s = session ?? (await signUpAndRegister());
  const issued = await request(app).post(`/v1/devices/${s.deviceId}/attestation/challenge`).set(authed(s));
  const key = attestKey(ca, { challenge: issued.body.challenge });
  const res = await request(app).post(`/v1/devices/${s.deviceId}/attestation`).set(authed(s)).send(key.attestation);
  if (res.status !== 200) throw new Error(`attestation failed: ${JSON.stringify(res.body)}`);
  return { session: s, key };
}

async function nonceFor(session: Session): Promise<string> {
  const res = await request(app).post('/v1/activity/ingest/nonce').set(authed(session));
  if (res.status !== 200) throw new Error(`nonce failed: ${JSON.stringify(res.body)}`);
  return res.body.nonce;
}

type Shape = Omit<DayShape, 'nonce' | 'date'> & { date?: string; nonce?: string };

async function snapshotFor(session: Session, key: TestKey, shape: Shape) {
  const date = shape.date ?? today();
  const nonce = shape.nonce ?? (await nonceFor(session));
  return { date, snapshot: signSnapshot(key, snapshotPayload({ ...shape, date, nonce })) };
}

function post(session: Session, body: Record<string, unknown>) {
  return request(app).post('/v1/activity/ingest').set({ ...authed(session), 'idempotency-key': randomUUID() }).send(body);
}

const passingToken = (requestHash: string): IntegrityTokenPayload => ({
  requestDetails: { requestPackageName: 'com.vokve', requestHash, timestampMillis: String(Date.now()) },
  appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: 'com.vokve' },
  deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
  accountDetails: { appLicensingVerdict: 'LICENSED' },
});

describe('step ingest: signed snapshots (BACKEND §7.3)', () => {
  it('hands out single-use nonces bound to the device that asked', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).post('/v1/activity/ingest/nonce').set(authed(session));
    expect(res.status).toBe(200);
    expect(res.body.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await IngestNonceModel.findById(res.body.nonce).lean()).toMatchObject({ userId: session.userId, deviceId: session.deviceId });
  });

  it('verifies, stores and scores a day — the phone’s own count, less what it recovered or flagged, is what verifies', async () => {
    const { session, key } = await attested();
    const body = await snapshotFor(session, key, { deviceSteps: 6400, recoveredSteps: 200, suspectSteps: 100 });

    const res = await post(session, body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      duplicate: false,
      coinsHeld: 0,
      releaseAfter: null,
      day: { date: body.date, steps: 6400, verifiedSteps: 6100, source: 'device', verified: true },
    });
    expect(res.body.day.activeMinutes).toBe(64);
    expect(res.body.day.distanceKm).toBeGreaterThan(4);

    const daily = await ActivityDailyModel.findById(`${session.userId}:${body.date}`).lean();
    expect(daily).toMatchObject({ pedometerSteps: 6400, deviceCount: 1, hardRejects: [] });
    expect(daily?.plausibility).toBeGreaterThanOrEqual(50);
    expect(daily?.layers).toMatchObject({ L0: 100, L6: 100 });
    expect(daily?.hourly?.[9]).toBe(6000);

    expect(await StepUploadModel.countDocuments({ userId: session.userId })).toBe(1);
    const stored = await StepSnapshotModel.findById(`${session.deviceId}:${body.date}`).lean();
    expect(stored?.signedPayload).toBe(body.snapshot.signedPayload);
    expect(await DeviceDayModel.countDocuments({ userId: session.userId })).toBe(1);
    expect(await IngestNonceModel.countDocuments({ userId: session.userId })).toBe(0);
  });

  it('answers the same snapshot again as it did the first time, and refuses a spent nonce', async () => {
    const { session, key } = await attested();
    const body = await snapshotFor(session, key, { deviceSteps: 3000 });
    const first = await post(session, body);
    const again = await post(session, body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, day: first.body.day });

    const replay = await snapshotFor(session, key, { deviceSteps: 9000, nonce: JSON.parse(body.snapshot.signedPayload).nonce });
    const refused = await post(session, replay);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('NONCE_INVALID');
  });

  it('asks a device with no key on file to attest, before the nonce is spent', async () => {
    const session = await signUpAndRegister();
    const unknownKey = attestKey(ca, { challenge: 'never-issued' });
    const body = await snapshotFor(session, unknownKey, { deviceSteps: 2000 });

    const refused = await post(session, body);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('ATTESTATION_REQUIRED');
    expect(await IngestNonceModel.countDocuments({ userId: session.userId })).toBe(1);

    // Once the key is on file, the very same snapshot goes through.
    await DeviceModel.updateOne({ _id: session.deviceId }, {
      $set: { attestation: { keyId: unknownKey.attestation.keyId, publicKey: unknownKey.attestation.publicKey, attested: true, verifiedBootState: 'verified', deviceLocked: true } },
    });
    expect((await post(session, body)).status).toBe(200);
  });

  it('refuses what cannot be fixed by sending again, as 422s the phone drops', async () => {
    const { session, key } = await attested();

    const forged = await snapshotFor(session, key, { deviceSteps: 2000 });
    const tampered = forged.snapshot.signedPayload.replace('"deviceSteps":2000', '"deviceSteps":20000');
    const forgedRes = await post(session, {
      ...forged,
      snapshot: { ...forged.snapshot, signedPayload: tampered, payloadSha256: createHash('sha256').update(tampered).digest('hex') },
    });
    expect(forgedRes.status).toBe(422);
    expect(forgedRes.body.error.code).toBe('SNAPSHOT_SIGNATURE_INVALID');
    expect(await AuditLogModel.countDocuments({ action: 'ingest.bad_signature', subjectId: session.deviceId })).toBe(1);

    const damaged = await snapshotFor(session, key, { deviceSteps: 2000 });
    const damagedRes = await post(session, { ...damaged, snapshot: { ...damaged.snapshot, payloadSha256: 'a'.repeat(64) } });
    expect(damagedRes.body.error.code).toBe('SNAPSHOT_INVALID');

    const old = await snapshotFor(session, key, { deviceSteps: 2000, date: addDays(today(), -8) });
    const oldRes = await post(session, old);
    expect(oldRes.status).toBe(422);
    expect(oldRes.body.error.code).toBe('SNAPSHOT_DATE_OUT_OF_RANGE');

    const future = await snapshotFor(session, key, { deviceSteps: 2000, date: addDays(today(), 1) });
    expect((await post(session, future)).body.error.code).toBe('SNAPSHOT_DATE_OUT_OF_RANGE');
  });

  it('asks for a Play Integrity verdict when one is due, takes the same snapshot with a token, and records it', async () => {
    await setConfig('integrity', { playIntegrity: { cloudProjectNumber: 42 } });
    let lastHash = '';
    setPlayIntegrityDecoder({ decode: async () => passingToken(lastHash) });
    const { session, key } = await attested();
    const body = await snapshotFor(session, key, { deviceSteps: 4000 });
    lastHash = body.snapshot.payloadSha256;

    const asked = await post(session, body);
    expect(asked.status).toBe(403);
    expect(asked.body.error).toMatchObject({ code: 'INTEGRITY_REQUIRED', details: { cloudProjectNumber: 42 } });

    const res = await post(session, { ...body, integrity: { token: 'play-token' } });
    expect(res.status).toBe(200);
    expect(res.body.day.verified).toBe(true);
    expect((await DeviceModel.findById(session.deviceId).lean())?.playIntegrity).toMatchObject({ verdict: 'pass' });

    // The verdict stands for a while: the next snapshot needs no token.
    const next = await snapshotFor(session, key, { deviceSteps: 4500 });
    expect((await post(session, next)).status).toBe(200);
  });

  it('a device Play does not vouch for makes the day unverified', async () => {
    await setConfig('integrity', { playIntegrity: { cloudProjectNumber: 42 } });
    let hash = '';
    setPlayIntegrityDecoder({ decode: async () => ({ ...passingToken(hash), deviceIntegrity: { deviceRecognitionVerdict: [] } }) });
    const { session, key } = await attested();
    const body = await snapshotFor(session, key, { deviceSteps: 5000 });
    hash = body.snapshot.payloadSha256;

    const res = await post(session, { ...body, integrity: { token: 'play-token' } });
    expect(res.status).toBe(200);
    expect(res.body.day).toMatchObject({ verified: false, verifiedSteps: 0, steps: 5000 });
    expect(await FraudFlagModel.findOne({ userId: session.userId, kind: 'play_integrity_failed' }).lean())
      .toMatchObject({ severity: 'hard', layer: 'L0' });
  });

  it('a phone that cannot get a token still syncs; why is on the record', async () => {
    await setConfig('integrity', { playIntegrity: { cloudProjectNumber: 42 } });
    const { session, key } = await attested();
    const body = await snapshotFor(session, key, { deviceSteps: 3000 });
    const res = await post(session, { ...body, integrity: { error: 'PLAY_STORE_NOT_FOUND', retryable: false } });
    expect(res.status).toBe(200);
    expect(res.body.day.verified).toBe(true);
    expect((await DeviceModel.findById(session.deviceId).lean())?.playIntegrity).toMatchObject({ verdict: 'unavailable', reasons: ['PLAY_STORE_NOT_FOUND'] });
  });
});

describe('step ingest: the fraud layers (RULES A14–A20, shadow mode)', () => {
  const watch = (steps: number, manualSteps = 0) => ({
    packageName: 'com.fitbit.FitbitMobile', appName: 'Fitbit', kind: 'watch', steps, distance: steps * 0.75, calories: 0,
    lastRecordAt: Date.now(), isSelf: false, isWearable: true, trustedWearable: true, isPlatform: false, manualSteps,
    unknownMethodSteps: 0, recordingMethods: { active: 0, automatic: steps - manualSteps, manual: manualSteps, unknown: 0 },
    lateWrittenSteps: 0, hourlySteps: [], activeCalories: -1, distanceSource: 'health_connect',
  });

  it('an allowlisted watch that counted more answers for the day — typed-in steps excluded, never added to the phone', async () => {
    const { session, key } = await attested();
    const body = await snapshotFor(session, key, { deviceSteps: 7000, sources: [watch(9000, 1000)] });
    const res = await post(session, body);
    expect(res.body.day).toMatchObject({ verifiedSteps: 8000, source: 'health_connect', verified: true });
    expect(await FraudFlagModel.exists({ userId: session.userId, kind: 'manual_entries' })).not.toBeNull();
  });

  it('a source far above the phone does not count (A15): the day falls back on the phone', async () => {
    const { session, key } = await attested();
    const body = await snapshotFor(session, key, { deviceSteps: 5000, sources: [watch(20_000)] });
    const res = await post(session, body);
    expect(res.body.day).toMatchObject({ verifiedSteps: 5000, source: 'device' });
    expect(await FraudFlagModel.findOne({ userId: session.userId, kind: 'pedometer_mismatch' }).lean())
      .toMatchObject({ layer: 'L3', details: { hard: true } });
  });

  it('a shaken phone and an emulator are hard rejects', async () => {
    const shaken = await attested();
    const shakeBody = await snapshotFor(shaken.session, shaken.key, {
      deviceSteps: 8000, windows: [{ hz: 4.2, variance: 30, steps: 200 }, { hz: 4.5, variance: 28, steps: 210 }, { hz: 1.9, variance: 4, steps: 170 }],
    });
    const shakeRes = await post(shaken.session, shakeBody);
    expect(shakeRes.body.day).toMatchObject({ verified: false, verifiedSteps: 0 });
    expect((await ActivityDailyModel.findById(`${shaken.session.userId}:${shakeBody.date}`).lean())?.hardRejects).toContain('motion_non_walk');

    const emulator = await attested();
    const emuBody = await snapshotFor(emulator.session, emulator.key, { deviceSteps: 8000, emulator: true });
    expect((await post(emulator.session, emuBody)).body.day.verified).toBe(false);
  });

  it('two phones: the day is the better one’s, never the sum', async () => {
    const first = await attested();
    const second = await request(app).post('/v1/devices/register').set(authed(first.session))
      .send({ installId: `second-${Date.now()}`, platform: 'android', profile: { model: 'Pixel 7', app: { version: '1.0.0', build: '1' } } });
    const other = await attested({ ...first.session, deviceId: second.body.deviceId });

    await post(first.session, await snapshotFor(first.session, first.key, { deviceSteps: 6000 }));
    const res = await post(other.session, await snapshotFor(other.session, other.key, { deviceSteps: 4000 }));
    expect(res.body.day).toMatchObject({ steps: 6000, verifiedSteps: 6000 });
    expect((await ActivityDailyModel.findById(`${first.session.userId}:${today()}`).lean())?.deviceCount).toBe(2);
  });

  it('keeps raw Health Connect records and motion windows once each, adding only what is new', async () => {
    const { session, key } = await attested();
    const record = (id: string, modified: number) => ({
      id, clientRecordId: null, clientRecordVersion: 0, packageName: 'com.fitbit.FitbitMobile', recordingMethod: 'automatic',
      device: { type: 'watch', manufacturer: 'Google', model: 'Pixel Watch' }, startTime: Date.now() - 3_600_000, endTime: Date.now() - 3_000_000,
      startZoneOffsetSeconds: 19800, endZoneOffsetSeconds: 19800, lastModifiedTime: modified, recordType: 'steps', count: 800,
    });
    await post(session, await snapshotFor(session, key, { deviceSteps: 3000, records: [record('r1', 1000), record('r2', 2000)] }));
    await post(session, await snapshotFor(session, key, { deviceSteps: 3200, records: [record('r1', 1000), record('r2', 2000), record('r3', 3000)] }));

    expect(await ActivitySampleModel.countDocuments({ userId: session.userId })).toBe(3);
    expect(await MotionWindowModel.countDocuments({ userId: session.userId })).toBe(2);
    expect(await MotionWindowModel.findOne({ userId: session.userId }).lean()).toMatchObject({ class: 'walk' });
    expect(await StepUploadModel.countDocuments({ userId: session.userId })).toBe(2);
  });
});

describe('step coins (Phase 2: off; RULES E15)', () => {
  it('a scored day mints nothing while step coins are off', async () => {
    const { session, key } = await attested();
    const res = await post(session, await snapshotFor(session, key, { deviceSteps: 12_000 }));
    expect(res.body).toMatchObject({ coinsHeld: 0, releaseAfter: null });
    expect(await CoinHoldModel.countDocuments({ userId: session.userId })).toBe(0);
  });

  it('switched on, a verified day is held, and the hourly job pays it out once its window has passed', async () => {
    await setConfig('coins', { steps: { enabled: true } });
    const { session, key } = await attested();
    const res = await post(session, await snapshotFor(session, key, { deviceSteps: 12_000 }));
    expect(res.body.coinsHeld).toBeCloseTo(11.4, 5);
    expect(new Date(res.body.releaseAfter).getTime()).toBeGreaterThan(Date.now() + 71 * 3_600_000);

    const early = await releaseDueHolds(new Date());
    expect(early.released).toBe(0);
    const due = await releaseDueHolds(new Date(Date.now() + 73 * 3_600_000));
    expect(due).toMatchObject({ released: 1, voided: 0 });
    // The step coins, released; the day's challenge bonuses are their own rows.
    const steps = await CoinLedgerModel.find({ userId: session.userId, source: 'steps' }).lean();
    expect(steps.reduce((total, row) => total + row.amountMc, 0)).toBe(11_400);
    expect((await CoinBalanceModel.findById(session.userId).lean())?.pendingMc).toBe(0);
  });

  it('out of shadow mode, a hold whose day has since been found wanting is voided', async () => {
    await setConfig('coins', { steps: { enabled: true } });
    await setConfig('trust', { shadow: false });
    const { session, key } = await attested();
    await post(session, await snapshotFor(session, key, { deviceSteps: 10_000 }));
    expect(await CoinHoldModel.countDocuments({ userId: session.userId, status: 'held' })).toBe(1);

    // A later snapshot of the same day comes from an emulator.
    await post(session, await snapshotFor(session, key, { deviceSteps: 10_500, emulator: true }));
    const result = await releaseDueHolds(new Date(Date.now() + 8 * 24 * 3_600_000));
    expect(result).toMatchObject({ released: 0, voided: 1 });
    expect(await CoinHoldModel.findOne({ userId: session.userId }).lean()).toMatchObject({ status: 'voided', reason: 'day_unverified' });
    expect(await CoinLedgerModel.countDocuments({ userId: session.userId, source: 'steps' })).toBe(0);
    expect((await CoinBalanceModel.findById(session.userId).lean())?.pendingMc).toBe(0);
  });
});

describe('step coins: a flag that arrives after the hold', () => {
  it('voids the hold when another of the user’s phones turns out to be an emulator, though the day itself stays verified', async () => {
    await setConfig('coins', { steps: { enabled: true } });
    await setConfig('trust', { shadow: false });
    const first = await attested();
    await post(first.session, await snapshotFor(first.session, first.key, { deviceSteps: 9000 }));
    expect(await CoinHoldModel.countDocuments({ userId: first.session.userId, status: 'held' })).toBe(1);

    const second = await request(app).post('/v1/devices/register').set(authed(first.session))
      .send({ installId: `emu-${Date.now()}`, platform: 'android', profile: { model: 'sdk_gphone64', app: { version: '1.0.0', build: '1' } } });
    const emulator = await attested({ ...first.session, deviceId: second.body.deviceId });
    const res = await post(emulator.session, await snapshotFor(emulator.session, emulator.key, { deviceSteps: 4000, emulator: true }));
    expect(res.body.day).toMatchObject({ verified: true, verifiedSteps: 9000 });

    const result = await releaseDueHolds(new Date(Date.now() + 8 * 24 * 3_600_000));
    expect(result).toMatchObject({ released: 0, voided: 1 });
    expect(await CoinHoldModel.findOne({ userId: first.session.userId }).lean()).toMatchObject({ status: 'voided', reason: 'new_flag' });
  });

  it('in shadow mode the same hold is paid, and what would have happened is counted', async () => {
    await setConfig('coins', { steps: { enabled: true } });
    const first = await attested();
    await post(first.session, await snapshotFor(first.session, first.key, { deviceSteps: 9000 }));
    const second = await request(app).post('/v1/devices/register').set(authed(first.session))
      .send({ installId: `emu-${Date.now()}`, platform: 'android', profile: { model: 'sdk_gphone64', app: { version: '1.0.0', build: '1' } } });
    const emulator = await attested({ ...first.session, deviceId: second.body.deviceId });
    await post(emulator.session, await snapshotFor(emulator.session, emulator.key, { deviceSteps: 4000, emulator: true }));

    const result = await releaseDueHolds(new Date(Date.now() + 8 * 24 * 3_600_000));
    expect(result).toMatchObject({ released: 1, voided: 0, wouldVoid: 1 });
  });
});

describe('reading steps back: config, ranges and sources', () => {
  const watch = (steps: number, manualSteps = 0, hourly: number[] = []) => ({
    packageName: 'com.fitbit.FitbitMobile', appName: 'Fitbit', kind: 'watch', steps, distance: steps * 0.75, calories: 0,
    lastRecordAt: Date.now(), isSelf: false, isWearable: true, trustedWearable: true, isPlatform: false, manualSteps,
    unknownMethodSteps: 0, lateWrittenSteps: 0, hourlySteps: hourly, activeCalories: -1, distanceSource: 'health_connect',
  });
  const stranger = (steps: number) => ({ ...watch(steps), packageName: 'com.example.stepper', appName: 'Stepper', kind: 'app', isWearable: false, trustedWearable: false, distanceSource: 'derived' });

  it('serves the tracker config, with only the record types the app declares and the privacy link', async () => {
    await setConfig('activity', { tracker: { healthConnectReadTypes: ['distance', 'totalCalories'] }, sync: { intervalMinutes: 3 } });
    const session = await signUpAndRegister();
    const res = await request(app).get('/v1/activity/config').set(authed(session));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tracker: {
        healthConnectReadTypes: ['steps', 'distance'], healthConnectWriteEnabled: false, gapRecovery: 'split', privacyPolicyUrl: 'https://vokve.app/privacy',
        wearableTrust: 'catalog', wearableAllowlist: ['com.google.android.apps.fitness'],
      },
      sync: { intervalMinutes: 3, maxAgeDays: 7, include: ['minutes', 'motionWindows', 'healthConnectRecords'] },
      playIntegrity: { cloudProjectNumber: null },
    });
  });

  it('answers any day, and a range by hour, day, week and month', async () => {
    const { session, key } = await attested();
    const date = today();
    await post(session, await snapshotFor(session, key, { deviceSteps: 6000 }));
    await ActivityDailyModel.create({ _id: `${session.userId}:${addDays(date, -1)}`, userId: session.userId, localDay: addDays(date, -1), steps: 9000, verifiedSteps: 8000 });

    const day = await request(app).get(`/v1/activity/day?date=${addDays(date, -1)}`).set(authed(session));
    expect(day.body).toMatchObject({ date: addDays(date, -1), steps: 9000, verifiedSteps: 8000 });

    const hours = await request(app).get(`/v1/activity/range?from=${date}&to=${date}&granularity=hour`).set(authed(session));
    expect(hours.status).toBe(200);
    expect(hours.body.points).toHaveLength(24);
    expect(hours.body.points[9]).toMatchObject({ start: `${date}T09:00`, steps: 6000, verifiedSteps: 6000 });

    const days = await request(app).get(`/v1/activity/range?from=${addDays(date, -6)}&to=${date}&granularity=day`).set(authed(session));
    expect(days.body.points).toHaveLength(7);
    expect(days.body.points.slice(-2).map((p: { steps: number }) => p.steps)).toEqual([9000, 6000]);
    expect(days.body.totals).toMatchObject({ steps: 15000, verifiedSteps: 14000, activeDays: 2 });
    expect(days.body.best).toEqual({ date: addDays(date, -1), steps: 9000 });

    const weeks = await request(app).get(`/v1/activity/range?from=${addDays(date, -13)}&to=${date}&granularity=week`).set(authed(session));
    expect(weeks.body.points).toHaveLength(2);
    expect(weeks.body.points[1]).toMatchObject({ start: addDays(date, -6), end: date, steps: 15000 });

    const months = await request(app).get(`/v1/activity/range?from=${date.slice(0, 4)}-01-01&to=${date.slice(0, 4)}-12-31&granularity=month`).set(authed(session));
    expect(months.body.points).toHaveLength(12);

    const bad = await request(app).get(`/v1/activity/range?from=${addDays(date, -1)}&to=${date}&granularity=hour`).set(authed(session));
    expect(bad.status).toBe(422);
  });

  it('says where the day came from and how it was matched, source by source', async () => {
    const hourly = Array.from({ length: 24 }, (_, h) => (h === 8 ? 8500 : 0));
    const { session, key } = await attested();
    await post(session, await snapshotFor(session, key, {
      deviceSteps: 7000, recoveredSteps: 300,
      sources: [watch(9500, 1000, hourly), stranger(12_000), { ...watch(30_000), packageName: 'com.sec.android.app.shealth', appName: 'Samsung Health' }],
    }));

    const res = await request(app).get(`/v1/activity/sources?date=${today()}`).set(authed(session));
    expect(res.status).toBe(200);
    const report = res.body;
    expect(report.day).toMatchObject({ steps: 8500, verifiedSteps: 8500, source: 'health_connect' });
    expect(report.devices).toHaveLength(1);
    const [device] = report.devices;
    expect(device).toMatchObject({ isCurrent: true, answeredForDay: true, name: 'Google Pixel 8', counted: 8500, phone: { counted: 7000, recovered: 300, clean: 6700 }, proof: { keyAttested: true, bootVerified: true } });
    const byName = Object.fromEntries(device.sources.map((s: { appName: string }) => [s.appName, s]));
    expect(byName.Fitbit).toMatchObject({ status: 'used', steps: 9500, manualSteps: 1000, countable: 8500 });
    expect(byName.Stepper).toMatchObject({ status: 'unverified' });
    expect(byName['Samsung Health']).toMatchObject({ status: 'not_counted' });
    expect(report.explanation.join(' ')).toContain('Fitbit answers for the day');
    expect(report.explanation.join(' ')).toContain('Samsung Health recorded 30,000');
    expect(report.uploads).toHaveLength(1);
    expect(report.checks.layers).toHaveLength(7);
    expect(report.checks.flags.map((f: { kind: string }) => f.kind)).toContain('manual_entries');

    // The hours are the watch's own, since the watch answered.
    const hours = await request(app).get(`/v1/activity/range?from=${today()}&to=${today()}&granularity=hour`).set(authed(session));
    expect(hours.body.points[8].steps).toBe(8500);
  });

  it('a watch relayed by Google Fit, its steps with no recording method: the day shows it, the phone’s count verifies, and the page says why (D-51)', async () => {
    // The phone counted the morning; the watch alone saw a 200-step walk at 14:00.
    const hourly = Array.from({ length: 24 }, (_, h) => (h === 9 ? 1000 : h === 14 ? 200 : 0));
    const googleFit = {
      ...watch(1200, 0, hourly), packageName: 'com.google.android.apps.fitness', appName: 'Google Fit', kind: 'app',
      isWearable: false, unknownMethodSteps: 1200, distance: 0, distanceSource: 'none',
    };
    const { session, key } = await attested();
    const res = await post(session, await snapshotFor(session, key, {
      deviceSteps: 1000, resolvedSteps: 1200, resolvedBy: { packageName: googleFit.packageName, appName: 'Google Fit', kind: 'app' },
      sources: [googleFit],
    }));
    expect(res.body.day).toMatchObject({ steps: 1200, verifiedSteps: 1000, source: 'device', verified: true });

    const report = (await request(app).get(`/v1/activity/sources?date=${today()}`).set(authed(session))).body;
    const [row] = report.devices[0].sources;
    expect(row).toMatchObject({ appName: 'Google Fit', status: 'lower', steps: 1200, countable: 0 });
    expect(row.note).toContain('do not say how they were recorded');
    const explanation = report.explanation.join(' ');
    expect(explanation).toContain('Google Fit recorded 1,200, more than the phone, so the day shows 1,200 steps.');
    expect(explanation).toContain('Google Fit does not say how its steps were recorded, so they are not verified.');
    expect(explanation).toContain('1,000 steps are verified');
    expect(explanation).not.toContain('No trusted app counted more');

    // The day's hours are the ones it shows: the watch's walk is in them.
    const hours = await request(app).get(`/v1/activity/range?from=${today()}&to=${today()}&granularity=hour`).set(authed(session));
    expect(hours.body.points[9].steps).toBe(1000);
    expect(hours.body.points[14].steps).toBe(200);
  });

  it('hides the fraud layers where config says so, and explains an empty day', async () => {
    await setConfig('activity', { inspector: { showChecks: false } });
    const session = await signUpAndRegister();
    const res = await request(app).get(`/v1/activity/sources?date=${today()}`).set(authed(session));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ checks: null, devices: [], scoredAt: null });
    expect(res.body.explanation[0]).toContain('Nothing has been synced');
  });
});

describe('the dev step route is unaffected', () => {
  it('still credits directly, so the economy can be exercised without a phone', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).post('/v1/dev/steps').set(authed(session)).send({ steps: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe('held');
  });
});

describe('steps and the streak (D-44)', () => {
  it('a verified day at or above the goal earns the streak day; one below does not', async () => {
    const { session, key } = await attested();
    const yesterday = addDays(today(), -1);

    const short = await snapshotFor(session, key, { deviceSteps: 6400, date: yesterday });
    const first = await post(session, short);
    expect(first.status).toBe(200);
    expect(first.body.streakEarned).toBe(false);
    let streak = await request(app).get('/v1/streak').set(authed(session));
    expect(streak.body.completedDays).toEqual([]);

    const enough = await snapshotFor(session, key, { deviceSteps: 10_400 });
    const res = await post(session, enough);
    expect(res.body).toMatchObject({ streakEarned: true, day: { verifiedSteps: 10_400, verified: true } });
    streak = await request(app).get('/v1/streak').set(authed(session));
    expect(streak.body).toMatchObject({ completedDays: [today()], currentStreak: 1, todayCovered: true });
  });
});
