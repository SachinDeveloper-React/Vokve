import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { invalidateConfig } from '../src/config/remote.js';
import { addDays, localDayOf } from '../src/lib/dates.js';
import { ActivityDailyModel } from '../src/modules/activity/models.js';
import {
  ChallengeCompletionModel,
  ChallengeDefinitionModel,
  UserAchievementModel,
} from '../src/modules/challenges/models.js';
import { evaluateChallenges, periodOf } from '../src/modules/challenges/service.js';
import { CoinLedgerModel } from '../src/modules/economy/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { StreakDayModel } from '../src/modules/streak/models.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

const ZONE = 'Asia/Kolkata';
const today = () => localDayOf(new Date(), ZONE);

async function stepCoinsOn() {
  await AppConfigModel.updateOne({ _id: 'coins' }, { $set: { 'value.steps.enabled': true } }, { upsert: true });
  invalidateConfig();
}

async function day(session: Session, localDay: string, figures: Record<string, unknown>) {
  await ActivityDailyModel.updateOne(
    { _id: `${session.userId}:${localDay}` },
    { $set: { userId: session.userId, localDay, ...figures } },
    { upsert: true },
  );
}

async function board(session: Session, date?: string) {
  const res = await request(app).get(`/v1/challenges${date ? `?date=${date}` : ''}`).set(authed(session));
  expect(res.status).toBe(200);
  return res.body as { id: string; progress: number; startsAt: string | null; endsOn: string | null; completedAt: string | null }[];
}

const byId = <T extends { id: string }>(rows: T[]) => Object.fromEntries(rows.map(r => [r.id, r]));

describe('challenges: periods (RULES C6)', () => {
  it('runs a day, a Monday-to-Sunday week, and a calendar month', () => {
    expect(periodOf('daily', '2026-10-02')).toEqual({ start: '2026-10-02', end: '2026-10-02' });
    // 2 Oct 2026 is a Friday.
    expect(periodOf('weekly', '2026-10-02')).toEqual({ start: '2026-09-28', end: '2026-10-04' });
    expect(periodOf('weekly', '2026-10-04')).toEqual({ start: '2026-09-28', end: '2026-10-04' });
    expect(periodOf('weekly', '2026-10-05')).toEqual({ start: '2026-10-05', end: '2026-10-11' });
    expect(periodOf('monthly', '2026-02-14')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodOf('monthly', '2028-02-14')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });
});

describe('challenges: the board (GET /challenges)', () => {
  it('lists what is open with no progress yet, then what opens soonest', async () => {
    const session = await signUpAndRegister();
    const rows = await board(session);

    const running = rows.filter(r => r.startsAt === null);
    expect(running.map(r => r.id)).toEqual([
      'ch-10k-steps', 'ch-burn-500', 'ch-30-min-active', 'ch-week-step-master', 'ch-month-mover',
    ]);
    expect(running.every(r => r.progress === 0 && r.completedAt === null)).toBe(true);
    expect(byId(running)['ch-10k-steps'].endsOn).toBe(today());
    expect(byId(running)['ch-week-step-master'].endsOn).toBe(periodOf('weekly', today()).end);

    const upcoming = rows.filter(r => r.startsAt !== null);
    expect(upcoming.map(r => r.id)).toEqual([
      'ch-15k-steps', 'ch-7-day-consistency', 'ch-weekend-warrior', 'ch-monthly-marathon',
    ]);
    expect(upcoming[0].startsAt).toBe(addDays(today(), 1));
    expect(upcoming.every(r => r.endsOn === null)).toBe(true);
  });

  it('counts only verified activity, over the period the day falls in', async () => {
    const session = await signUpAndRegister();
    const yesterday = addDays(today(), -1);
    await day(session, today(), { verifiedSteps: 6_000, steps: 6_500, verified: true, activeMinutes: 40, caloriesBurned: 120, stepCalories: 200 });
    // Shown, never counted: an unverified day's minutes and walking calories.
    await day(session, yesterday, { verifiedSteps: 0, steps: 9_000, verified: false, activeMinutes: 70, caloriesBurned: 50, stepCalories: 300 });

    const rows = byId(await board(session));
    expect(rows['ch-10k-steps'].progress).toBe(6_000);
    expect(rows['ch-burn-500'].progress).toBe(320);
    expect(rows['ch-30-min-active'].progress).toBe(40);
    const sameWeek = periodOf('weekly', yesterday).start === periodOf('weekly', today()).start;
    expect(rows['ch-week-step-master'].progress).toBe(6_000);
    expect(rows['ch-month-mover'].progress).toBe(40);
    // Yesterday's own board shows yesterday's day.
    const past = byId(await board(session, yesterday));
    expect(past['ch-10k-steps'].progress).toBe(0);
    expect(past['ch-burn-500'].progress).toBe(50);
    expect(past['ch-week-step-master'].progress).toBe(sameWeek ? 6_000 : 0);
  });

  it('refuses a date it cannot read', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).get('/v1/challenges?date=yesterday').set(authed(session));
    expect(res.status).toBe(422);
  });
});

