import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ActivityDailyModel } from '../src/modules/activity/models.js';
import { OrderModel } from '../src/modules/commerce/models.js';
import { credit } from '../src/modules/economy/service.js';
import { FraudFlagModel } from '../src/modules/integrity/models.js';
import { app, authed, signUpAndRegister } from './helpers.js';

/** The operator's key, as `test/setup.ts` configures it. */
const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());

describe('admin: the dashboard numbers', () => {
  it('answers the admin key alone', async () => {
    expect((await request(app).get('/v1/admin/analytics/overview')).status).toBe(401);
    expect((await request(app).get('/v1/admin/analytics/overview').set({ 'x-admin-key': 'wrong' })).status).toBe(401);
  });

  it('counts the members, the installs and the window they were asked about', async () => {
    // One account, to count: the figures below are all about its existence
    // rather than about anything it did, so the session itself is not needed.
    await signUpAndRegister();

    const res = await request(app).get('/v1/admin/analytics/overview').query({ days: 7 }).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.window).toMatchObject({ days: 7, timezone: 'Asia/Kolkata', to: today() });
    expect(res.body.members).toMatchObject({ total: 1, live: 1, new: 1, newPrevious: 0, emailVerified: 1, deleted: 0 });
    expect(res.body.members.byTrustTier).toEqual([{ tier: 'normal', members: 1 }]);
    expect(res.body.members.signupsByDay).toEqual([{ date: today(), members: 1 }]);
    // One phone, signed in, holding no push token and having reported nothing.
    expect(res.body.installs).toMatchObject({ total: 1, active: 1, signedIn: 1, new: 1, pushable: 0, reportingSteps: 0 });
    expect(res.body.installs.byPlatform).toEqual([{ platform: 'android', installs: 1, signedIn: 1 }]);
    expect(res.body.installs.byAppVersion).toEqual([{ appVersion: '1.0.0', installs: 1 }]);
    // The heartbeat: registering the device was a request, so the account is active today.
    expect(res.body.engagement).toMatchObject({ dau: 1, wau: 1, mau: 1, stickiness: 1 });
  });

  it('reads the trail as volume, screens and actions', async () => {
    const session = await signUpAndRegister();
    const at = new Date().toISOString();
    await request(app).post('/v1/events').set(authed(session)).send({
      events: [
        { name: 'screen_view', at, sessionId: 'ses_1', props: { screen: 'Home' } },
        { name: 'screen_view', at, sessionId: 'ses_1', props: { screen: 'Home' } },
        { name: 'screen_view', at, sessionId: 'ses_1', props: { screen: 'Shop' } },
        { name: 'water_logged', at, sessionId: 'ses_1', props: { ml: 250 } },
      ],
    });

    const res = await request(app).get('/v1/admin/analytics/overview').query({ days: 7 }).set(ADMIN);
    expect(res.body.engagement).toMatchObject({ events: 4, screenViews: 3, sessions: 1, trailMembers: 1 });
    expect(res.body.engagement.topScreens).toEqual([
      { screen: 'Home', views: 2, members: 1 },
      { screen: 'Shop', views: 1, members: 1 },
    ]);
    expect(res.body.engagement.topActions).toEqual([{ name: 'water_logged', count: 1, members: 1 }]);
    expect(res.body.engagement.byDay).toEqual([{ date: today(), events: 4, members: 1, sessions: 1 }]);
  });

  it('adds up the steps of the window and the share the layers verified', async () => {
    const session = await signUpAndRegister();
    const day = today();
    await ActivityDailyModel.create({
      _id: `${session.userId}:${day}`, userId: session.userId, localDay: day,
      steps: 12_000, verifiedSteps: 9_000, verified: true, distanceKm: 8.4, activeMinutes: 95,
      workoutsCompleted: 1, scoredAt: new Date(),
    });
    // A day outside the window must not reach the totals.
    await ActivityDailyModel.create({
      _id: `${session.userId}:2000-01-01`, userId: session.userId, localDay: '2000-01-01',
      steps: 8_000, verifiedSteps: 0, verified: false,
    });

    const res = await request(app).get('/v1/admin/analytics/overview').query({ days: 7 }).set(ADMIN);
    expect(res.body.activity).toMatchObject({
      days: 1, members: 1, steps: 12_000, verifiedSteps: 9_000, verifiedShare: 0.75,
      verifiedDays: 1, unverifiedDays: 0, avgStepsPerMemberDay: 12_000, workouts: 1,
    });
    expect(res.body.activity.byDay).toEqual([
      { date: day, members: 1, steps: 12_000, verifiedSteps: 9_000, verifiedDays: 1, unverifiedDays: 0 },
    ]);
  });

  it('reports the coins credited, the balance standing and what the orders took', async () => {
    const session = await signUpAndRegister();
    await credit({
      userId: session.userId, source: 'refund', referenceType: 'test', referenceId: 'fund',
      amount: 500, title: 'Test funds', localDay: today(), exemptFromCap: true,
    });
    await OrderModel.create({
      _id: 'ord_test', number: 'VKV1', userId: session.userId, status: 'placed',
      subtotal: 100_000, total: 100_000, payable: 70_000, coinsUsed: 300, coinsValue: 30_000,
      addressSnapshot: { name: 'Asha Verma', line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
    });

    const res = await request(app).get('/v1/admin/analytics/overview').query({ days: 7 }).set(ADMIN);
    expect(res.body.economy.coins).toMatchObject({ earned: 500, spent: 0, balance: 500, lifetimeEarned: 500, held: 0 });
    expect(res.body.economy.coins.bySource).toEqual([{ source: 'refund', coins: 500, rows: 1 }]);
    // Paise, as the order was placed (RULES R11), and the coins as coins.
    expect(res.body.economy.orders).toMatchObject({ count: 1, revenue: 70_000, aov: 70_000, coinsUsed: 300 });
    expect(res.body.economy.orders.byStatus).toEqual([{ status: 'placed', orders: 1, revenue: 70_000 }]);
  });

  it('counts the flags the layers raised, by verdict and by kind', async () => {
    const session = await signUpAndRegister();
    const day = today();
    await FraudFlagModel.create([
      { _id: 'flg_1', userId: session.userId, localDay: day, layer: 'L3', kind: 'impossible_cadence', severity: 'hard', status: 'open', lastSeenAt: new Date() },
      { _id: 'flg_2', userId: session.userId, localDay: day, layer: 'L1', kind: 'rooted_device', severity: 'soft', status: 'dismissed', lastSeenAt: new Date() },
    ]);

    const res = await request(app).get('/v1/admin/analytics/overview').query({ days: 7 }).set(ADMIN);
    expect(res.body.integrity).toMatchObject({
      raised: 2, open: 1, confirmed: 0, dismissed: 1, hard: 1, soft: 1, members: 1,
    });
    expect(res.body.integrity.byKind).toEqual(
      expect.arrayContaining([
        { kind: 'impossible_cadence', flags: 1, members: 1 },
        { kind: 'rooted_device', flags: 1, members: 1 },
      ]),
    );
  });

  it('lists the newest accounts for the arrivals strip', async () => {
    const first = await signUpAndRegister();
    const second = await signUpAndRegister();

    const res = await request(app).get('/v1/admin/analytics/signups').query({ limit: 2 }).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data.map((row: { id: string }) => row.id)).toEqual([second.userId, first.userId]);
    expect(res.body.data[0]).toMatchObject({ email: second.email, country: 'IN', trust: { tier: 'normal' } });
  });
});
