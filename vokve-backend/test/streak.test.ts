import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { invalidateConfig } from '../src/config/remote.js';
import { addDays, localDayOf } from '../src/lib/dates.js';
import { CoinBalanceModel, CoinLedgerModel } from '../src/modules/economy/models.js';
import { credit } from '../src/modules/economy/service.js';
import { UserModel } from '../src/modules/identity/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { StreakDayModel, StreakStateModel } from '../src/modules/streak/models.js';
import {
  currentStreakOf,
  longestStreakOf,
  markEarned,
  restoreGapOf,
  warnStreaksAtRisk,
} from '../src/modules/streak/service.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

const ZONE = 'Asia/Kolkata';
const today = () => localDayOf(new Date(), ZONE);
const ago = (n: number) => addDays(today(), -n);

/** Days `from` to `to` days ago, inclusive, oldest first. */
const run = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => ago(from - i));

async function earned(session: Session, days: string[], source: 'workout' | 'steps' = 'steps') {
  await StreakDayModel.insertMany(
    days.map(day => ({ _id: `${session.userId}:${day}`, userId: session.userId, localDay: day, kind: 'earned', source })),
  );
}

async function fund(session: Session, coins: number) {
  await credit({
    userId: session.userId, source: 'refund', referenceType: 'test', referenceId: `fund-${coins}`,
    amount: coins, title: 'Test funds', localDay: today(), exemptFromCap: true,
  });
}

async function streak(session: Session) {
  const res = await request(app).get('/v1/streak').set(authed(session));
  expect(res.status).toBe(200);
  return res.body;
}

async function setStreakConfig(value: Record<string, unknown>) {
  await AppConfigModel.updateOne({ _id: 'streak' }, { $set: { value } }, { upsert: true });
  invalidateConfig();
}

/** Step coins on — the end of shadow mode, when step-earned milestones pay (D-46). */
async function stepCoinsOn() {
  await AppConfigModel.updateOne({ _id: 'coins' }, { $set: { 'value.steps.enabled': true } }, { upsert: true });
  invalidateConfig();
}

function workout(id: string) {
  return {
    id, title: 'Push Day', startedAt: new Date(Date.now() - 45 * 60_000).toISOString(), completedAt: new Date().toISOString(),
    exercises: [{ id: 'we-1', exercise: { id: 'bench', name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell', isTimed: false, imageUrl: null },
      sets: [{ id: 's1', reps: 8, weightKg: 60, rpe: null, durationSeconds: null, completed: true }], restSeconds: 90, notes: null }],
    totalVolumeKg: 0, caloriesBurned: 0,
  };
}

describe('streak: the rules (RULES S2, S3, S6 — the client golden suite)', () => {
  const TODAY = '2025-05-26';
  const d = (n: number) => addDays(TODAY, -n);
  const days = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => d(from - i));

  it('counts back from today, survives until the day it needs is over, and breaks after', () => {
    expect(currentStreakOf(new Set(days(6, 0)), TODAY)).toBe(7);
    expect(currentStreakOf(new Set(days(6, 1)), TODAY)).toBe(6);
    expect(currentStreakOf(new Set(days(8, 2)), TODAY)).toBe(0);
    expect(currentStreakOf(new Set(), TODAY)).toBe(0);
  });

  it('finds the record across a gap, with its dates, whatever the order', () => {
    expect(longestStreakOf(new Set([...days(25, 11), ...days(6, 0)]))).toEqual({ length: 15, start: d(25), end: d(11) });
    expect(longestStreakOf(new Set([TODAY]))).toEqual({ length: 1, start: TODAY, end: TODAY });
    expect(longestStreakOf(new Set())).toBeNull();
    expect(longestStreakOf(new Set([d(0), d(2), d(1)]))?.length).toBe(3);
  });

  it('bridges only a recent gap, and only when the streak is broken', () => {
    expect(restoreGapOf(new Set(days(6, 0)), TODAY, 7)).toEqual([]);
    expect(restoreGapOf(new Set(days(10, 3)), TODAY, 7)).toEqual([d(2), d(1)]);
    expect(restoreGapOf(new Set(days(20, 12)), TODAY, 7)).toEqual([]);
  });
});

