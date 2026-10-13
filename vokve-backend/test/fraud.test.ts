import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { invalidateConfig } from '../src/config/remote.js';
import { localDayOf } from '../src/lib/dates.js';
import { setPlayIntegrityDecoder } from '../src/lib/playIntegrity.js';
import { ActivityDailyModel } from '../src/modules/activity/models.js';
import { CoinHoldModel, CoinLedgerModel } from '../src/modules/economy/models.js';
import { credit } from '../src/modules/economy/service.js';
import { UserModel } from '../src/modules/identity/models.js';
import { FraudFlagModel } from '../src/modules/integrity/models.js';
import { setTrustedAttestationRoots } from '../src/modules/integrity/service.js';
import { AppConfigModel, AuditLogModel } from '../src/modules/platform/models.js';
import { attestKey, makeCa, signSnapshot, snapshotPayload, type DayShape, type TestCa, type TestKey } from './attestation.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

/**
 * The checks that stand between a tampered build and a verified day (RULES
 * A24–A26), and the queue an operator reads them in (A27).
 *
 * Each case here is a thing somebody actually tries: raise the total and
 * leave the minutes alone, switch the evidence off so the layer drops out of
 * the mean, claim a day no body could walk, or send a count with nothing
 * behind it at all.
 */

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

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

async function attested(): Promise<{ session: Session; key: TestKey }> {
  setTrustedAttestationRoots(new Set([ca.rootSpkiSha256]));
  const session = await signUpAndRegister();
  const issued = await request(app).post(`/v1/devices/${session.deviceId}/attestation/challenge`).set(authed(session));
  const key = attestKey(ca, { challenge: issued.body.challenge });
  const res = await request(app).post(`/v1/devices/${session.deviceId}/attestation`).set(authed(session)).send(key.attestation);
  if (res.status !== 200) throw new Error(`attestation failed: ${JSON.stringify(res.body)}`);
  return { session, key };
}

type Shape = Omit<DayShape, 'nonce' | 'date'> & { date?: string };

/** Sends one day as a phone would, and answers with the day the server kept. */
async function send(session: Session, key: TestKey, shape: Shape, integrity?: Record<string, unknown>) {
  const date = shape.date ?? today();
  const nonce = (await request(app).post('/v1/activity/ingest/nonce').set(authed(session))).body.nonce;
  const snapshot = signSnapshot(key, snapshotPayload({ ...shape, date, nonce }));
  const res = await request(app)
    .post('/v1/activity/ingest')
    .set({ ...authed(session), 'idempotency-key': randomUUID() })
    .send({ date, snapshot, ...(integrity ? { integrity } : {}) });
  return { res, date };
}

const flagsOn = async (userId: string, localDay: string) =>
  (await FraudFlagModel.find({ userId, localDay }).lean()).map(f => `${f.kind}:${f.severity}`);

describe('fraud: a count no body produced (RULES A24)', () => {
  it('refuses a minute nobody could have walked', async () => {
    const { session, key } = await attested();
    // 10 minutes of 400 steps: 6.6 steps a second, held for a minute at a time.
    const { res, date } = await send(session, key, { deviceSteps: 4_000, walkingMinutes: 10, perMinute: 400 });

    expect(res.status).toBe(200);
    expect(res.body.day).toMatchObject({ steps: 4_000, verifiedSteps: 0, verified: false });
    const day = await ActivityDailyModel.findById(`${session.userId}:${date}`).lean();
    expect(day?.hardRejects).toContain('cadence_impossible');
    expect(day?.layers?.L2).toBe(0);
    expect(await flagsOn(session.userId, date)).toContain('cadence_impossible:hard');
  });

  it('a brisk walk at a human cadence is not touched', async () => {
    const { session, key } = await attested();
    // 180 steps a minute — a fast walk, and nowhere near the ceiling.
    const { res, date } = await send(session, key, { deviceSteps: 9_000, walkingMinutes: 50, perMinute: 180 });
    expect(res.body.day).toMatchObject({ steps: 9_000, verifiedSteps: 9_000, verified: true });
    expect(await flagsOn(session.userId, date)).not.toContain('cadence_impossible:hard');
  });

  it('refuses a day past what anyone walks', async () => {
    const { session, key } = await attested();
    const { res, date } = await send(session, key, { deviceSteps: 150_000, walkingMinutes: 1_000, perMinute: 150 });
    expect(res.body.day.verifiedSteps).toBe(0);
    const day = await ActivityDailyModel.findById(`${session.userId}:${date}`).lean();
    expect(day?.hardRejects).toContain('daily_volume_impossible');
    // The soft flag for a merely implausible day is still on the record.
    expect(await flagsOn(session.userId, date)).toContain('daily_volume:soft');
  });
});

