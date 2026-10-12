import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { invalidateConfig } from '../src/config/remote.js';
import { addDays, localDayOf } from '../src/lib/dates.js';
import { ActivityDailyModel } from '../src/modules/activity/models.js';
import { CoinBalanceModel, CoinLedgerModel } from '../src/modules/economy/models.js';
import { HydrationEntryModel } from '../src/modules/hydration/models.js';
import { credit } from '../src/modules/economy/service.js';
import { UserModel } from '../src/modules/identity/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { FoodEntryModel } from '../src/modules/nutrition/models.js';
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

describe('streak: the record (GET /streak/history)', () => {
  async function history(session: Session, query = '') {
    const res = await request(app).get(`/v1/streak/history${query}`).set(authed(session));
    expect(res.status).toBe(200);
    return res.body as {
      data: { date: string; day: number | null; status: string; detail: string; steps: number }[];
      nextCursor: string | null;
      total: number;
    };
  }

  async function walked(session: Session, day: string, steps: number) {
    await ActivityDailyModel.updateOne(
      { _id: `${session.userId}:${day}` },
      { $set: { userId: session.userId, localDay: day, verifiedSteps: steps, steps, verified: true } },
      { upsert: true },
    );
  }

  it('is empty for an account with no day on record', async () => {
    const session = await signUpAndRegister();
    expect(await history(session)).toEqual({ data: [], nextCursor: null, total: 0 });
  });

  it('numbers each day inside its own run, newest first, with the steps that carried it', async () => {
    const session = await signUpAndRegister();
    await earned(session, run(2, 0));
    await walked(session, today(), 10_428);
    await walked(session, ago(1), 8_932);

    const { data } = await history(session);
    expect(data.map(d => [d.date, d.day, d.status])).toEqual([
      [today(), 3, 'completed'],
      [ago(1), 2, 'completed'],
      [ago(2), 1, 'completed'],
    ]);
    expect(data[0].detail).toBe('10,428 steps');
    expect(data[1].detail).toBe('8,932 steps');
    // A day earned with no verified steps was earned some other way.
    expect(data[2].detail).toBe('Workout completed');
  });

  it('fills in the days that never counted, and starts the run again after one', async () => {
    const session = await signUpAndRegister();
    // Two days, a gap, then two more.
    await earned(session, [ago(4), ago(3), ago(1), today()]);
    await walked(session, ago(2), 3_100);

    const { data } = await history(session);
    expect(data.map(d => [d.date, d.day, d.status])).toEqual([
      [today(), 2, 'completed'],
      [ago(1), 1, 'completed'],
      [ago(2), null, 'missed'],
      [ago(3), 2, 'completed'],
      [ago(4), 1, 'completed'],
    ]);
    // A missed day still says what was walked on it.
    expect(data[2].detail).toBe('3,100 steps — short of your goal');
  });

  it('says a day with nothing on it had nothing on it', async () => {
    const session = await signUpAndRegister();
    await earned(session, [ago(2), today()]);

    const { data } = await history(session);
    expect(data[1]).toMatchObject({ date: ago(1), status: 'missed', detail: 'No activity', steps: 0 });
  });

  it('names a restored day with what the restore cost, and over how many days', async () => {
    const session = await signUpAndRegister();
    await fund(session, 500);
    // A run that ended three days ago: the gap a restore bridges is the two
    // days since (a restore revives a broken streak, not a live one — S6).
    await earned(session, run(5, 3));
    const res = await request(app).post('/v1/streak/restore').set({ ...authed(session), 'idempotency-key': 'r1' }).send();
    expect(res.status).toBe(200);

    const { data } = await history(session);
    const byDate = Object.fromEntries(data.map(d => [d.date, d]));
    expect(byDate[ago(2)]).toMatchObject({ status: 'restored', detail: 'Restored (50 coins for 2 days)' });
    expect(byDate[ago(1)]).toMatchObject({ status: 'restored', detail: 'Restored (50 coins for 2 days)' });
    // The restore joined the days into one run, so the numbering carries on.
    expect(byDate[ago(1)].day).toBe(5);
  });

  it('names one day and its cost when a restore bridged only one', async () => {
    const session = await signUpAndRegister();
    await fund(session, 500);
    await earned(session, run(4, 2));
    const res = await request(app).post('/v1/streak/restore').set({ ...authed(session), 'idempotency-key': 'r2' }).send();
    expect(res.status).toBe(200);

    const { data } = await history(session);
    expect(data.find(d => d.date === ago(1))).toMatchObject({
      status: 'restored',
      detail: 'Restored (50 coins)',
    });
  });

  it('marks a frozen day as frozen', async () => {
    const session = await signUpAndRegister();
    await earned(session, run(3, 1));
    await StreakStateModel.updateOne({ _id: session.userId }, { $set: { freezesAvailable: 2 } }, { upsert: true });
    const res = await request(app).post('/v1/streak/freeze').set({ ...authed(session), 'idempotency-key': 'f1' }).send();
    expect(res.status).toBe(200);

    const { data } = await history(session);
    expect(data[0]).toMatchObject({ date: today(), status: 'frozen', detail: 'Freeze used' });
  });

  it('pages back from today and stops at the first day that ever counted', async () => {
    const session = await signUpAndRegister();
    await earned(session, run(9, 0));

    const first = await history(session, '?limit=4');
    expect(first.data.map(d => d.date)).toEqual([today(), ago(1), ago(2), ago(3)]);
    expect(first.nextCursor).toBe(ago(3));
    expect(first.total).toBe(10);

    const second = await history(session, `?limit=4&cursor=${first.nextCursor}`);
    expect(second.data.map(d => d.date)).toEqual([ago(4), ago(5), ago(6), ago(7)]);

    const last = await history(session, `?limit=4&cursor=${second.nextCursor}`);
    expect(last.data.map(d => d.date)).toEqual([ago(8), ago(9)]);
    expect(last.nextCursor).toBeNull();
  });

  it('refuses a cursor or a page size it cannot read', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get('/v1/streak/history?cursor=yesterday').set(authed(session))).status).toBe(422);
    expect((await request(app).get('/v1/streak/history?limit=500').set(authed(session))).status).toBe(422);
  });
});

