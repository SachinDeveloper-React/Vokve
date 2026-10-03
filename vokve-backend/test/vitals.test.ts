import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDays, localDayOf } from '../src/lib/dates.js';
import { ActivityDailyModel } from '../src/modules/activity/models.js';
import { HydrationEntryModel } from '../src/modules/hydration/models.js';
import { UserModel } from '../src/modules/identity/models.js';
import { StreakDayModel } from '../src/modules/streak/models.js';
import { VitalReadingModel } from '../src/modules/vitals/models.js';
import { bmiBandOf, heartBandOf, pressureBandOf } from '../src/modules/vitals/service.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

const ZONE = 'Asia/Kolkata';
const today = () => localDayOf(new Date(), ZONE);
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function log(session: Session, body: Record<string, unknown>) {
  return request(app).post('/v1/vitals').set({ ...authed(session), 'idempotency-key': `v-${String(body.id)}-${Math.random()}` }).send(body);
}

describe('vitals: bands (RULES V5–V7)', () => {
  it('reads heart rate, blood pressure and BMI the way the app does', () => {
    expect([59, 60, 100, 101, 120, 121].map(heartBandOf)).toEqual(['low', 'normal', 'normal', 'elevated', 'elevated', 'high']);
    expect(pressureBandOf(118, 76)).toBe('normal');
    expect(pressureBandOf(125, 78)).toBe('elevated');
    expect(pressureBandOf(118, 82)).toBe('high');
    expect(pressureBandOf(132, 70)).toBe('high');
    expect(pressureBandOf(88, 70)).toBe('low');
    expect([18.4, 18.5, 24.9, 25, 29.9, 30].map(bmiBandOf)).toEqual(['underweight', 'healthy', 'healthy', 'overweight', 'overweight', 'obese']);
  });
});

describe('vitals: readings (RULES V1, V2, V4)', () => {
  it('logs within bounds, refuses outside them, never takes a BMI, and a retry is the same reading', async () => {
    const session = await signUpAndRegister();
    const ok = await log(session, { id: 'hr-1', kind: 'heart_rate', value: 72 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: 'hr-1', kind: 'heart_rate', value: 72, secondary: null });

    expect((await log(session, { id: 'hr-2', kind: 'heart_rate', value: 300 })).status).toBe(422);
    expect((await log(session, { id: 'bp-1', kind: 'blood_pressure', value: 120 })).status).toBe(422);
    expect((await log(session, { id: 'bp-2', kind: 'blood_pressure', value: 120, secondary: 200 })).status).toBe(422);
    expect((await log(session, { id: 'bmi-1', kind: 'bmi', value: 22 })).status).toBe(422);

    await log(session, { id: 'hr-1', kind: 'heart_rate', value: 72 });
    expect(await VitalReadingModel.countDocuments({ userId: session.userId })).toBe(1);
  });

  it("keeps the profile's weight to the newest weight logged", async () => {
    const session = await signUpAndRegister();
    await log(session, { id: 'w-1', kind: 'weight', value: 72.5, recordedAt: minutesAgo(10) });
    expect((await UserModel.findById(session.userId).lean())?.weightKg).toBe(72.5);

    // An older reading logged afterwards is history, not the current weight.
    await log(session, { id: 'w-0', kind: 'weight', value: 75, recordedAt: minutesAgo(60 * 24) });
    expect((await UserModel.findById(session.userId).lean())?.weightKg).toBe(72.5);
  });

  it('lists the newest first, of one kind or all, and takes one back out', async () => {
    const session = await signUpAndRegister();
    const other = await signUpAndRegister();
    await log(session, { id: 'bp-old', kind: 'blood_pressure', value: 122, secondary: 78, recordedAt: minutesAgo(120) });
    await log(session, { id: 'bp-new', kind: 'blood_pressure', value: 118, secondary: 76, recordedAt: minutesAgo(5) });
    await log(session, { id: 'hr-1', kind: 'heart_rate', value: 70, recordedAt: minutesAgo(1) });

    const pressure = (await request(app).get('/v1/vitals?kind=blood_pressure&limit=5').set(authed(session))).body;
    expect(pressure.map((r: { id: string }) => r.id)).toEqual(['bp-new', 'bp-old']);
    const all = (await request(app).get('/v1/vitals?limit=2').set(authed(session))).body;
    expect(all.map((r: { id: string }) => r.id)).toEqual(['hr-1', 'bp-new']);

    expect((await request(app).delete('/v1/vitals/bp-new').set(authed(other))).status).toBe(404);
    expect((await request(app).delete('/v1/vitals/bp-new').set(authed(session))).status).toBe(200);
    const after = (await request(app).get('/v1/vitals?kind=blood_pressure').set(authed(session))).body;
    expect(after.map((r: { id: string }) => r.id)).toEqual(['bp-old']);
  });
});