describe('fraud: a total the minutes do not account for (RULES A24)', () => {
  it('doubts a day whose count the minutes cannot explain', async () => {
    const { session, key } = await attested();
    // 44,000 claimed; 2,000 in the minutes it says it counted them in.
    const { res, date } = await send(session, key, { deviceSteps: 44_000, walkingMinutes: 20, perMinute: 100 });

    const flags = await flagsOn(session.userId, date);
    expect(flags).toContain('steps_unaccounted:soft');
    const day = await ActivityDailyModel.findById(`${session.userId}:${date}`).lean();
    expect(day?.layers?.L2).toBeLessThanOrEqual(30);
    expect(day?.breakdown?.devices?.[0]?.flags).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'steps_unaccounted' })]),
    );
    expect(res.body.day.steps).toBe(44_000);
  });

  it('refuses it outright once the operator turns the hard share on', async () => {
    await setConfig('activity', { thresholds: { unaccountedShareHard: 0.5 } });
    const { session, key } = await attested();
    const { res, date } = await send(session, key, { deviceSteps: 44_000, walkingMinutes: 20, perMinute: 100 });

    expect(res.body.day.verifiedSteps).toBe(0);
    const day = await ActivityDailyModel.findById(`${session.userId}:${date}`).lean();
    expect(day?.hardRejects).toContain('steps_unaccounted');
  });

  it('leaves an honest recovery alone — a backlog is not an unaccounted count', async () => {
    const { session, key } = await attested();
    // 3,000 counted in minutes, 5,000 handed over in one go when the service
    // started again: the recovery is taken off before anything is judged.
    const { res, date } = await send(session, key, {
      deviceSteps: 8_000, recoveredSteps: 5_000, walkingMinutes: 30, perMinute: 100,
    });
    expect(res.body.day).toMatchObject({ verifiedSteps: 3_000, verified: true });
    expect(await flagsOn(session.userId, date)).not.toContain('steps_unaccounted:soft');
  });
});

describe('fraud: evidence switched off (RULES A25)', () => {
  it('scores the motion layer rather than dropping it when the sampling it asked for is missing', async () => {
    const { session, key } = await attested();
    const { date } = await send(session, key, { deviceSteps: 6_000, motionStatus: 'disabled' });

    const day = await ActivityDailyModel.findById(`${session.userId}:${date}`).lean();
    // 40, not null: switching the sampling off used to score better than an
    // honest phone with a shaken window in it.
    expect(day?.layers?.L4).toBe(40);
    expect(await flagsOn(session.userId, date)).toContain('motion_absent:soft');
  });

  it('refuses a day with no minutes, no motion and no source behind it', async () => {
    const { session, key } = await attested();
    const { res, date } = await send(session, key, {
      deviceSteps: 30_000, minutesStatus: 'disabled', motionStatus: 'disabled', checksEnabled: false,
    });

    expect(res.body.day).toMatchObject({ steps: 30_000, verifiedSteps: 0, verified: false });
    const day = await ActivityDailyModel.findById(`${session.userId}:${date}`).lean();
    expect(day?.hardRejects).toContain('no_corroboration');
  });

  it('still counts a small day a phone could not sample', async () => {
    const { session, key } = await attested();
    const { res } = await send(session, key, {
      deviceSteps: 1_500, minutesStatus: 'disabled', motionStatus: 'disabled',
    });
    expect(res.body.day).toMatchObject({ verifiedSteps: 1_500, verified: true });
  });
});