describe('streak: GET /streak', () => {
  it('starts a new member with nothing counted, one freeze, and the rules in a sentence', async () => {
    const session = await signUpAndRegister();
    const body = await streak(session);
    expect(body).toMatchObject({
      today: today(),
      currentStreak: 0,
      longestStreak: null,
      completedDays: [],
      protectedDays: [],
      freezesAvailable: 1,
      maxFreezes: 3,
      todayCovered: false,
      todayFrozen: false,
      canRestore: false,
      restoreGap: [],
      restoreCostCoins: 50,
      restoreWindowDays: 7,
      nextMilestone: { days: 7, coins: 50, achieved: false, paid: false },
      howToEarn: 'Finish a workout or walk 10,000 steps in a day.',
    });
    expect(body.milestones.map((m: { days: number }) => m.days)).toEqual([7, 15, 30, 90, 180]);
  });

  it('draws the figures and the calendar from the same days', async () => {
    const session = await signUpAndRegister();
    await earned(session, [...run(25, 11), ...run(6, 0)]);

    const body = await streak(session);
    expect(body).toMatchObject({
      currentStreak: 7,
      longestStreak: { length: 15, start: ago(25), end: ago(11) },
      todayCovered: true,
      nextMilestone: { days: 15 },
    });
    expect(body.completedDays).toHaveLength(22);
    expect(body.milestones.filter((m: { achieved: boolean }) => m.achieved).map((m: { days: number }) => m.days)).toEqual([7, 15]);
  });
});

