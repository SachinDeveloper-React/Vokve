import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDayOf } from '../src/lib/dates.js';
import { countingWindow, cutToWindow } from '../src/modules/activity/counting.js';
import { signedSnapshotSchema } from '../src/modules/activity/snapshot.js';
import { DeviceModel } from '../src/modules/devices/models.js';
import { setTrustedAttestationRoots } from '../src/modules/integrity/service.js';
import { attestKey, makeCa, signSnapshot, snapshotPayload, type TestCa, type TestKey } from './attestation.js';
import { app, authed, baseHeaders, signUpAndRegister, type Session } from './helpers.js';

/**
 * Counting starts at sign-in (D-56): a phone's counter and Health Connect
 * both hold the whole day, but only what was walked while the account was
 * signed in on the phone is the account's.
 */

const ZONE = 'Asia/Kolkata';
const DAY = '2026-10-01';
/** An instant on a local day in India, `HH:mm`. */
const at = (day: string, time: string) => Date.parse(`${day}T${time}:00+05:30`);
const today = () => localDayOf(new Date(), ZONE);

let ca: TestCa;
beforeAll(() => {
  ca = makeCa();
});
afterEach(() => {
  setTrustedAttestationRoots(null);
});

/** Minutes of walking from `time`, `perMinute` steps each, timed. */
const walk = (day: string, time: string, minutes: number, perMinute: number) =>
  Array.from({ length: minutes }, (_, i) => ({
    minuteStart: at(day, time) + i * 60_000, steps: perMinute, untimedSteps: 0, chargingSteps: 0, stillSteps: 0, vehicleSteps: 0,
  }));

const fitRecord = (id: string, day: string, from: string, to: string, count: number, recordingMethod = 'automatic') => ({
  id, clientRecordId: null, clientRecordVersion: 0, packageName: 'com.google.android.apps.fitness', recordingMethod,
  device: { type: 'phone', manufacturer: 'Google', model: 'Pixel 8' }, startTime: at(day, from), endTime: at(day, to),
  startZoneOffsetSeconds: 19800, endZoneOffsetSeconds: 19800, lastModifiedTime: at(day, to), recordType: 'steps', count,
});

const hcApp = (packageName: string, appName: string, steps: number, hourlySteps: number[] = []) => ({
  packageName, appName, kind: 'app', steps, distance: 0, calories: 0, lastRecordAt: 0, isSelf: false, isWearable: false,
  trustedWearable: packageName === 'com.google.android.apps.fitness', isPlatform: false, manualSteps: 0, unknownMethodSteps: 0,
  lateWrittenSteps: 0, hourlySteps, activeCalories: -1, distanceSource: 'none',
});

