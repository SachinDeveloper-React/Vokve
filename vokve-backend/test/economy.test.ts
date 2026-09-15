import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { invalidateConfig } from '../src/config/remote.js';
import { CoinBalanceModel, CoinLedgerModel } from '../src/modules/economy/models.js';
import { credit, debit, hold, release } from '../src/modules/economy/service.js';
import { expireIdleWallets } from '../src/modules/economy/wallet.service.js';
import { runDailyJobs } from '../src/jobs/scheduler.js';
import { app, authed, signUpAndRegister } from './helpers.js';

const DAY = '2026-09-14';

async function setCoinConfig(patch: Record<string, unknown>) {
  await AppConfigModel.updateOne({ _id: 'coins' }, { $set: { value: patch } }, { upsert: true });
  invalidateConfig();
}

describe('economy: ledger, daily cap, escrow', () => {
  it('pays an event once, refuses the second workout by source cap, and never exceeds the daily ceiling', async () => {
    const { userId } = await signUpAndRegister();

    const a = await credit({ userId, source: 'workout', referenceType: 'workout', referenceId: 'w1', amount: 100, title: 'Push Day completed', localDay: DAY });
    expect(a).toMatchObject({ status: 'credited', granted: 100 });

    const again = await credit({ userId, source: 'workout', referenceType: 'workout', referenceId: 'w1', amount: 100, title: 'Push Day completed', localDay: DAY });
    expect(again.status).toBe('already_done');

    // sourceCaps.workout = 100 → a second workout that day earns nothing.
    const b = await credit({ userId, source: 'workout', referenceType: 'workout', referenceId: 'w2', amount: 100, title: 'Leg Day completed', localDay: DAY });
    expect(b).toMatchObject({ status: 'cap_reached', granted: 0, capped: 100 });

    // sourceCaps.steps = 200 → a 250-coin step hold is partially granted (RULES E8b) and counts toward the day (E8a).
    const s = await hold({ userId, source: 'steps', referenceType: 'activity_day', referenceId: DAY, amount: 250, title: 'steps', localDay: DAY }, null);
    expect(s).toMatchObject({ status: 'held', granted: 200, capped: 50 });

    // Day total is now 300 = dailyCap → anything else is refused.
    const streak = await credit({ userId, source: 'streak', referenceType: 'streak_milestone', referenceId: '7', amount: 50, title: '7 day streak', localDay: DAY });
    expect(streak.status).toBe('cap_reached');

    // Refunds are exempt (E8d).
    const refund = await credit({ userId, source: 'refund', referenceType: 'order', referenceId: 'o1', amount: 25, title: 'Order cancelled', localDay: DAY, exemptFromCap: true });
    expect(refund.status).toBe('credited');

    const bal = await CoinBalanceModel.findById(userId).lean();
    expect(bal).toMatchObject({ balanceMc: 125_000, pendingMc: 200_000, lifetimeEarnedMc: 125_000 });

    // Release moves escrow into the ledger and the balance.
    expect(await release(s.holdId!)).toBe('released');
    const after = await CoinBalanceModel.findById(userId).lean();
    expect(after).toMatchObject({ balanceMc: 325_000, pendingMc: 0, lifetimeEarnedMc: 325_000 });

    // balance = Σ ledger (RULES E3)
    const sum = (await CoinLedgerModel.find({ userId }).lean()).reduce((t, r) => t + r.amountMc, 0);
    expect(sum).toBe(after!.balanceMc);
  });

  it('holds the ceiling under concurrency: 30 parallel credits of 30 coins grant exactly 300', async () => {
    const { userId } = await signUpAndRegister();
    await setCoinConfig({ dailyCap: 300, sourceCaps: { challenge: 300, steps: 200, workout: 100, streak: 300, referral: 300 } });

    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        credit({ userId, source: 'challenge', referenceType: 'challenge', referenceId: `c${i}`, amount: 30, title: `Challenge ${i}`, localDay: DAY }),
      ),
    );
    const granted = results.reduce((t, r) => t + r.granted, 0);
    expect(granted).toBe(300);
    expect(results.filter(r => r.status === 'credited')).toHaveLength(10);
    expect(results.filter(r => r.status === 'cap_reached')).toHaveLength(20);

    const bal = await CoinBalanceModel.findById(userId).lean();
    expect(bal!.balanceMc).toBe(300_000);
  });

  it('a lower configured cap applies immediately, with partial grants', async () => {
    const { userId } = await signUpAndRegister();
    await setCoinConfig({ dailyCap: 250, sourceCaps: { challenge: 250, steps: 200, workout: 100, streak: 250, referral: 250 } });

    const first = await credit({ userId, source: 'challenge', referenceType: 'challenge', referenceId: 'x', amount: 200, title: 'X', localDay: DAY });
    const second = await credit({ userId, source: 'challenge', referenceType: 'challenge', referenceId: 'y', amount: 100, title: 'Y', localDay: DAY });
    expect(first.granted).toBe(200);
    expect(second).toMatchObject({ granted: 50, capped: 50, status: 'credited' });
    const row = await CoinLedgerModel.findOne({ userId, referenceId: 'y' }).lean();
    expect(row!.title).toBe('Y (daily limit reached)');
  });

  it('refuses a debit the balance cannot cover, with the shortfall in details', async () => {
    const { userId } = await signUpAndRegister();
    await credit({ userId, source: 'workout', referenceType: 'workout', referenceId: 'w', amount: 100, title: 'W', localDay: DAY });
    await expect(debit({ userId, source: 'purchase', referenceType: 'order', referenceId: 'o', amount: 150, title: 'Bottle' }))
      .rejects.toMatchObject({ status: 422, code: 'INSUFFICIENT_COINS', details: { required: 150, balance: 100 } });
    const ok = await debit({ userId, source: 'purchase', referenceType: 'order', referenceId: 'o', amount: 60, title: 'Bottle' });
    expect(ok.balance).toBe(40);
    const twice = await debit({ userId, source: 'purchase', referenceType: 'order', referenceId: 'o', amount: 60, title: 'Bottle' });
    expect(twice.balance).toBe(40); // idempotent
  });

  it('steps pay 0.095 per 100 into escrow and the wallet shows pending, earnedToday and remainingToday', async () => {
    const session = await signUpAndRegister();
    const first = await request(app).post('/v1/dev/steps').set(authed(session)).send({ steps: 20_000 });
    expect(first.status).toBe(200);
    expect(first.body.result).toMatchObject({ status: 'held', granted: 19 });

    const more = await request(app).post('/v1/dev/steps').set(authed(session)).send({ steps: 25_000 });
    expect(more.body.result).toMatchObject({ status: 'held', granted: 4.75 });

    const same = await request(app).post('/v1/dev/steps').set(authed(session)).send({ steps: 25_000 });
    expect(same.body.result.status).toBe('already_done');

    const wallet = await request(app).get('/v1/wallet').set(authed(session));
    expect(wallet.status).toBe(200);
    expect(wallet.body).toMatchObject({ balance: 0, pending: 23.75, dailyCap: 300, earnedToday: 23.75, remainingToday: 276.25 });

    const rules = await request(app).get('/v1/wallet/earn-rules').set(authed(session));
    expect(rules.body.data[0]).toMatchObject({ source: 'steps', reward: 0.095 });
  });

  it('a saved workout pays through the same cap and returns the client Workout shape', async () => {
    const session = await signUpAndRegister();
    const startedAt = new Date(Date.now() - 45 * 60_000).toISOString();
    const workout = {
      id: 'wk-1', title: 'Push Day', startedAt, completedAt: new Date().toISOString(),
      exercises: [{ id: 'we-1', exercise: { id: 'bench', name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell', isTimed: false, imageUrl: null },
        sets: [{ id: 's1', reps: 8, weightKg: 60, rpe: null, durationSeconds: null, completed: true }], restSeconds: 90, notes: null }],
      totalVolumeKg: 999, caloriesBurned: 999,
    };
    const saved = await request(app).post('/v1/workouts').set({ ...authed(session), 'idempotency-key': 'k1' }).send(workout);
    expect(saved.status).toBe(200);
    expect(saved.body.totalVolumeKg).toBe(480); // recomputed, client's 999 ignored
    expect(JSON.parse(saved.headers['x-vokve-reward'])).toMatchObject({ status: 'credited', granted: 100 });

    const replay = await request(app).post('/v1/workouts').set({ ...authed(session), 'idempotency-key': 'k1' }).send(workout);
    expect(replay.status).toBe(200);

    const wallet = await request(app).get('/v1/wallet').set(authed(session));
    expect(wallet.body.balance).toBe(100);

    const history = await request(app).get('/v1/workouts').set(authed(session));
    expect(history.body).toMatchObject({ data: [{ id: 'wk-1' }], nextCursor: null });

    const short = await request(app).post('/v1/workouts').set(authed(session)).send({ ...workout, id: 'wk-2', startedAt: new Date(Date.now() - 60_000).toISOString() });
    expect(JSON.parse(short.headers['x-vokve-reward'] ?? 'null')).toBeNull(); // implausible: < 10 min → no pay
  });

  it('the ledger pages by cursor, newest first, and filters by source', async () => {
    const session = await signUpAndRegister();
    const userId = session.userId;
    // Five rows across three sources, written in order so the ids (uuid v7) sort by time.
    for (let i = 1; i <= 3; i += 1) {
      await credit({ userId, source: 'challenge', referenceType: 'challenge', referenceId: `c${i}`, amount: 10, title: `Challenge ${i}`, localDay: DAY });
    }
    await credit({ userId, source: 'workout', referenceType: 'workout', referenceId: 'w1', amount: 100, title: 'Push Day completed', localDay: DAY });
    await debit({ userId, source: 'purchase', referenceType: 'order', referenceId: 'o1', amount: 25, title: 'Sticker pack' });

    // Page 1: the two newest, and a cursor for the rest.
    const first = await request(app).get('/v1/wallet/transactions').query({ limit: 2 }).set(authed(session));
    expect(first.status).toBe(200);
    expect(first.body.data.map((r: { title: string }) => r.title)).toEqual(['Sticker pack', 'Push Day completed']);
    expect(first.body.data[0].amount).toBe(-25); // signed, as the client's row expects
    expect(first.body.nextCursor).toBe(first.body.data[1].id);

    // Page 2 starts where page 1 stopped; nothing is repeated or skipped.
    const second = await request(app).get('/v1/wallet/transactions').query({ limit: 2, cursor: first.body.nextCursor }).set(authed(session));
    expect(second.body.data.map((r: { title: string }) => r.title)).toEqual(['Challenge 3', 'Challenge 2']);
    expect(second.body.nextCursor).not.toBeNull();

    const third = await request(app).get('/v1/wallet/transactions').query({ limit: 2, cursor: second.body.nextCursor }).set(authed(session));
    expect(third.body.data.map((r: { title: string }) => r.title)).toEqual(['Challenge 1']);
    expect(third.body.nextCursor).toBeNull();

    // A source filter is applied before paging, so the cursor is scoped to it.
    const challenges = await request(app).get('/v1/wallet/transactions').query({ source: 'challenge', limit: 2 }).set(authed(session));
    expect(challenges.body.data).toHaveLength(2);
    expect(challenges.body.data.every((r: { source: string }) => r.source === 'challenge')).toBe(true);
    const restOfChallenges = await request(app).get('/v1/wallet/transactions').query({ source: 'challenge', cursor: challenges.body.nextCursor }).set(authed(session));
    expect(restOfChallenges.body.data.map((r: { title: string }) => r.title)).toEqual(['Challenge 1']);
    expect(restOfChallenges.body.nextCursor).toBeNull();

    // An unknown source is a validation error, not an empty list.
    const bad = await request(app).get('/v1/wallet/transactions').query({ source: 'lottery' }).set(authed(session));
    expect(bad.status).toBe(422);

    // The wallet's own summary agrees with the rows: 130 earned, 25 spent, this month.
    const wallet = await request(app).get('/v1/wallet').set(authed(session));
    expect(wallet.body.monthSummary).toEqual({ earned: 130, spent: 25, net: 105 });
    expect(wallet.body.balance).toBe(105);
  });
});