describe('fraud: what the phone must have proved (RULES A24)', () => {
  it('a key that cannot be attested costs score, and refuses the day once that is required', async () => {
    const session = await signUpAndRegister();
    // No trusted roots: the key is kept, unattested, exactly as a phone that
    // cannot attest at all would leave it.
    setTrustedAttestationRoots(new Set(['not-this-one']));
    const issued = await request(app).post(`/v1/devices/${session.deviceId}/attestation/challenge`).set(authed(session));
    const key = attestKey(ca, { challenge: issued.body.challenge });
    const stored = await request(app).post(`/v1/devices/${session.deviceId}/attestation`).set(authed(session)).send(key.attestation);
    expect(stored.body).toMatchObject({ attested: false });

    const soft = await send(session, key, { deviceSteps: 6_000 });
    expect(soft.res.body.day.verified).toBe(true);
    expect((await ActivityDailyModel.findById(`${session.userId}:${soft.date}`).lean())?.layers?.L0).toBe(40);

    await setConfig('integrity', { requireAttested: true });
    const hard = await send(session, key, { deviceSteps: 6_100, date: localDayOf(new Date(Date.now() - 86_400_000), 'Asia/Kolkata') });
    expect(hard.res.body.day.verifiedSteps).toBe(0);
    const day = await ActivityDailyModel.findById(`${session.userId}:${hard.date}`).lean();
    expect(day?.hardRejects).toContain('attestation_required');
  });

  it('a day whose Play verdict never arrived is refused once a verdict is required', async () => {
    await setConfig('integrity', { playIntegrity: { cloudProjectNumber: 123_456 }, requireVerdict: true });
    const { session, key } = await attested();
    // The phone says it could not get a token — honestly or otherwise.
    const { res, date } = await send(session, key, { deviceSteps: 6_000 }, { error: 'play_services_missing', retryable: false });

    expect(res.status).toBe(200);
    expect(res.body.day.verifiedSteps).toBe(0);
    const day = await ActivityDailyModel.findById(`${session.userId}:${date}`).lean();
    expect(day?.hardRejects).toContain('play_integrity_unavailable');
    expect(day?.layers?.L0).toBe(0);
  });

  it('asks for a fresh verdict before it reads a snapshot at all', async () => {
    await setConfig('integrity', { playIntegrity: { cloudProjectNumber: 123_456 } });
    const { session, key } = await attested();
    const { res } = await send(session, key, { deviceSteps: 6_000 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'INTEGRITY_REQUIRED', details: { cloudProjectNumber: 123_456 } });
  });
});