describe('counting from sign-in (D-56): the part of a day that counts', () => {
  const signedIn = (from: string, to: string | null = null) => ({ from: new Date(from), to: to ? new Date(to) : null });

  it('is the whole day where no periods were kept, before the first one, and inside one', () => {
    expect(countingWindow(undefined, DAY, ZONE)).toBeNull();
    expect(countingWindow([], DAY, ZONE)).toBeNull();
    // Evidence older than the rule stays as it was.
    expect(countingWindow([signedIn('2026-10-03T10:00:00+05:30')], DAY, ZONE)).toBeNull();
    expect(countingWindow([signedIn('2026-09-20T10:00:00+05:30')], DAY, ZONE)).toBeNull();
    expect(countingWindow([signedIn('2026-09-20T10:00:00+05:30', '2026-10-05T10:00:00+05:30')], DAY, ZONE)).toBeNull();
  });

  it('is the signed-in time on a day with a sign-in or a sign-out, and nothing on a day with neither', () => {
    expect(countingWindow([signedIn('2026-10-01T12:00:00+05:30')], DAY, ZONE)).toEqual([[at(DAY, '12:00'), at('2026-10-02', '00:00')]]);
    expect(countingWindow([
      signedIn('2026-09-30T08:00:00+05:30', '2026-10-01T09:30:00+05:30'),
      signedIn('2026-10-01T18:00:00+05:30'),
    ], DAY, ZONE)).toEqual([[at(DAY, '00:00'), at(DAY, '09:30')], [at(DAY, '18:00'), at('2026-10-02', '00:00')]]);
    // Signed out on the 29th, back on the 3rd: the 1st was nobody's here.
    expect(countingWindow([
      signedIn('2026-09-28T08:00:00+05:30', '2026-09-29T20:00:00+05:30'),
      signedIn('2026-10-03T08:00:00+05:30'),
    ], DAY, ZONE)).toEqual([]);
  });

  it('keeps what the phone timed inside it, drops what it could not place, and every app by its own records or hours', () => {
    const payload = snapshotPayload({ date: DAY, nonce: 'n', deviceSteps: 0, walkingMinutes: 0, resolvedSteps: 4000, resolvedBy: { packageName: 'com.google.android.apps.fitness', appName: 'Fit' }, records: [] });
    const lump = { minuteStart: at(DAY, '12:01'), steps: 0, untimedSteps: 800, chargingSteps: 0, stillSteps: 0, vehicleSteps: 0 };
    payload.minutes = [...walk(DAY, '09:00', 10, 100), lump, ...walk(DAY, '13:00', 5, 100)];
    payload.deviceSteps = 2600; // 1,000 before, the 800-step backlog, 500 after, and 300 recovered
    payload.recoveredSteps = 300;
    const samsungHours = Array.from({ length: 24 }, (_, hour) => (hour === 10 ? 1200 : hour === 12 || hour === 18 ? 600 : 0));
    payload.sources = [hcApp('com.google.android.apps.fitness', 'Fit', 4000), hcApp('com.sec.android.app.shealth', 'Samsung Health', 2400, samsungHours)];
    payload.healthConnectRecords = {
      status: 'read', recordTypes: ['steps'], truncated: false,
      records: [fitRecord('a', DAY, '08:00', '10:00', 3000), fitRecord('b', DAY, '11:00', '13:00', 600), fitRecord('c', DAY, '14:00', '15:00', 400)],
    };

    const cut = cutToWindow(signedSnapshotSchema.parse(payload), [[at(DAY, '12:00'), at('2026-10-02', '00:00')]]);

    expect(cut.snapshot.deviceSteps).toBe(500);
    expect(cut.snapshot.recoveredSteps).toBe(0);
    expect(cut.snapshot.minutes?.reduce((sum, minute) => sum + minute.untimedSteps, 0)).toBe(0);
    // Fit by its records — half of the one that straddles noon — and Samsung Health by its hours.
    expect(cut.snapshot.sources.map(source => [source.appName, source.steps])).toEqual([['Fit', 700], ['Samsung Health', 1200]]);
    expect(cut.snapshot.resolved.steps).toBe(700);
    expect(cut.leftOut).toBe(3300);
  });
});