describe('economy: idle expiry (RULES E9–E11)', () => {
  const DAYS = 86_400_000;

  it('the wallet reports the window, the date and the warn thresholds', async () => {
    const session = await signUpAndRegister();

    // Never earned: nothing to expire, so the full window and no date (E11).
    const empty = await request(app).get('/v1/wallet').set(authed(session));
    expect(empty.body).toMatchObject({ expiresAt: null, expiryDaysLeft: 90, expiryWindowDays: 90, expiryWarnDays: [14, 3] });

    // Earned 10 days ago: 80 days left, and a date 90 days after the credit.
    await credit({ userId: session.userId, source: 'workout', referenceType: 'workout', referenceId: 'w1', amount: 100, title: 'Push Day', localDay: DAY });
    const tenDaysAgo = new Date(Date.now() - 10 * DAYS);
    await CoinBalanceModel.updateOne({ _id: session.userId }, { $set: { lastCreditAt: tenDaysAgo } });

    const wallet = await request(app).get('/v1/wallet').set(authed(session));
    expect(wallet.body.expiryDaysLeft).toBe(80); // whole days idle off the window, as the client counted it
    expect(new Date(wallet.body.expiresAt).getTime()).toBe(tenDaysAgo.getTime() + 90 * DAYS);
  });

  it('zeroes an idle wallet with one refund row, once, and leaves active wallets alone', async () => {
    const idle = await signUpAndRegister();
    const active = await signUpAndRegister();
    for (const s of [idle, active]) {
      await credit({ userId: s.userId, source: 'workout', referenceType: 'workout', referenceId: 'w1', amount: 100, title: 'Push Day', localDay: DAY });
    }
    await CoinBalanceModel.updateOne({ _id: idle.userId }, { $set: { lastCreditAt: new Date(Date.now() - 91 * DAYS) } });
    await CoinBalanceModel.updateOne({ _id: active.userId }, { $set: { lastCreditAt: new Date(Date.now() - 89 * DAYS) } });

    const first = await expireIdleWallets();
    expect(first).toMatchObject({ expired: 1, coins: 100, skipped: 0 });

    // The idle wallet: empty, explained by the ledger, and back to the full window (E11).
    const swept = await request(app).get('/v1/wallet').set(authed(idle));
    expect(swept.body).toMatchObject({ balance: 0, lifetimeEarned: 100, expiresAt: null, expiryDaysLeft: 90 });
    const rows = await request(app).get('/v1/wallet/transactions').set(authed(idle));
    expect(rows.body.data[0]).toMatchObject({ source: 'refund', amount: -100, title: 'Coins expired after 90 days of inactivity' });
    const ledger = await CoinLedgerModel.find({ userId: idle.userId }).lean();
    expect(ledger.reduce((sum, r) => sum + r.amountMc, 0)).toBe(0);

    // The active wallet: untouched, one day from the edge.
    const kept = await request(app).get('/v1/wallet').set(authed(active));
    expect(kept.body).toMatchObject({ balance: 100, expiryDaysLeft: 1 });

    // Running again does nothing: no second row, no negative balance.
    const again = await expireIdleWallets();
    expect(again).toMatchObject({ expired: 0, coins: 0 });
    expect(await CoinLedgerModel.countDocuments({ userId: idle.userId, source: 'refund' })).toBe(1);

    // Earning again restarts the clock from zero. A challenge, not a second
    // workout: the per-source cap would pay that one nothing today (E8c).
    await credit({ userId: idle.userId, source: 'challenge', referenceType: 'challenge', referenceId: 'c1', amount: 100, title: '10K steps', localDay: DAY });
    const revived = await request(app).get('/v1/wallet').set(authed(idle));
    expect(revived.body).toMatchObject({ balance: 100, expiryDaysLeft: 90 });
    expect(revived.body.expiresAt).not.toBeNull();
  });

  it('the sweep can be moved forward in time from the dev route, and the daily runner claims each day once', async () => {
    const session = await signUpAndRegister();
    await credit({ userId: session.userId, source: 'workout', referenceType: 'workout', referenceId: 'w1', amount: 50, title: 'Push Day', localDay: DAY });

    // Not idle today, so a plain sweep leaves it.
    const now = await request(app).post('/v1/dev/jobs/coin-expiry').set(authed(session)).send({});
    expect(now.status).toBe(200);
    expect(now.body.expired).toBe(0);

    // Idle as of 91 days from now.
    const later = new Date(Date.now() + 91 * DAYS).toISOString();
    const future = await request(app).post('/v1/dev/jobs/coin-expiry').set(authed(session)).send({ now: later });
    expect(future.body).toMatchObject({ expired: 1, coins: 50 });

    // The runner claims the day: a second call in the same day is a no-op.
    const other = await signUpAndRegister();
    await credit({ userId: other.userId, source: 'workout', referenceType: 'workout', referenceId: 'w1', amount: 70, title: 'Push Day', localDay: DAY });
    await CoinBalanceModel.updateOne({ _id: other.userId }, { $set: { lastCreditAt: new Date(Date.now() - 100 * DAYS) } });
    const runDay = new Date('2030-01-01T00:00:00Z');
    await runDailyJobs(runDay);
    expect((await CoinBalanceModel.findById(other.userId).lean())?.balanceMc).toBe(0);
    await credit({ userId: other.userId, source: 'challenge', referenceType: 'challenge', referenceId: 'c1', amount: 70, title: '10K steps', localDay: DAY });
    await CoinBalanceModel.updateOne({ _id: other.userId }, { $set: { lastCreditAt: new Date(Date.now() - 100 * DAYS) } });
    await runDailyJobs(runDay);
    expect((await CoinBalanceModel.findById(other.userId).lean())?.balanceMc).toBe(70_000); // claimed already: not swept
  });
});
