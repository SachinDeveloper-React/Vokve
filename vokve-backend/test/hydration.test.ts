import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDays, localDayOf } from '../src/lib/dates.js';
import { UserSettingsModel } from '../src/modules/identity/models.js';
import { HydrationEntryModel } from '../src/modules/hydration/models.js';
import { getHydrationStats } from '../src/modules/hydration/service.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

const ZONE = 'Asia/Kolkata';
const today = () => localDayOf(new Date(), ZONE);

function drink(session: Session, body: Record<string, unknown>, key = String(body.id)) {
  return request(app).post('/v1/hydration/entries').set({ ...authed(session), 'idempotency-key': `drink-${key}` }).send(body);
}

async function past(session: Session, day: string, ml: number, n: number) {
  await HydrationEntryModel.create({
    _id: `${session.userId}:${day}-${n}`, userId: session.userId, clientId: `${day}-${n}`, ml,
    at: new Date(`${day}T06:00:00Z`), localDay: day,
  });
}

describe('hydration: the day (RULES Y1, Y2)', () => {
  it('starts empty, against the goal in the member’s settings', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).get('/v1/hydration/today').set(authed(session));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: today(), consumedMl: 0, goalMl: 2_500, entries: [], caution: null });
    // The limits travel with the day, so the app can ask "would this tap be
    // too much?" without a second call (RULES Y1b).
    expect(res.body.limits).toEqual({
      minMl: 10, maxMl: 3_000, maxDailyMl: 10_000, confirmAboveMl: 5_000, hourlyMl: 1_500, hourlyMinutes: 60,
    });

    await UserSettingsModel.updateOne({ _id: session.userId }, { $set: { dailyWaterGoalMl: 3_000 } }, { upsert: true });
    expect((await request(app).get('/v1/hydration/today').set(authed(session))).body.goalMl).toBe(3_000);
  });

  it('adds drinks up, newest first, and a retried log is the same glass', async () => {
    const session = await signUpAndRegister();
    const first = await drink(session, { id: 'd1', ml: 250, at: new Date(Date.now() - 60_000).toISOString() });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ consumedMl: 250, entries: [{ id: 'd1', ml: 250 }] });

    const second = await drink(session, { id: 'd2', ml: 500 });
    expect(second.body.consumedMl).toBe(750);
    expect(second.body.entries.map((e: { id: string }) => e.id)).toEqual(['d2', 'd1']);

    // The same drink again, under a new request key — still one glass.
    const again = await drink(session, { id: 'd2', ml: 500 }, 'd2-retry');
    expect(again.body.consumedMl).toBe(750);
    expect(await HydrationEntryModel.countDocuments({ userId: session.userId })).toBe(2);
  });

  it('takes a drink back out, and another member’s drink is not found', async () => {
    const session = await signUpAndRegister();
    const other = await signUpAndRegister();
    await drink(session, { id: 'd1', ml: 300 });
    await drink(session, { id: 'd2', ml: 200 });

    const gone = await request(app).delete('/v1/hydration/entries/d1').set(authed(session));
    expect(gone.status).toBe(200);
    expect(gone.body).toMatchObject({ consumedMl: 200, entries: [{ id: 'd2' }] });

    const foreign = await request(app).delete('/v1/hydration/entries/d2').set(authed(other));
    expect(foreign.status).toBe(404);
  });

  it('refuses amounts and times outside the bounds', async () => {
    const session = await signUpAndRegister();
    expect((await drink(session, { id: 'tiny', ml: 5 })).status).toBe(422);
    expect((await drink(session, { id: 'huge', ml: 5_000 })).status).toBe(422);
    expect((await drink(session, { id: 'old', ml: 250, at: new Date(Date.now() - 9 * 86_400_000).toISOString() })).status).toBe(422);
    expect((await drink(session, { id: 'soon', ml: 250, at: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(422);
  });
});

describe('hydration: the habit (RULES Y4)', () => {
  it('finds the best run at the goal, and averages and rates the last 30 days that had water', async () => {
    const session = await signUpAndRegister();
    const t = today();
    // Three days at the goal, a short day, then two at the goal ending today.
    await past(session, addDays(t, -6), 2_500, 1);
    await past(session, addDays(t, -5), 2_600, 1);
    await past(session, addDays(t, -4), 3_000, 1);
    await past(session, addDays(t, -3), 1_000, 1);
    await past(session, addDays(t, -1), 2_000, 1);
    await past(session, addDays(t, -1), 500, 2);
    await past(session, t, 2_500, 1);
    // Long ago: counts towards the best run, not the 30-day figures.
    await past(session, addDays(t, -60), 1_000, 1);

    const stats = await getHydrationStats(session.userId, ZONE);
    expect(stats).toEqual({
      bestStreakDays: 3,
      dailyAverageMl: Math.round((2_500 + 2_600 + 3_000 + 1_000 + 2_500 + 2_500) / 6),
      goalHitRatePercent: Math.round((5 / 6) * 100),
      reminderCount: 7,
    });
  });
});

describe('hydration: reminders (RULES Y5, Y6)', () => {
  it('serves the default plan, then keeps the member’s — de-duplicated and in clock order', async () => {
    const session = await signUpAndRegister();
    const plan = (await request(app).get('/v1/hydration/reminders').set(authed(session))).body;
    expect(plan).toMatchObject({ enabled: true, sound: 'default', vibration: true, repeatDays: [0, 1, 2, 3, 4, 5, 6] });
    expect(plan.reminders.map((r: { time: string }) => r.time)).toEqual(['07:00', '08:30', '10:00', '13:00', '15:30', '18:00', '20:00']);

    const next = {
      ...plan,
      vibration: false,
      repeatDays: [4, 0, 0, 2],
      reminders: [
        ...plan.reminders.slice(0, 2),
        { id: 'c1', time: '21:30', slot: 'custom', enabled: true },
        { id: 'c2', time: '21:30', slot: 'custom', enabled: true },
        { id: 'c3', time: '06:15', slot: 'custom', enabled: false },
      ],
    };
    const saved = await request(app).put('/v1/hydration/reminders').set({ ...authed(session), 'idempotency-key': 'plan-1' }).send(next);
    expect(saved.status).toBe(200);
    expect(saved.body.repeatDays).toEqual([0, 2, 4]);
    expect(saved.body.reminders.map((r: { id: string }) => r.id)).toEqual(['c3', 'morning-07:00', 'morning-08:30', 'c1']);
    expect((await request(app).get('/v1/hydration/reminders').set(authed(session))).body.vibration).toBe(false);
  });

  it('refuses a time it cannot read', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).put('/v1/hydration/reminders').set(authed(session)).send({
      enabled: true, sound: 'default', vibration: true, repeatDays: [0],
      reminders: [{ id: 'x', time: '25:00', slot: 'custom', enabled: true }],
    });
    expect(res.status).toBe(422);
  });

  it('counts only the reminders that will arrive today', async () => {
    const session = await signUpAndRegister();
    const weekday = (new Date(`${today()}T00:00:00Z`).getUTCDay() + 6) % 7;
    await request(app).put('/v1/hydration/reminders').set(authed(session)).send({
      enabled: true, sound: 'default', vibration: true, repeatDays: [(weekday + 1) % 7],
      reminders: [{ id: 'a', time: '09:00', slot: 'morning', enabled: true }],
    });
    expect((await getHydrationStats(session.userId, ZONE)).reminderCount).toBe(0);
  });
});

describe('content: the day’s tip', () => {
  it('serves one tip per topic per day, and refuses a topic it does not have', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).get('/v1/content/tips/hydration').set(authed(session));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ topic: 'hydration', title: null, text: expect.any(String) });
    expect((await request(app).get('/v1/content/tips/hydration').set(authed(session))).body.id).toBe(res.body.id);

    const reminders = (await request(app).get('/v1/content/tips/reminders').set(authed(session))).body;
    expect(reminders.title).toEqual(expect.any(String));

    expect((await request(app).get('/v1/content/tips/gossip').set(authed(session))).status).toBe(404);
  });
});