describe('vitals: the newest of each, and BMI (RULES V3, V9)', () => {
  it('derives BMI from the newest weight and the height on the profile, or not at all', async () => {
    const session = await signUpAndRegister();
    let latest = (await request(app).get('/v1/vitals/latest').set(authed(session))).body;
    expect(latest).toMatchObject({ heart_rate: null, blood_pressure: null, weight: null, bmi: null });
    expect(latest.disclaimer).toContain('not a medical device');

    await log(session, { id: 'w-1', kind: 'weight', value: 70 });
    latest = (await request(app).get('/v1/vitals/latest').set(authed(session))).body;
    expect(latest.bmi).toBeNull(); // no height yet

    await UserModel.updateOne({ _id: session.userId }, { $set: { heightCm: 175 } });
    latest = (await request(app).get('/v1/vitals/latest').set(authed(session))).body;
    expect(latest.weight).toMatchObject({ value: 70 });
    expect(latest.bmi).toMatchObject({ id: 'bmi', kind: 'bmi', value: 22.9 });
  });
});

describe('the health score (RULES V8)', () => {
  it('scores nothing for nothing, and says why part by part', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).get('/v1/health/score').set(authed(session));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ score: 0, outOf: 100, band: 'Needs work' });
    expect(res.body.factors.map((f: { id: string; weight: number }) => [f.id, f.weight])).toEqual([
      ['activity', 30], ['hydration', 20], ['vitals', 20], ['bmi', 15], ['consistency', 15],
    ]);
    expect(res.body.factors[2].detail).toContain('Log your heart rate');
  });

  it('gives full marks for a week on goal, normal vitals, a healthy BMI and a week-long streak', async () => {
    const session = await signUpAndRegister();
    const t = today();
    await UserModel.updateOne({ _id: session.userId }, { $set: { heightCm: 175 } });
    for (let back = 0; back < 7; back++) {
      const day = addDays(t, -back);
      await ActivityDailyModel.create({ _id: `${session.userId}:${day}`, userId: session.userId, localDay: day, verifiedSteps: 10_000, verified: true });
      await HydrationEntryModel.create({ _id: `${session.userId}:w${back}`, userId: session.userId, clientId: `w${back}`, ml: 2_500, at: new Date(), localDay: day });
      await StreakDayModel.create({ _id: `${session.userId}:${day}`, userId: session.userId, localDay: day, kind: 'earned', source: 'steps' });
    }
    await log(session, { id: 'hr', kind: 'heart_rate', value: 72 });
    await log(session, { id: 'bp', kind: 'blood_pressure', value: 118, secondary: 76 });
    await log(session, { id: 'w', kind: 'weight', value: 70 });

    const full = (await request(app).get('/v1/health/score').set(authed(session))).body;
    expect(full).toMatchObject({ score: 100, band: 'Good' });

    // An elevated pressure halves the vitals part.
    await log(session, { id: 'bp-2', kind: 'blood_pressure', value: 125, secondary: 78 });
    const elevated = (await request(app).get('/v1/health/score').set(authed(session))).body;
    expect(elevated.score).toBe(90);
    expect(elevated.factors.find((f: { id: string }) => f.id === 'vitals')).toMatchObject({
      points: 10, detail: 'Heart rate normal, blood pressure elevated.',
    });
  });
});