describe('fraud: the review queue (RULES A27)', () => {
  /**
   * A member whose day was flagged but still verified — one shaken window in
   * four, which is a doubt rather than a refusal — so there are coins in
   * escrow for a confirmation to void.
   */
  async function flagged(): Promise<{ session: Session; date: string; flagId: string }> {
    await setConfig('coins', { steps: { enabled: true } });
    const { session, key } = await attested();
    const { date } = await send(session, key, {
      deviceSteps: 20_000,
      walkingMinutes: 120,
      perMinute: 100,
      windows: [
        { hz: 5, variance: 40, steps: 50 },
        { hz: 1.9, variance: 4, steps: 200 },
        { hz: 1.8, variance: 3.5, steps: 200 },
        { hz: 2.0, variance: 4, steps: 200 },
      ],
    });
    const flag = await FraudFlagModel.findOne({ userId: session.userId, localDay: date, severity: { $in: ['hard', 'soft'] } }).lean();
    if (!flag) throw new Error('no flag was raised');
    return { session, date, flagId: flag._id };
  }

  it('answers the admin key alone', async () => {
    expect((await request(app).get('/v1/admin/fraud/queue')).status).toBe(401);
    expect((await request(app).get('/v1/admin/fraud/queue').set({ 'x-admin-key': 'wrong' })).status).toBe(401);
    expect((await request(app).get('/v1/admin/fraud/queue').set(ADMIN)).status).toBe(200);
  });

  it('lists the account with what it was flagged for, the coins it is holding and the gap between shown and verified', async () => {
    const { session } = await flagged();
    const res = await request(app).get('/v1/admin/fraud/queue').set(ADMIN);
    expect(res.status).toBe(200);
    const row = res.body.data.find((entry: { userId: string }) => entry.userId === session.userId);
    expect(row).toBeDefined();
    expect(row.email).toBe(session.email);
    expect(row.flags.open).toBeGreaterThan(0);
    expect(row.kinds.length).toBeGreaterThan(0);
    expect(row.steps).toBe(20_000);
    expect(row.lastFlagAt).not.toBeNull();
  });

  it('gives the case file: the flags, the day behind them, the holds and the proofs', async () => {
    const { session, date } = await flagged();
    const res = await request(app).get(`/v1/admin/fraud/users/${session.userId}`).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: session.userId, email: session.email });
    expect(res.body.flags[0]).toMatchObject({ localDay: date, status: 'open' });
    expect(res.body.days[0]).toMatchObject({ localDay: date, steps: 20_000 });
    expect(res.body.days[0].devices[0].proof.key).toMatchObject({ attested: true });
    expect(res.body.holds.length).toBeGreaterThan(0);
    expect(res.body.attestations.length).toBeGreaterThan(0);
    expect((await request(app).get('/v1/admin/fraud/users/usr_nobody').set(ADMIN)).status).toBe(404);
  });

  it('confirming a flag voids what the day was holding, and says so in the audit log (RULES T7)', async () => {
    const { session, date, flagId } = await flagged();
    expect(await CoinHoldModel.countDocuments({ userId: session.userId, status: 'held' })).toBeGreaterThan(0);

    const res = await request(app).post(`/v1/admin/fraud/flags/${flagId}/confirm`).set(ADMIN).send({ note: 'shaken phone' });
    expect(res.status).toBe(200);
    expect(res.body.flag).toMatchObject({ id: flagId, status: 'confirmed', localDay: date });
    expect(res.body.voided.length).toBeGreaterThan(0);

    expect(await CoinHoldModel.countDocuments({ userId: session.userId, status: 'held' })).toBe(0);
    const voided = await CoinHoldModel.findOne({ userId: session.userId, status: 'voided' }).lean();
    expect(voided?.reason).toContain('fraud flag confirmed');
    expect(await FraudFlagModel.findById(flagId).lean()).toMatchObject({ status: 'confirmed', reviewedBy: 'admin', reviewNote: 'shaken phone' });
    expect(await AuditLogModel.countDocuments({ action: 'fraud.confirmed', subjectId: session.userId })).toBe(1);
  });

  it('dismissing it leaves the coins alone and gives the trust back', async () => {
    const { session, flagId } = await flagged();
    const res = await request(app).post(`/v1/admin/fraud/flags/${flagId}/dismiss`).set(ADMIN).send({});
    expect(res.status).toBe(200);
    expect(res.body.voided).toEqual([]);
    expect(await CoinHoldModel.countDocuments({ userId: session.userId, status: 'held' })).toBeGreaterThan(0);
    expect(await FraudFlagModel.findById(flagId).lean()).toMatchObject({ status: 'dismissed' });
    expect(await AuditLogModel.countDocuments({ action: 'fraud.dismissed', subjectId: session.userId })).toBe(1);
    expect((await request(app).post('/v1/admin/fraud/flags/flg_nobody/dismiss').set(ADMIN).send({})).status).toBe(404);
  });

  it('re-scores a day from the evidence already stored, so a threshold can be judged on a real one', async () => {
    const { session, key } = await attested();
    const { date } = await send(session, key, { deviceSteps: 44_000, walkingMinutes: 20, perMinute: 100 });
    expect((await ActivityDailyModel.findById(`${session.userId}:${date}`).lean())?.verified).toBe(true);

    // The operator tightens the share and asks what it would have done.
    await setConfig('activity', { thresholds: { unaccountedShareHard: 0.5 } });
    const res = await request(app).post(`/v1/admin/users/${session.userId}/days/${date}/rescore`).set(ADMIN).send({});
    expect(res.status).toBe(200);
    expect(res.body.before.verified).toBe(true);
    expect(res.body.after).toMatchObject({ verified: false });
    expect(res.body.after.hardRejects).toContain('steps_unaccounted');
    expect(await AuditLogModel.countDocuments({ action: 'fraud.rescore', subjectId: session.userId })).toBe(1);
    expect((await request(app).post(`/v1/admin/users/${session.userId}/days/not-a-day/rescore`).set(ADMIN).send({})).status).toBe(404);
  });
});

