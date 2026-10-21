import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ActivityDailyModel, StepUploadModel } from '../src/modules/activity/models.js';
import { OrderModel } from '../src/modules/commerce/models.js';
import { UserAchievementModel } from '../src/modules/challenges/models.js';
import { credit } from '../src/modules/economy/service.js';
import { CoinLedgerModel } from '../src/modules/economy/models.js';
import { UserModel } from '../src/modules/identity/models.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());

const dayAgo = (back: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() - back * 86_400_000));

/** Steps through the dev route, which scores and credits the day as the rollup would. */
async function walk(session: Session, steps: number, date?: string) {
  const res = await request(app).post('/v1/dev/steps').set(authed(session)).send({ steps, date });
  if (res.status !== 200) throw new Error(`dev/steps: ${JSON.stringify(res.body)}`);
}

async function placeOrder(userId: string, id: string, overrides: Record<string, unknown> = {}) {
  return OrderModel.create({
    _id: id,
    number: `VKV${id}`,
    userId,
    status: 'placed',
    subtotal: 120_000,
    discount: 0,
    shipping: 0,
    total: 120_000,
    payable: 90_000,
    coinsUsed: 300,
    coinsValue: 30_000,
    items: [
      { itemId: 'cap', title: 'VOKVE Cap', quantity: 1, price: 60_000, coinsUsed: 150, coinsValue: 15_000, moneyPaid: 45_000 },
      { itemId: 'bottle', title: 'VOKVE Bottle', quantity: 1, price: 60_000, coinsUsed: 150, coinsValue: 15_000, moneyPaid: 45_000 },
    ],
    addressSnapshot: { id: 'adr_1', label: 'Home', name: 'Asha Verma', phone: '+919876543210', line1: '12 MG Road', line2: '', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', country: 'IN', isDefault: true },
    payment: { provider: 'mock', method: 'upi', status: 'paid', amount: 90_000, paidAt: new Date() },
    events: [{ from: null, to: 'placed', actor: 'user', at: new Date() }],
    ...overrides,
  });
}

describe('admin: what a member has walked', () => {
  it('answers the admin key alone', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get(`/v1/admin/users/${session.userId}/steps`)).status).toBe(401);
  });

  it('gives the days, the totals, and whether each hit the goal they set', async () => {
    const session = await signUpAndRegister();
    await request(app).put('/v1/me/settings').set(authed(session)).send({ dailyStepGoal: 9000 });
    await walk(session, 12_000);
    await walk(session, 4000, dayAgo(1));

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps`).query({ days: 7 }).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.window).toMatchObject({ to: today(), days: 2, timezone: 'Asia/Kolkata' });
    expect(res.body.goal).toBe(9000);
    expect(res.body.totals).toMatchObject({
      steps: 16_000,
      verifiedSteps: 16_000,
      verifiedShare: 1,
      verifiedDays: 2,
      goalDays: 1,
      averageSteps: 8000,
    });
    expect(res.body.totals.bestDay).toMatchObject({ localDay: today(), steps: 12_000 });
    // Newest first in `data`, oldest first in `byDay` so a chart reads left to right.
    expect(res.body.data[0]).toMatchObject({ localDay: today(), steps: 12_000, goalHit: true, verified: true });
    expect(res.body.byDay[0].localDay).toBe(dayAgo(1));
    expect(res.body.streak).toMatchObject({ current: expect.any(Number), longest: expect.any(Number) });
  });

  it('takes a window, and leaves out what falls outside it', async () => {
    const session = await signUpAndRegister();
    await walk(session, 5000, dayAgo(10));
    await walk(session, 6000);

    const week = await request(app).get(`/v1/admin/users/${session.userId}/steps`).query({ days: 7 }).set(ADMIN);
    expect(week.body.totals.steps).toBe(6000);

    const fortnight = await request(app).get(`/v1/admin/users/${session.userId}/steps`).query({ days: 14 }).set(ADMIN);
    expect(fortnight.body.totals.steps).toBe(11_000);

    const named = await request(app)
      .get(`/v1/admin/users/${session.userId}/steps`)
      .query({ from: dayAgo(10), to: dayAgo(10) })
      .set(ADMIN);
    expect(named.body.totals.steps).toBe(5000);
  });

  it('404s for an account that does not exist', async () => {
    expect((await request(app).get('/v1/admin/users/usr_nobody/steps').set(ADMIN)).status).toBe(404);
  });
});

describe('admin: the coin ledger', () => {
  it('reads the balance, the totals by source and the rows behind them', async () => {
    const session = await signUpAndRegister();
    await credit({
      userId: session.userId, source: 'workout', referenceType: 'test', referenceId: 'w1',
      amount: 100, title: 'Workout', localDay: today(),
    });
    await credit({
      userId: session.userId, source: 'referral', referenceType: 'test', referenceId: 'r1',
      amount: 20, title: 'Referral', localDay: today(),
    });

    const wallet = await request(app).get(`/v1/admin/users/${session.userId}/wallet`).set(ADMIN);
    expect(wallet.status).toBe(200);
    expect(wallet.body.balance).toMatchObject({ coins: 120, lifetimeEarned: 120 });
    expect(wallet.body.balance.expiresAt).not.toBeNull();
    expect(wallet.body.totals).toMatchObject({ earned: 120, spent: 0, rows: 2 });
    expect(wallet.body.bySource).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'workout', earned: 100, rows: 1 }),
        expect.objectContaining({ source: 'referral', earned: 20, rows: 1 }),
      ]),
    );
    // The daily ceiling, day by day: what it let through.
    expect(wallet.body.dailyCaps[0]).toMatchObject({ localDay: today(), earned: 120 });
    expect(wallet.body.rate).toMatchObject({ dailyCap: 300 });

    const ledger = await request(app).get(`/v1/admin/users/${session.userId}/ledger`).set(ADMIN);
    expect(ledger.body.data).toHaveLength(2);
    expect(ledger.body.data[0]).toMatchObject({ amount: 20, source: 'referral', actor: 'system', referenceType: 'test' });
  });

  it('filters the rows by direction and by source, and pages them', async () => {
    const session = await signUpAndRegister();
    await credit({
      userId: session.userId, source: 'refund', referenceType: 'test', referenceId: 'fund',
      amount: 500, title: 'Test funds', localDay: today(), exemptFromCap: true,
    });
    await CoinLedgerModel.create({
      _id: 'led_spend', userId: session.userId, amountMc: -200_000, source: 'purchase',
      title: 'Cap', referenceType: 'order', referenceId: 'ord_1', actor: 'user',
    });

    const out = await request(app).get(`/v1/admin/users/${session.userId}/ledger`).query({ direction: 'out' }).set(ADMIN);
    expect(out.body.data).toHaveLength(1);
    expect(out.body.data[0]).toMatchObject({ amount: -200, source: 'purchase', actor: 'user' });

    const inbound = await request(app).get(`/v1/admin/users/${session.userId}/ledger`).query({ direction: 'in' }).set(ADMIN);
    expect(inbound.body.data).toHaveLength(1);

    const bySource = await request(app).get(`/v1/admin/users/${session.userId}/ledger`).query({ source: 'purchase' }).set(ADMIN);
    expect(bySource.body.data).toHaveLength(1);

    const firstPage = await request(app).get(`/v1/admin/users/${session.userId}/ledger`).query({ limit: 1 }).set(ADMIN);
    expect(firstPage.body.nextCursor).not.toBeNull();
    const second = await request(app)
      .get(`/v1/admin/users/${session.userId}/ledger`)
      .query({ limit: 1, cursor: firstPage.body.nextCursor })
      .set(ADMIN);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.data[0].id).not.toBe(firstPage.body.data[0].id);
  });
});

describe('admin: badges and the challenges that pay them', () => {
  it('shows the whole shelf, with their own unlocks on it', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).get(`/v1/admin/users/${session.userId}/achievements`).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.badges.length).toBeGreaterThan(0);
    expect(res.body.summary).toMatchObject({ unlocked: 0, total: res.body.badges.length, rewardsEnabled: false });
    expect(res.body.badges[0]).toMatchObject({ unlocked: false, unlockedAt: null });

    const badge = res.body.badges[0];
    await UserAchievementModel.create({
      _id: `${session.userId}:${badge.id}`,
      userId: session.userId,
      achievementId: badge.id,
      achievedAt: new Date(),
      via: 'best_day_steps',
    });

    const after = await request(app).get(`/v1/admin/users/${session.userId}/achievements`).set(ADMIN);
    expect(after.body.summary.unlocked).toBe(1);
    const held = after.body.badges.find((row: { id: string }) => row.id === badge.id);
    expect(held).toMatchObject({ unlocked: true, via: 'best_day_steps' });
    expect(held.unlockedAt).not.toBeNull();
    // Badge coins wait on their own switch, and the read says what is owed.
    expect(after.body.summary.coinsWaiting).toBe(held.rewardCoins);
  });
});

describe('admin: orders', () => {
  it('lists what they bought with the totals, and one order in full', async () => {
    const session = await signUpAndRegister();
    await placeOrder(session.userId, 'ord_a');
    await placeOrder(session.userId, 'ord_b', { status: 'cancelled', payable: 10_000, coinsUsed: 0 });

    const list = await request(app).get(`/v1/admin/users/${session.userId}/orders`).set(ADMIN);
    expect(list.status).toBe(200);
    expect(list.body.totals).toMatchObject({ orders: 2, payable: 100_000, coinsUsed: 300, cancelled: 1 });
    expect(list.body.data[0]).toMatchObject({ id: 'ord_b', status: 'cancelled', items: 2, firstItem: 'VOKVE Cap' });

    const filtered = await request(app).get(`/v1/admin/users/${session.userId}/orders`).query({ status: 'placed' }).set(ADMIN);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].id).toBe('ord_a');

    const detail = await request(app).get('/v1/admin/orders/ord_a').set(ADMIN);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ number: 'VKVord_a', status: 'placed' });
    expect(detail.body.member).toMatchObject({ id: session.userId, email: session.email });
    // Paise as placed, coins as coins (RULES R11).
    expect(detail.body.money).toMatchObject({ payable: 90_000, coinsUsed: 300, coinsValue: 30_000 });
    expect(detail.body.items).toHaveLength(2);
    expect(detail.body.items[0]).toMatchObject({ title: 'VOKVE Cap', moneyPaid: 45_000, coinsUsed: 150 });
    expect(detail.body.address).toMatchObject({ city: 'Bengaluru' });
    expect(detail.body.events[0]).toMatchObject({ to: 'placed', actor: 'user' });

    expect((await request(app).get('/v1/admin/orders/ord_nothing').set(ADMIN)).status).toBe(404);
  });
});

describe('admin: the account’s own state', () => {
  it('freezes and unfreezes, with a reason, and keeps the receipt', async () => {
    const session = await signUpAndRegister();

    const noReason = await request(app).put(`/v1/admin/users/${session.userId}/status`).set(ADMIN).send({ frozen: true });
    expect(noReason.status).toBe(422);

    const frozen = await request(app)
      .put(`/v1/admin/users/${session.userId}/status`)
      .set(ADMIN)
      .send({ frozen: true, legalHold: true, reason: 'chargeback dispute' });
    expect(frozen.status).toBe(200);
    expect(frozen.body).toMatchObject({ frozen: true, legalHold: true });
    expect((await UserModel.findById(session.userId).lean())?.flags?.frozen).toBe(true);

    const back = await request(app)
      .put(`/v1/admin/users/${session.userId}/status`)
      .set(ADMIN)
      .send({ frozen: false, reason: 'dispute closed' });
    expect(back.body).toMatchObject({ frozen: false, legalHold: true });

    // The receipt carries both verdicts — and the member's own actions on the
    // account too, which is the point: one list of everything done to it.
    const audit = await request(app).get(`/v1/admin/users/${session.userId}/audit`).set(ADMIN);
    expect(audit.body.data[0]).toMatchObject({ action: 'member.status', actorType: 'admin', after: { reason: 'dispute closed' } });
    expect(audit.body.data.filter((row: { action: string }) => row.action === 'member.status')).toHaveLength(2);
    expect(audit.body.data.some((row: { actorType: string }) => row.actorType === 'user')).toBe(true);
  });

  it('credits coins as a new row, and claws them back as another', async () => {
    const session = await signUpAndRegister();

    const given = await request(app)
      .post(`/v1/admin/users/${session.userId}/coins`)
      .set(ADMIN)
      .send({ amount: 250, title: 'Goodwill credit', reason: 'ticket 412 — order arrived broken' });
    expect(given.status).toBe(201);
    expect(given.body).toMatchObject({ direction: 'credit', amount: 250, balance: 250 });

    const taken = await request(app)
      .post(`/v1/admin/users/${session.userId}/coins`)
      .set(ADMIN)
      .send({ amount: -100, title: 'Clawback', reason: 'confirmed fraud on 2026-10-14' });
    expect(taken.status).toBe(201);
    expect(taken.body).toMatchObject({ direction: 'clawback', amount: 100, balance: 150 });

    // Both are rows the member can see, with the operator named on them.
    const ledger = await request(app).get(`/v1/admin/users/${session.userId}/ledger`).set(ADMIN);
    expect(ledger.body.data[0]).toMatchObject({ amount: -100, title: 'Clawback', actor: 'admin', referenceType: 'admin_adjustment' });
    expect(ledger.body.data[1]).toMatchObject({ amount: 250, title: 'Goodwill credit', actor: 'admin' });

    // The member's own wallet reads the same figure.
    const mine = await request(app).get('/v1/wallet').set(authed(session));
    expect(mine.body.balance).toBe(150);
  });

  it('refuses a clawback bigger than the balance, and says what it holds', async () => {
    const session = await signUpAndRegister();
    await request(app)
      .post(`/v1/admin/users/${session.userId}/coins`)
      .set(ADMIN)
      .send({ amount: 50, title: 'Goodwill', reason: 'late delivery' });

    const res = await request(app)
      .post(`/v1/admin/users/${session.userId}/coins`)
      .set(ADMIN)
      .send({ amount: -500, title: 'Clawback', reason: 'too much' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.amount).toContain('50');

    const wallet = await request(app).get(`/v1/admin/users/${session.userId}/wallet`).set(ADMIN);
    expect(wallet.body.balance.coins).toBe(50);
  });

  it('refuses an adjustment too big for this panel to decide', async () => {
    const session = await signUpAndRegister();
    const res = await request(app)
      .post(`/v1/admin/users/${session.userId}/coins`)
      .set(ADMIN)
      .send({ amount: 50_000, title: 'Oops', reason: 'fat finger' });
    expect(res.status).toBe(422);
  });
});

describe('admin: finding the account', () => {
  it('filters by state and tier, sorts, pages, and says how many match', async () => {
    const first = await signUpAndRegister();
    const second = await signUpAndRegister();
    await request(app).put(`/v1/admin/users/${first.userId}/status`).set(ADMIN).send({ frozen: true, reason: 'test' });

    const all = await request(app).get('/v1/admin/users').set(ADMIN);
    expect(all.body.total).toBe(2);
    expect(all.body.data[0].id).toBe(second.userId); // newest first
    expect(all.body.data[0]).toMatchObject({ frozen: false, deleted: false, country: 'IN' });

    const frozen = await request(app).get('/v1/admin/users').query({ status: 'frozen' }).set(ADMIN);
    expect(frozen.body.total).toBe(1);
    expect(frozen.body.data[0]).toMatchObject({ id: first.userId, frozen: true });

    const oldest = await request(app).get('/v1/admin/users').query({ sort: 'oldest' }).set(ADMIN);
    expect(oldest.body.data[0].id).toBe(first.userId);

    const android = await request(app).get('/v1/admin/users').query({ platform: 'android' }).set(ADMIN);
    expect(android.body.total).toBe(2);
    const ios = await request(app).get('/v1/admin/users').query({ platform: 'ios' }).set(ADMIN);
    expect(ios.body.total).toBe(0);

    const page = await request(app).get('/v1/admin/users').query({ limit: 1, offset: 1 }).set(ADMIN);
    expect(page.body).toMatchObject({ total: 2, offset: 1, limit: 1 });
    expect(page.body.data[0].id).toBe(first.userId);

    const unverified = await request(app).get('/v1/admin/users').query({ status: 'unverified' }).set(ADMIN);
    // No SMS provider in tests, so every phone is unverified (D-31).
    expect(unverified.body.total).toBe(2);

    const watch = await request(app).get('/v1/admin/users').query({ tier: 'watch' }).set(ADMIN);
    expect(watch.body.total).toBe(0);
  });
});

/**
 * A day as the rollup leaves it when a watch answered for it: the phone
 * counted its own steps, Samsung Health wrote more, and the scoring took the
 * watch. Written straight in, because the question under test is what the
 * admin read makes of a *stored* decision — the scoring's own is covered by
 * `fraud.test.ts` and `ingest.test.ts`.
 */
async function scoredDay(
  userId: string,
  deviceId: string,
  localDay: string,
  options: {
    steps: number;
    phoneSteps: number;
    /** The source that answered, or none at all: then the phone's own count did. */
    winner?: { packageName: string; appName: string; steps: number; kind?: string; isWearable?: boolean; status?: string };
    /** Another app that wrote the day and was not believed. */
    also?: { packageName: string; appName: string; steps: number; status?: string };
  },
) {
  const sources = [
    ...(options.winner
      ? [{
          packageName: options.winner.packageName,
          appName: options.winner.appName,
          kind: options.winner.kind ?? 'watch',
          isWearable: options.winner.isWearable ?? true,
          isPlatform: false,
          steps: options.winner.steps,
          manualSteps: 0,
          unknownMethodSteps: 0,
          countable: options.winner.steps,
          ratioToPhone: options.phoneSteps > 0 ? options.winner.steps / options.phoneSteps : null,
          standing: 'allowed',
          status: options.winner.status ?? 'used',
        }]
      : []),
    ...(options.also
      ? [{
          packageName: options.also.packageName,
          appName: options.also.appName,
          kind: 'app',
          isWearable: false,
          isPlatform: false,
          steps: options.also.steps,
          manualSteps: 0,
          unknownMethodSteps: 0,
          countable: options.also.steps,
          ratioToPhone: null,
          standing: 'unknown',
          status: options.also.status ?? 'unverified',
        }]
      : []),
  ];
  await ActivityDailyModel.updateOne(
    { _id: `${userId}:${localDay}` },
    {
      $setOnInsert: { _id: `${userId}:${localDay}`, userId, localDay },
      $set: {
        steps: options.steps,
        verifiedSteps: options.steps,
        pedometerSteps: options.phoneSteps,
        verified: true,
        source: options.winner ? 'health_connect' : 'device',
        deviceCount: 1,
        scoredAt: new Date(),
        breakdown: {
          bestDeviceId: deviceId,
          union: { phones: options.phoneSteps, verified: options.phoneSteps, added: false },
          devices: [{
            deviceId,
            phone: { counted: options.phoneSteps, recovered: 0, flagged: 0, clean: options.phoneSteps },
            candidate: options.steps,
            source: options.winner ? 'health_connect' : 'device',
            winner: options.winner?.packageName ?? null,
            shown: { steps: options.steps, packageName: options.winner?.packageName ?? null },
            verified: true,
            verifiedSteps: options.steps,
            displaySteps: options.steps,
            plausibility: 90,
            layers: {},
            hard: [],
            sources,
            sourcesStatus: 'read',
            signedAt: Date.now(),
            proof: { key: null, play: null },
          }],
        },
      },
    },
    { upsert: true },
  );
}

describe('admin: which source a member’s steps came from (D-51)', () => {
  it('names the source each day’s figure came from, and what the other apps wrote beside it', async () => {
    const session = await signUpAndRegister();
    await scoredDay(session.userId, session.deviceId, today(), {
      steps: 9000,
      phoneSteps: 4000,
      winner: { packageName: 'com.sec.android.app.shealth', appName: 'Samsung Health', steps: 9000 },
      also: { packageName: 'com.fake.steps', appName: 'Step Booster', steps: 40_000 },
    });

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps`).query({ days: 7 }).set(ADMIN);
    expect(res.status).toBe(200);
    const day = res.body.data[0];
    expect(day.source).toBe('health_connect');
    expect(day.sourceApp).toMatchObject({
      key: 'com.sec.android.app.shealth',
      appName: 'Samsung Health',
      isWearable: true,
      answered: true,
      status: 'used',
    });
    // The answering source first, then by what each wrote; the phone's own
    // counter is a source like any other and carries its own count.
    expect(day.sources.map((source: { key: string }) => source.key)).toEqual([
      'com.sec.android.app.shealth',
      'com.fake.steps',
      'phone',
    ]);
    expect(day.sources.find((source: { key: string }) => source.key === 'phone')).toMatchObject({
      appName: 'Phone step counter',
      steps: 4000,
      answered: false,
    });
    expect(day.sources.find((source: { key: string }) => source.key === 'com.fake.steps')).toMatchObject({
      status: 'unverified',
      steps: 40_000,
      answered: false,
    });
    expect(day.devices[0]).toMatchObject({
      name: 'Google Pixel 8',
      source: 'health_connect',
      winner: 'com.sec.android.app.shealth',
      sourcesStatus: 'read',
    });
  });

  it('totals the window by source: what answered, and what only wrote', async () => {
    const session = await signUpAndRegister();
    await scoredDay(session.userId, session.deviceId, today(), {
      steps: 9000,
      phoneSteps: 4000,
      winner: { packageName: 'com.sec.android.app.shealth', appName: 'Samsung Health', steps: 9000 },
    });
    // The watch wrote this day too and was not believed, so the phone answered.
    await scoredDay(session.userId, session.deviceId, dayAgo(1), {
      steps: 5000,
      phoneSteps: 5000,
      also: { packageName: 'com.sec.android.app.shealth', appName: 'Samsung Health', steps: 60_000, status: 'not_counted' },
    });

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps`).query({ days: 7 }).set(ADMIN);
    const bySource = res.body.bySource as Record<string, unknown>[];
    expect(bySource.map(row => row.key)).toEqual(['com.sec.android.app.shealth', 'phone']);
    expect(bySource[0]).toMatchObject({
      appName: 'Samsung Health',
      // Only the day it answered for pays; the day it was refused does not.
      steps: 9000,
      daysAnswered: 1,
      days: 2,
      wrote: 69_000,
      lastDay: today(),
      lastStatus: 'used',
    });
    expect(bySource[1]).toMatchObject({ key: 'phone', steps: 5000, daysAnswered: 1, days: 2, wrote: 9000 });
  });

  it('says what the last steps came from, and when the phone sent them', async () => {
    const session = await signUpAndRegister();
    await scoredDay(session.userId, session.deviceId, dayAgo(1), { steps: 7000, phoneSteps: 7000 });
    // Today is a row with no steps in it — the last *steps* are yesterday's.
    await scoredDay(session.userId, session.deviceId, today(), { steps: 0, phoneSteps: 0 });
    await StepUploadModel.create({
      _id: `upl_${session.deviceId}_${dayAgo(1)}`,
      userId: session.userId,
      deviceId: session.deviceId,
      localDay: dayAgo(1),
      payloadSha256: 'sha-last-steps',
      keyId: 'key_1',
      signedAt: new Date(),
      appVersion: '1.4.0',
      receivedAt: new Date(),
    });

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps`).query({ days: 7 }).set(ADMIN);
    expect(res.body.last).toMatchObject({
      localDay: dayAgo(1),
      steps: 7000,
      source: 'device',
      deviceName: 'Google Pixel 8',
      appVersion: '1.4.0',
    });
    expect(res.body.last.app).toMatchObject({ key: 'phone', appName: 'Phone step counter', answered: true });
    expect(res.body.last.syncedAt).not.toBeNull();
  });

  it('invents nothing for a day that was never scored', async () => {
    const session = await signUpAndRegister();
    await walk(session, 6000);

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps`).query({ days: 7 }).set(ADMIN);
    // The dev route writes a day without a breakdown; nothing then claims to
    // know where it came from.
    expect(res.body.data[0]).toMatchObject({ steps: 6000, sourceApp: null, sources: [], phonesAdded: false });
    expect(res.body.bySource).toEqual([]);
    expect(res.body.last).toMatchObject({ localDay: today(), app: null });
  });
});