describe('challenges: completion (RULES C3, C4, D-46)', () => {
  it('records a step challenge reached while step coins are off, pays nothing, and still gives the badge', async () => {
    const session = await signUpAndRegister();
    await day(session, today(), { verifiedSteps: 10_400, steps: 10_400, verified: true });

    expect(await evaluateChallenges(session.userId, today(), ZONE)).toEqual(['ch-10k-steps']);
    expect(await ChallengeCompletionModel.findById(`${session.userId}:ch-10k-steps:${today()}`).lean())
      .toMatchObject({ status: 'unpaid', granted: 0, progress: 10_400, goal: 10_000 });
    expect(await CoinLedgerModel.countDocuments({ userId: session.userId, source: 'challenge' })).toBe(0);
    expect(await UserAchievementModel.findById(`${session.userId}:a-10k-steps`).lean()).not.toBeNull();
    const note = await NotificationModel.findOne({ userId: session.userId, title: '10K Steps Challenge complete! 🏆' }).lean();
    expect(note?.message).toBe('Goal reached. Coins for challenges like this start soon.');

    const rows = byId(await board(session));
    expect(rows['ch-10k-steps'].completedAt).toEqual(expect.any(String));
  });

  it('pays a step challenge once step coins are on — once per period, however often it is counted', async () => {
    const session = await signUpAndRegister();
    await stepCoinsOn();
    await day(session, today(), { verifiedSteps: 10_400, steps: 10_400, verified: true });

    await evaluateChallenges(session.userId, today(), ZONE);
    await evaluateChallenges(session.userId, today(), ZONE);

    const rows = await CoinLedgerModel.find({ userId: session.userId, source: 'challenge' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountMc: 200_000, referenceType: 'challenge', referenceId: `ch-10k-steps:${today()}`, title: '10K Steps Challenge completed' });
    expect(await ChallengeCompletionModel.findById(`${session.userId}:ch-10k-steps:${today()}`).lean())
      .toMatchObject({ status: 'paid', granted: 200 });
  });

  it('pays a workout challenge whatever step coins are doing', async () => {
    const session = await signUpAndRegister();
    await ChallengeDefinitionModel.updateOne({ _id: 'ch-weekend-warrior' }, { $set: { startsOn: null } });
    const workout = (id: string, minutesAgo: number) => ({
      id, title: 'Push Day', startedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      completedAt: new Date(Date.now() - (minutesAgo - 45) * 60_000).toISOString(),
      exercises: [{ id: 'we-1', exercise: { id: 'bench', name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell', isTimed: false, imageUrl: null },
        sets: [{ id: 's1', reps: 8, weightKg: 60, rpe: null, durationSeconds: null, completed: true }], restSeconds: 90, notes: null }],
      totalVolumeKg: 0, caloriesBurned: 0,
    });
    await request(app).post('/v1/workouts').set({ ...authed(session), 'idempotency-key': 'w1' }).send(workout('wk-1', 120));
    await request(app).post('/v1/workouts').set({ ...authed(session), 'idempotency-key': 'w2' }).send(workout('wk-2', 60));

    const completion = await ChallengeCompletionModel.findOne({ userId: session.userId, challengeId: 'ch-weekend-warrior' }).lean();
    expect(completion).toMatchObject({ status: 'paid', granted: 200, progress: 2 });
    expect(byId(await board(session))['ch-weekend-warrior']).toMatchObject({ progress: 2, completedAt: expect.any(String) });
  });

  it('counts goal days for a consistency challenge from the streak', async () => {
    const session = await signUpAndRegister();
    await ChallengeDefinitionModel.updateOne({ _id: 'ch-7-day-consistency' }, { $set: { startsOn: null } });
    const week = periodOf('weekly', today());
    await StreakDayModel.insertMany(
      [0, 1, 2].map(n => addDays(week.start, n)).map(d => ({ _id: `${session.userId}:${d}`, userId: session.userId, localDay: d, kind: 'earned', source: 'steps' })),
    );
    // A frozen day keeps a streak, but is not a goal day.
    const frozen = addDays(week.start, 3);
    await StreakDayModel.create({ _id: `${session.userId}:${frozen}`, userId: session.userId, localDay: frozen, kind: 'frozen', source: 'freeze' });

    expect(byId(await board(session))['ch-7-day-consistency'].progress).toBe(3);
  });
});

describe('achievements (GET /achievements, RULES C7)', () => {
  it('serves the shelf in order with numbers, unlocking by rule and by challenge', async () => {
    const session = await signUpAndRegister();
    let shelf = (await request(app).get('/v1/achievements').set(authed(session))).body;
    expect(shelf[0]).toEqual({ id: 'a-10k-steps', value: 10_000, label: '10K Steps', metric: 'steps', achievedAt: null });
    expect(shelf.every((a: { achievedAt: string | null }) => a.achievedAt === null)).toBe(true);

    // A 16K day: the 10K and 15K badges by their own rule; the challenge pays its badge too.
    await day(session, today(), { verifiedSteps: 16_000, steps: 16_000, verified: true });
    await evaluateChallenges(session.userId, today(), ZONE);

    shelf = (await request(app).get('/v1/achievements').set(authed(session))).body;
    const got = shelf.filter((a: { achievedAt: string | null }) => a.achievedAt !== null).map((a: { id: string }) => a.id);
    expect(got).toEqual(expect.arrayContaining(['a-10k-steps', 'a-15k-steps', 'a-first-challenge']));
    expect(got).not.toContain('a-20k-steps');
    // A challenge-only badge waits for its challenge.
    expect(got).not.toContain('a-step-master');
  });
});