describe('streak: one day (GET /streak/day)', () => {
  async function day(session: Session, date: string) {
    const res = await request(app).get(`/v1/streak/day?date=${date}`).set(authed(session));
    expect(res.status).toBe(200);
    return res.body as {
      date: string;
      today: string;
      status: string;
      title: string;
      detail: string;
      day: number | null;
      run: { length: number; start: string; end: string } | null;
      counted: boolean;
      steps: number;
      stepGoal: number;
      goalMet: boolean;
      metrics: { id: string; label: string; value: string; caption: string | null }[];
      coinsEarned: number;
      note: string | null;
      previousDate: string | null;
      nextDate: string | null;
    };
  }

  async function walked(session: Session, localDay: string, steps: number, extra: Record<string, unknown> = {}) {
    await ActivityDailyModel.updateOne(
      { _id: `${session.userId}:${localDay}` },
      { $set: { userId: session.userId, localDay, verifiedSteps: steps, steps, verified: true, ...extra } },
      { upsert: true },
    );
  }

  it('says which day of the current run it was, with the steps read against the goal', async () => {
    const session = await signUpAndRegister();
    await earned(session, run(2, 0));
    await walked(session, ago(1), 10_428, { distanceKm: 7.2, activeMinutes: 64, stepCalories: 311, workoutsCompleted: 1 });

    const result = await day(session, ago(1));
    expect(result).toMatchObject({
      date: ago(1),
      today: today(),
      status: 'completed',
      title: 'Day 2 of your current streak',
      detail: '10,428 steps',
      day: 2,
      counted: true,
      steps: 10_428,
      stepGoal: 10_000,
      goalMet: true,
      note: null,
    });
    expect(result.run).toEqual({ length: 3, start: ago(2), end: today() });
    expect(result.metrics.map(m => [m.id, m.value])).toEqual([
      ['distance', '7.2 km'],
      ['activeMinutes', '64 min'],
      ['calories', '311 kcal'],
      ['workouts', '1'],
    ]);
  });

  it('numbers a day inside a run that has since broken by that run, not by the live one', async () => {
    const session = await signUpAndRegister();
    // A three-day run that ended five days ago, and a fresh day today.
    await earned(session, [ago(7), ago(6), ago(5), today()]);

    expect(await day(session, ago(6))).toMatchObject({
      title: 'Day 2 of a 3-day run',
      day: 2,
      run: { length: 3, start: ago(7), end: ago(5) },
    });
  });

  it('words a missed day and offers the restore while the gap is still inside the window', async () => {
    const session = await signUpAndRegister();
    // A run that ended three days ago: the two days since are the restore gap (S6).
    await earned(session, run(5, 3));
    await walked(session, ago(2), 3_100);

    expect(await day(session, ago(2))).toMatchObject({
      status: 'missed',
      title: 'Day missed',
      detail: '3,100 steps — short of your goal',
      day: null,
      run: null,
      counted: false,
      goalMet: false,
      note: 'A restore would bring this day back for 50 coins.',
    });
  });

  it('tells a missed day outside the gap what would have counted it', async () => {
    const session = await signUpAndRegister();
    await earned(session, [ago(9), today()]);

    expect(await day(session, ago(8))).toMatchObject({
      status: 'missed',
      detail: 'No activity',
      note: 'Finish a workout or walk 10,000 steps in a day.',
    });
  });

  it('names a frozen day as the record does', async () => {
    const session = await signUpAndRegister();
    await earned(session, run(3, 1));
    await StreakStateModel.updateOne({ _id: session.userId }, { $set: { freezesAvailable: 2 } }, { upsert: true });
    expect((await request(app).post('/v1/streak/freeze').set({ ...authed(session), 'idempotency-key': 'fd1' }).send()).status).toBe(200);

    expect(await day(session, today())).toMatchObject({
      status: 'frozen',
      detail: 'Freeze used',
      counted: true,
      title: 'Day 4 of your current streak',
    });
  });

  it('names a restored day with what the restore cost, and counts the debit against the day', async () => {
    const session = await signUpAndRegister();
    await fund(session, 500);
    await earned(session, run(5, 3));
    expect((await request(app).post('/v1/streak/restore').set({ ...authed(session), 'idempotency-key': 'rd1' }).send()).status).toBe(200);

    const result = await day(session, ago(1));
    expect(result).toMatchObject({ status: 'restored', detail: 'Restored (50 coins for 2 days)', counted: true });
    // The restore was debited today, so it is today's coin figure that carries it.
    expect((await day(session, today())).coinsEarned).toBe(450);
  });

  it('stops paging at the first day on record and at today', async () => {
    const session = await signUpAndRegister();
    await earned(session, run(2, 0));

    expect(await day(session, ago(2))).toMatchObject({ previousDate: null, nextDate: ago(1) });
    expect(await day(session, today())).toMatchObject({ previousDate: ago(1), nextDate: null });
  });

  it('calls a day that has not happened upcoming, with nothing on it', async () => {
    const session = await signUpAndRegister();
    await earned(session, [today()]);

    expect(await day(session, addDays(today(), 1))).toMatchObject({
      status: 'upcoming',
      title: 'Still to come',
      counted: false,
      metrics: [],
      note: null,
      nextDate: null,
    });
  });

  it('adds the water and the food logged that day to the figures', async () => {
    const session = await signUpAndRegister();
    await earned(session, [today()]);
    await HydrationEntryModel.create({
      _id: `${session.userId}:w1`, userId: session.userId, clientId: 'w1', ml: 600, at: new Date(), localDay: today(),
    });
    await FoodEntryModel.create({
      _id: `${session.userId}:f1`, userId: session.userId, clientId: 'f1', slot: 'lunch', name: 'Dal and rice',
      calories: 540, loggedAt: new Date(), localDay: today(),
    });

    const result = await day(session, today());
    expect(result.metrics.find(m => m.id === 'water')).toMatchObject({ value: '600 ml', caption: 'Goal 2,500 ml' });
    expect(result.metrics.find(m => m.id === 'food')).toMatchObject({ value: '540 kcal', caption: '1 item logged' });
  });

  it('refuses a date it cannot read', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get('/v1/streak/day?date=yesterday').set(authed(session))).status).toBe(422);
    expect((await request(app).get('/v1/streak/day').set(authed(session))).status).toBe(422);
  });
});