describe('streak: earning a day (RULES S1, W6, D-44)', () => {
  it('a plausible workout earns its day, once', async () => {
    const session = await signUpAndRegister();
    const w = workout('wk-1');
    const day = localDayOf(new Date(w.startedAt), ZONE);

    await request(app).post('/v1/workouts').set({ ...authed(session), 'idempotency-key': 'w1' }).send(w);
    await request(app).post('/v1/workouts').set({ ...authed(session), 'idempotency-key': 'w1b' }).send(w);

    const body = await streak(session);
    expect(body.completedDays).toEqual([day]);
    expect(await StreakDayModel.findById(`${session.userId}:${day}`).lean()).toMatchObject({ kind: 'earned', source: 'workout', referenceId: 'wk-1' });
    expect((await UserModel.findById(session.userId).lean())?.streakDays).toBeGreaterThanOrEqual(day === today() ? 1 : 0);
  });

  it('steps count only where the config says so', async () => {
    const session = await signUpAndRegister();
    await setStreakConfig({ earnedBy: { workout: true, stepGoal: false } });
    expect(await markEarned(session.userId, today(), 'steps', ZONE)).toBe(false);
    expect((await streak(session)).howToEarn).toBe('Finish a workout in a day.');

    await setStreakConfig({ earnedBy: { workout: true, stepGoal: true } });
    expect(await markEarned(session.userId, today(), 'steps', ZONE)).toBe(true);
    expect(await markEarned(session.userId, today(), 'workout', ZONE)).toBe(false);
    expect((await streak(session)).completedDays).toEqual([today()]);
  });

  it('a frozen day that is then earned counts as earned, and keeps how it was protected', async () => {
    const session = await signUpAndRegister();
    const frozen = await request(app).post('/v1/streak/freeze').set(authed(session));
    expect(frozen.body).toMatchObject({ todayFrozen: true, freezesAvailable: 0 });

    expect(await markEarned(session.userId, today(), 'steps', ZONE)).toBe(true);
    const body = await streak(session);
    expect(body).toMatchObject({ completedDays: [today()], protectedDays: [], todayFrozen: false, todayCovered: true });
    expect(await StreakDayModel.findById(`${session.userId}:${today()}`).lean()).toMatchObject({ kind: 'earned', protectedBy: 'freeze' });
  });

  it('holds step-earned milestone coins while step coins are off, and pays them once they are on', async () => {
    const session = await signUpAndRegister();
    await earned(session, run(6, 1));
    await markEarned(session.userId, today(), 'steps', ZONE);
    expect(await CoinLedgerModel.countDocuments({ userId: session.userId, source: 'streak' })).toBe(0);
    expect((await streak(session)).milestones[0]).toEqual({ days: 7, coins: 50, achieved: true, paid: false });

    await stepCoinsOn();
    await markEarned(session.userId, ago(30), 'steps', ZONE);
    expect((await streak(session)).milestones[0]).toMatchObject({ achieved: true, paid: true });
  });

  it('pays a milestone once, judged against the longest run, and says so', async () => {
    const session = await signUpAndRegister();
    await stepCoinsOn();
    await earned(session, run(6, 1));
    await markEarned(session.userId, today(), 'steps', ZONE);
    // Recounting changes nothing.
    await markEarned(session.userId, ago(20), 'steps', ZONE);

    const rows = await CoinLedgerModel.find({ userId: session.userId, source: 'streak' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountMc: 50_000, referenceType: 'streak_milestone', referenceId: '7', title: '7-day streak' });
    expect(await NotificationModel.countDocuments({ userId: session.userId, topic: 'streak', title: '7-day streak! 🔥' })).toBe(1);

    const body = await streak(session);
    expect(body.milestones[0]).toEqual({ days: 7, coins: 50, achieved: true, paid: true });
  });

  it('grants a freeze for every 30 days of one run, up to the most that can be held', async () => {
    const session = await signUpAndRegister();
    await earned(session, run(29, 1));
    await markEarned(session.userId, today(), 'steps', ZONE);
    expect((await streak(session)).freezesAvailable).toBe(2);

    // The same run recounted grants nothing more.
    await markEarned(session.userId, ago(45), 'workout', ZONE);
    expect((await StreakStateModel.findById(session.userId).lean())?.freezesAvailable).toBe(2);
  });

  it('a grant at the most held is not banked for later', async () => {
    const session = await signUpAndRegister();
    await StreakStateModel.create({ _id: session.userId, freezesAvailable: 3, freezeGrantKeys: [] });
    await earned(session, run(29, 1));
    await markEarned(session.userId, today(), 'steps', ZONE);

    await StreakStateModel.updateOne({ _id: session.userId }, { $set: { freezesAvailable: 1 } });
    await markEarned(session.userId, ago(40), 'steps', ZONE);
    expect((await StreakStateModel.findById(session.userId).lean())?.freezesAvailable).toBe(1);
  });
});

describe('streak: freeze (RULES S4)', () => {
  it('covers today with one freeze, and refuses a second with nothing spent', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).post('/v1/streak/freeze').set(authed(session));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ protectedDays: [today()], todayCovered: true, todayFrozen: true, freezesAvailable: 0 });

    const again = await request(app).post('/v1/streak/freeze').set(authed(session));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('STREAK_ALREADY_COVERED');
  });

  it('is not spent on a day already earned', async () => {
    const session = await signUpAndRegister();
    await earned(session, [today()]);
    const res = await request(app).post('/v1/streak/freeze').set(authed(session));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STREAK_ALREADY_COVERED');
    expect((await streak(session)).freezesAvailable).toBe(1);
  });

  it('is refused when none are left', async () => {
    const session = await signUpAndRegister();
    await StreakStateModel.create({ _id: session.userId, freezesAvailable: 0, freezeGrantKeys: [] });
    const res = await request(app).post('/v1/streak/freeze').set(authed(session));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_FREEZES_LEFT');
    expect(await StreakDayModel.countDocuments({ userId: session.userId })).toBe(0);
  });
});