describe('counting from sign-in (D-56): signing in and out', () => {
  const periods = async (session: Session) =>
    ((await DeviceModel.findById(session.deviceId, { counting: 1 }).lean())?.counting ?? []).map(p => ({ open: p.to === null, from: p.from }));

  it('starts with a new phone, carries on through a restore, stops at sign-out and starts again at the next sign-in', async () => {
    const before = Date.now();
    const session = await signUpAndRegister({ countingFrom: 'registration' });
    const first = await periods(session);
    expect(first).toHaveLength(1);
    expect(first[0].open).toBe(true);
    expect(first[0].from.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // A launch restoring the session registers again with the same, bound token.
    const restore = await request(app).post('/v1/devices/register').set(baseHeaders)
      .set('authorization', `Bearer ${session.accessToken}`).set('x-vokve-refresh-token', session.refreshToken)
      .send({ installId: (await DeviceModel.findById(session.deviceId).lean())!.installId, platform: 'android', profile: { brand: 'Google', model: 'Pixel 8', app: { version: '1.0.0', build: '1' } } });
    expect(restore.status).toBe(200);
    expect(await periods(session)).toHaveLength(1);

    expect((await request(app).post('/v1/auth/sign-out').set(authed(session))).status).toBe(200);
    expect((await periods(session)).map(p => p.open)).toEqual([false]);

    const again = await request(app).post('/v1/auth/sign-in').set({ ...baseHeaders, 'x-vokve-device-id': session.deviceId })
      .send({ email: session.email, password: 'walk1000steps' });
    expect(again.status).toBe(200);
    expect((await periods(session)).map(p => p.open)).toEqual([false, true]);
  });

  it('a code taken while signed in is not a sign-in: an install that never kept periods still has none', async () => {
    const session = await signUpAndRegister({ countingFrom: 'registration' });
    await DeviceModel.updateOne({ _id: session.deviceId }, { $unset: { counting: 1 } });

    const challenge = await request(app).post('/v1/auth/step-up').set(authed(session)).send({});
    const verified = await request(app).post('/v1/auth/verify-otp').set(authed(session))
      .send({ verificationId: challenge.body.verificationId, code: challenge.body.devCode });
    expect(verified.status).toBe(200);
    expect((await DeviceModel.findById(session.deviceId).lean())?.counting).toBeUndefined();
  });
});

describe('counting from sign-in (D-56): the day', () => {
  async function attested(session: Session): Promise<TestKey> {
    setTrustedAttestationRoots(new Set([ca.rootSpkiSha256]));
    const issued = await request(app).post(`/v1/devices/${session.deviceId}/attestation/challenge`).set(authed(session));
    const key = attestKey(ca, { challenge: issued.body.challenge });
    const res = await request(app).post(`/v1/devices/${session.deviceId}/attestation`).set(authed(session)).send(key.attestation);
    if (res.status !== 200) throw new Error(`attestation failed: ${JSON.stringify(res.body)}`);
    return key;
  }

  async function send(session: Session, key: TestKey, payload: Record<string, unknown>) {
    const nonce = (await request(app).post('/v1/activity/ingest/nonce').set(authed(session))).body.nonce;
    const snapshot = signSnapshot(key, { ...payload, nonce });
    const res = await request(app).post('/v1/activity/ingest').set({ ...authed(session), 'idempotency-key': randomUUID() })
      .send({ date: payload.date, snapshot });
    expect(res.status).toBe(200);
    return res.body;
  }

  /** A phone signed in on it from `from` on, as the server keeps it. */
  async function signedInFrom(from: number) {
    const session = await signUpAndRegister({ countingFrom: 'registration' });
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { counting: [{ from: new Date(from), to: null }] } });
    return { session, key: await attested(session) };
  }

  it('a walk before signing in on the phone does not count, one after does — and the sources page says why', async () => {
    const day = addDays(today(), -1);
    const { session, key } = await signedInFrom(at(day, '12:00'));
    const payload = snapshotPayload({ date: day, nonce: 'n', deviceSteps: 7000, walkingMinutes: 0 });
    payload.minutes = [...walk(day, '09:00', 100, 50), ...walk(day, '15:00', 40, 50)];

    const res = await send(session, key, payload);
    expect(res.day.steps).toBe(2000);

    const report = (await request(app).get(`/v1/activity/sources?date=${day}`).set(authed(session))).body;
    expect(report.explanation[0]).toBe(
      'Only steps taken while you were signed in on Google Pixel 8 count: 5,000 steps from before you signed in there, or while you were signed out, are left out.',
    );
  });

  it("Health Connect counts from the sign-in too: an app's records from before it are left out", async () => {
    const day = addDays(today(), -1);
    const { session, key } = await signedInFrom(at(day, '12:00'));
    const payload = snapshotPayload({
      date: day, nonce: 'n', deviceSteps: 0, walkingMinutes: 0,
      resolvedSteps: 4500, resolvedBy: { packageName: 'com.google.android.apps.fitness', appName: 'Fit' },
      sources: [hcApp('com.google.android.apps.fitness', 'Fit', 4500)],
      records: [fitRecord('a', day, '08:00', '09:00', 3000), fitRecord('b', day, '16:00', '17:00', 1500)],
    });

    const res = await send(session, key, payload);
    expect(res.day.steps).toBe(1500);
  });

  it('a day the account was not signed in on the phone counts nothing', async () => {
    const { session, key } = await signedInFrom(at(addDays(today(), -3), '10:00'));
    await DeviceModel.updateOne({ _id: session.deviceId }, {
      $set: { counting: [
        { from: new Date(at(addDays(today(), -3), '10:00')), to: new Date(at(addDays(today(), -3), '18:00')) },
        { from: new Date(at(addDays(today(), -1), '10:00')), to: null },
      ] },
    });
    const day = addDays(today(), -2);
    const res = await send(session, key, snapshotPayload({ date: day, nonce: 'n', deviceSteps: 4000 }));
    expect(res.day.steps).toBe(0);
  });
});