describe("streak: the day's log (GET /streak/day/events)", () => {
  async function events(session: Session, date: string, query = '') {
    const res = await request(app).get(`/v1/streak/day/events?date=${date}${query}`).set(authed(session));
    expect(res.status).toBe(200);
    return res.body as {
      data: { id: string; kind: string; title: string; detail: string | null; at: string | null; coins: number | null }[];
      nextCursor: string | null;
      total: number;
    };
  }

  it('is empty for a day nothing happened on', async () => {
    const session = await signUpAndRegister();
    expect(await events(session, ago(3))).toEqual({ data: [], nextCursor: null, total: 0 });
  });

  it('lists what decided the day beside the coins, the water and the food', async () => {
    const session = await signUpAndRegister();
    await ActivityDailyModel.updateOne(
      { _id: `${session.userId}:${today()}` },
      { $set: { userId: session.userId, localDay: today(), verifiedSteps: 11_200, steps: 11_200, verified: true } },
      { upsert: true },
    );
    await earned(session, [today()]);
    await fund(session, 120);
    await HydrationEntryModel.create({
      _id: `${session.userId}:w2`, userId: session.userId, clientId: 'w2', ml: 250, at: new Date(), localDay: today(),
    });
    await FoodEntryModel.create({
      _id: `${session.userId}:f2`, userId: session.userId, clientId: 'f2', slot: 'breakfast', name: 'Poha',
      calories: 310, loggedAt: new Date(), localDay: today(),
    });

    const { data, total } = await events(session, today());
    expect(total).toBe(4);
    const byKind = Object.fromEntries(data.map(row => [row.kind, row]));
    expect(byKind.streak).toMatchObject({ title: 'Step goal reached', detail: '11,200 steps' });
    expect(byKind.coins).toMatchObject({ title: 'Test funds', detail: 'Refund', coins: 120 });
    expect(byKind.water).toMatchObject({ title: '250 ml of water' });
    expect(byKind.meal).toMatchObject({ title: 'Poha', detail: 'Breakfast · 310 kcal' });
    // Newest first: every row here was written in the same breath, so only the
    // order being stable matters — the dated ones all carry a time.
    expect(data.every(row => row.at !== null)).toBe(true);
  });

  it('pages the log and stops when the last row is out', async () => {
    const session = await signUpAndRegister();
    for (let i = 0; i < 5; i++) {
      await HydrationEntryModel.create({
        _id: `${session.userId}:p${i}`, userId: session.userId, clientId: `p${i}`, ml: 200 + i,
        at: new Date(Date.now() - i * 60_000), localDay: today(),
      });
    }

    const first = await events(session, today(), '&limit=2');
    expect(first.data).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(first.nextCursor).toBe('2');

    const second = await events(session, today(), `&limit=2&cursor=${first.nextCursor}`);
    expect(second.data).toHaveLength(2);
    expect(second.nextCursor).toBe('4');

    const last = await events(session, today(), `&limit=2&cursor=${second.nextCursor}`);
    expect(last.data).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    // Every row, once, across the three pages.
    const ids = [...first.data, ...second.data, ...last.data].map(row => row.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('refuses a cursor or a page size it did not give', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get(`/v1/streak/day/events?date=${today()}&cursor=${today()}`).set(authed(session))).status).toBe(422);
    expect((await request(app).get(`/v1/streak/day/events?date=${today()}&limit=500`).set(authed(session))).status).toBe(422);
  });
});