describe('streak: restore (RULES S6, S7, E13)', () => {
  it('bridges the gap for 50 coins, debited as streak, in one go', async () => {
    const session = await signUpAndRegister();
    await earned(session, run(5, 3));
    await fund(session, 120);

    const res = await request(app).post('/v1/streak/restore').set({ ...authed(session), 'idempotency-key': 'r1' });
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(70);
    expect(res.body.streak).toMatchObject({ currentStreak: 5, protectedDays: [ago(2), ago(1)], canRestore: false });

    const debit = await CoinLedgerModel.findOne({ userId: session.userId, referenceType: 'streak_restore' }).lean();
    expect(debit).toMatchObject({ source: 'streak', amountMc: -50_000, referenceId: ago(3), title: 'Streak restored' });

    // The same request again is answered, not charged.
    const replay = await request(app).post('/v1/streak/restore').set({ ...authed(session), 'idempotency-key': 'r1' });
    expect(replay.body.balance).toBe(70);
    expect((await CoinBalanceModel.findById(session.userId).lean())?.balanceMc).toBe(70_000);
  });

  it('a revived run that reaches a milestone is paid for it, and the balance says so', async () => {
    const session = await signUpAndRegister();
    await stepCoinsOn();
    await earned(session, run(10, 3));
    await fund(session, 100);

    const res = await request(app).post('/v1/streak/restore').set(authed(session));
    expect(res.body.streak).toMatchObject({ currentStreak: 10, milestones: [{ days: 7, achieved: true, paid: true }, expect.anything(), expect.anything(), expect.anything(), expect.anything()] });
    // 100 − 50 for the restore + 50 for reaching seven days.
    expect(res.body.balance).toBe(100);
  });

  it('protects nothing when the coins are not there', async () => {
    const session = await signUpAndRegister();
    await earned(session, run(10, 3));
    await fund(session, 20);

    const res = await request(app).post('/v1/streak/restore').set(authed(session));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_COINS', details: { required: 50, balance: 20 } });
    expect(await StreakDayModel.countDocuments({ userId: session.userId, kind: 'restored' })).toBe(0);
  });

  it('has nothing to restore while the streak is alive, or once the gap is too old', async () => {
    const alive = await signUpAndRegister();
    await earned(alive, run(3, 0));
    const a = await request(app).post('/v1/streak/restore').set(authed(alive));
    expect(a.status).toBe(422);
    expect(a.body.error).toMatchObject({ code: 'NOTHING_TO_RESTORE', message: 'Your streak is intact. Keep it going!' });

    const old = await signUpAndRegister();
    await earned(old, run(20, 12));
    const b = await request(app).post('/v1/streak/restore').set(authed(old));
    expect(b.body.error).toMatchObject({ code: 'NOTHING_TO_RESTORE', message: 'Your last streak ended too long ago to bring back.' });
  });
});

describe('streak: the evening nudge (RULES S10)', () => {
  it('warns a live streak not yet covered, once, in its own 19:00', async () => {
    const at = new Date('2026-10-02T13:45:00Z'); // 19:15 in Kolkata
    const day = localDayOf(at, ZONE);
    const live = await signUpAndRegister();
    const covered = await signUpAndRegister();
    for (const session of [live, covered]) {
      await StreakDayModel.insertMany([1, 2].map(n => ({
        _id: `${session.userId}:${addDays(day, -n)}`, userId: session.userId, localDay: addDays(day, -n), kind: 'earned', source: 'steps',
      })));
    }
    await StreakDayModel.create({ _id: `${covered.userId}:${day}`, userId: covered.userId, localDay: day, kind: 'earned', source: 'steps' });

    expect(await warnStreaksAtRisk(at)).toEqual({ warned: 1 });
    expect(await warnStreaksAtRisk(at)).toEqual({ warned: 0 });
    const note = await NotificationModel.findOne({ userId: live.userId, topic: 'streak' }).lean();
    expect(note?.message).toContain('Your 2-day streak ends at midnight.');

    // Any other hour, nobody.
    expect(await warnStreaksAtRisk(new Date('2026-10-02T10:00:00Z'))).toEqual({ warned: 0 });
  });
});