describe('fraud: the economic layer at checkout (RULES A19)', () => {
  /** A funded account with an address, ready to spend. */
  async function buyer(): Promise<{ session: Session; addressId: string }> {
    const session = await signUpAndRegister();
    // Both contacts proved: a checkout asks for them first (RULES O5), and
    // in tests no SMS provider ever confirms the phone.
    await UserModel.updateOne(
      { _id: session.userId },
      { $set: { phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(), name: 'Asha Verma' } },
    );
    await credit({
      userId: session.userId, source: 'refund', referenceType: 'test', referenceId: `fund-${session.userId}`,
      amount: 2_000, title: 'Test funds', localDay: today(), exemptFromCap: true,
    });
    const address = await request(app).post('/v1/me/addresses').set(authed(session)).send({
      label: 'Home', name: 'Asha Verma', phone: session.phone,
      line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001',
    });
    if (!address.body?.id) throw new Error(`address failed: ${JSON.stringify(address.body)}`);
    return { session, addressId: address.body.id };
  }

  async function buy(session: Session, addressId: string, coins: number) {
    return request(app)
      .post('/v1/checkout')
      .set({ ...authed(session), 'idempotency-key': randomUUID() })
      .send({ lines: [{ itemId: 'cap', quantity: 1 }], addressId, coins });
  }

  it('flags coins spent within an hour of the first ever credit, and still lets the order through', async () => {
    const { session, addressId } = await buyer();
    const res = await buy(session, addressId, 300);
    expect(res.status).toBe(200);

    const flag = await FraudFlagModel.findOne({ userId: session.userId, kind: 'fast_redemption' }).lean();
    expect(flag).toMatchObject({ layer: 'L7', severity: 'soft', status: 'open' });
    expect(flag?.details).toMatchObject({ coins: 300 });
    expect((flag?.details as { minutesSinceFirstCredit: number }).minutesSinceFirstCredit).toBeLessThanOrEqual(60);
  });

  it('does not flag an account whose coins have been sitting for a week', async () => {
    const { session, addressId } = await buyer();
    await CoinLedgerModel.updateMany(
      { userId: session.userId },
      { $set: { createdAt: new Date(Date.now() - 7 * 86_400_000) } },
      { timestamps: false },
    );
    const res = await buy(session, addressId, 300);
    expect(res.status).toBe(200);
    expect(await FraudFlagModel.countDocuments({ userId: session.userId, kind: 'fast_redemption' })).toBe(0);
  });

  it('flags one doorstep behind three accounts', async () => {
    const first = await buyer();
    const second = await buyer();
    const third = await buyer();
    // All three typed the same street line and postcode.
    const res = await buy(third.session, third.addressId, 300);
    expect(res.status).toBe(200);

    const flag = await FraudFlagModel.findOne({ userId: third.session.userId, kind: 'address_reuse' }).lean();
    expect(flag).toMatchObject({ layer: 'L7', severity: 'soft' });
    expect(flag?.details).toMatchObject({ accounts: 3, postalCode: '560001' });
    // The first two bought before the third address existed, so neither is flagged for it.
    expect(await FraudFlagModel.countDocuments({ userId: first.session.userId, kind: 'address_reuse' })).toBe(0);
    expect(await FraudFlagModel.countDocuments({ userId: second.session.userId, kind: 'address_reuse' })).toBe(0);
  });

  it('shows up in the operator queue beside the step flags', async () => {
    const { session, addressId } = await buyer();
    await buy(session, addressId, 300);
    const res = await request(app).get('/v1/admin/fraud/queue').set(ADMIN);
    const row = res.body.data.find((entry: { userId: string }) => entry.userId === session.userId);
    expect(row.kinds).toContain('fast_redemption');
  });
});
