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
import { daysBetween } from '../src/modules/streak/rules.js';
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

describe('challenges: one in full (GET /challenges/:id)', () => {
  async function detail(session: Session, id: string, date?: string) {
    const res = await request(app).get(`/v1/challenges/${id}${date ? `?date=${date}` : ''}`).set(authed(session));
    expect(res.status).toBe(200);
    return res.body;
  }

  it('serves the board row, the day inside the period, and the rule sheet', async () => {
    const session = await signUpAndRegister();
    await day(session, today(), { verifiedSteps: 7_842, steps: 7_842, verified: true });

    const body = await detail(session, 'ch-week-step-master');
    const week = periodOf('weekly', today());

    expect(body.challenge).toMatchObject({ id: 'ch-week-step-master', goal: 70_000, progress: 7_842, cadence: 'weekly' });
    expect(body.period).toMatchObject({ start: week.start, end: week.end, days: 7 });
    expect(body.period.day).toBe(daysBetween(week.start, today()) + 1);

    // A week of 70,000 steps is a 10,000-step day, and today's figure is what the ring counts.
    expect(body.focus).toMatchObject({ scope: 'today', label: 'Daily Goal', value: 7_842, target: 10_000, remaining: 2_158 });
    expect(Date.parse(body.focus.endsAt)).toBeGreaterThan(Date.now());

    expect(body.reward).toMatchObject({ coins: 800, caption: 'Finish the week to earn' });
    expect(body.reward.badge).toMatchObject({ id: 'a-step-master', label: 'Step Master', achievedAt: null });

    expect(body.rules.map((r: { id: string }) => r.id)).toEqual(['goal', 'duration', 'verified', 'reward', 'repeat', 'integrity']);
    expect(body.rules[0].text).toBe('Reach 70,000 steps over the week');
    expect(body.rules[1].text).toContain(`${7} days`);
    expect(body.rules.at(-1)).toMatchObject({ tone: 'caution', icon: 'warning' });

    expect(body.cta).toEqual({ label: 'Continue Challenge', action: 'track_steps' });
    expect(body.shareText).toContain('Weekly Step Master');
  });

  it('counts a daily challenge against its own goal and closes tonight', async () => {
    const session = await signUpAndRegister();
    await day(session, today(), { verifiedSteps: 6_000, steps: 6_000, verified: true });

    const body = await detail(session, 'ch-10k-steps');
    expect(body.period).toMatchObject({ start: today(), end: today(), day: 1, days: 1 });
    expect(body.focus).toMatchObject({ scope: 'today', target: 10_000, value: 6_000, remaining: 4_000 });
    expect(body.reward.caption).toBe("Finish today's goal to earn");
    expect(body.rules[1].text).toContain('one day');
  });

  it('measures a consistency challenge against the member’s own step goal', async () => {
    const session = await signUpAndRegister();
    await ChallengeDefinitionModel.updateOne({ _id: 'ch-7-day-consistency' }, { $set: { startsOn: null } });
    await day(session, today(), { verifiedSteps: 4_000, steps: 4_000, verified: true });

    const body = await detail(session, 'ch-7-day-consistency');
    expect(body.focus).toMatchObject({ label: 'Daily Goal', target: 10_000, value: 4_000, remaining: 6_000 });
    expect(body.rules[0].text).toBe('Walk at least 10,000 steps on each of the 7 days');
    expect(body.reward.caption).toBe('Complete all 7 days to earn');
  });

  it('ranks everyone with progress, names them in public, and places the caller', async () => {
    const mine = await signUpAndRegister();
    const ahead = await signUpAndRegister();
    const behind = await signUpAndRegister();
    await Promise.all([
      day(mine, today(), { verifiedSteps: 7_000, steps: 7_000, verified: true }),
      day(ahead, today(), { verifiedSteps: 12_000, steps: 12_000, verified: true }),
      day(behind, today(), { verifiedSteps: 1_000, steps: 1_000, verified: true }),
    ]);

    const body = await detail(mine, 'ch-10k-steps');
    expect(body.standings.map((p: { rank: number; progress: number }) => [p.rank, p.progress])).toEqual([
      [1, 12_000], [2, 7_000], [3, 1_000],
    ]);
    // A first name and an initial, never the whole name.
    expect(body.standings[0].name).not.toContain('@');
    expect(body.standings[1].isCurrentUser).toBe(true);
    expect(body.standings[0].completed).toBe(true);
    expect(body.me).toMatchObject({ rank: 2, progress: 7_000, completed: false, isCurrentUser: true });
    expect(body.ranked).toBe(3);
    expect(body.joined).toBeGreaterThanOrEqual(3);
    expect(body.finished).toBe(0);
  });

  it('counts the finishers and turns the button into a way back once the caller is one', async () => {
    const session = await signUpAndRegister();
    await day(session, today(), { verifiedSteps: 10_400, steps: 10_400, verified: true });
    await evaluateChallenges(session.userId, today(), ZONE);

    const body = await detail(session, 'ch-10k-steps');
    expect(body.finished).toBe(1);
    expect(body.challenge.completedAt).toEqual(expect.any(String));
    expect(body.cta).toEqual({ label: 'Challenge Complete', action: 'view_board' });
    expect(body.reward.badge).toMatchObject({ id: 'a-10k-steps', achievedAt: expect.any(String) });
  });

  it('shows an upcoming challenge for the period it opens in, with nothing counted yet', async () => {
    const session = await signUpAndRegister();
    await day(session, today(), { verifiedSteps: 9_000, steps: 9_000, verified: true });

    const body = await detail(session, 'ch-15k-steps');
    const opensOn = addDays(today(), 1);
    expect(body.challenge).toMatchObject({ startsAt: opensOn, progress: 0, endsOn: null });
    expect(body.period).toMatchObject({ start: opensOn, end: opensOn, day: 1, days: 1 });
    expect(body.focus).toMatchObject({ scope: 'period', value: 0, target: 15_000, caption: 'Challenge Starts In' });
    expect(body.standings).toEqual([]);
    expect(body.me).toBeNull();
    expect(body.cta.action).toBe('none');
  });

  it('sends a workout challenge to the dashboard and shows the period, not a daily share', async () => {
    const session = await signUpAndRegister();
    await ChallengeDefinitionModel.updateOne({ _id: 'ch-weekend-warrior' }, { $set: { startsOn: null } });

    const body = await detail(session, 'ch-weekend-warrior');
    expect(body.focus).toMatchObject({ scope: 'period', label: 'Challenge Goal', target: 2, value: 0 });
    expect(body.cta).toEqual({ label: 'Start a Workout', action: 'go_home' });
  });

  it('shows a past day as closed rather than counting down to a deadline behind it', async () => {
    const session = await signUpAndRegister();
    const yesterday = addDays(today(), -1);
    await day(session, yesterday, { verifiedSteps: 8_000, steps: 8_000, verified: true });

    const body = await detail(session, 'ch-10k-steps', yesterday);
    expect(body.period).toMatchObject({ start: yesterday, end: yesterday });
    expect(body.focus).toMatchObject({ value: 8_000, caption: 'That Day Has Closed' });
    expect(Date.parse(body.focus.endsAt)).toBeLessThan(Date.now());
  });

  it('404s an unknown challenge and 422s a date it cannot read', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get('/v1/challenges/ch-nope').set(authed(session))).status).toBe(404);
    expect((await request(app).get('/v1/challenges/ch-10k-steps?date=soon').set(authed(session))).status).toBe(422);
  });
});

describe('achievements: one in full (GET /achievements/:id)', () => {
  async function badge(session: Session, id: string) {
    const res = await request(app).get(`/v1/achievements/${id}`).set(authed(session));
    expect(res.status).toBe(200);
    return res.body;
  }

  async function badgeCoinsOn() {
    await AppConfigModel.updateOne({ _id: 'coins' }, { $set: { 'value.achievements.enabled': true } }, { upsert: true });
    invalidateConfig();
  }

  it('words the badge from its own rule and measures the member’s best against it', async () => {
    const session = await signUpAndRegister();
    await day(session, addDays(today(), -3), { verifiedSteps: 8_428, steps: 8_428, verified: true });
    // Today is smaller: a badge is judged on the best on record, not on today.
    await day(session, today(), { verifiedSteps: 1_000, steps: 1_000, verified: true });

    const body = await badge(session, 'a-10k-steps');
    expect(body.title).toBe('10K Steps Champion');
    expect(body.description).toBe('Walk 10,000 steps in a single day.');
    expect(body.about).toBe(
      'This achievement is awarded when you walk 10,000 steps in a single day. It shows your dedication towards an active lifestyle.',
    );
    expect(body.unlocked).toBe(false);
    expect(body.progress).toMatchObject({
      basis: 'best_day',
      label: 'Your best day',
      value: 8_428,
      target: 10_000,
      percent: 84,
      completedOn: null,
    });
    expect(body.progress.caption).toBe('1,572 steps to go');
    expect(body.cta).toEqual({ label: 'Keep Going', action: 'track_steps' });
  });

  it('caps the bar at done and dates the day it was won', async () => {
    const session = await signUpAndRegister();
    await day(session, today(), { verifiedSteps: 10_428, steps: 10_428, verified: true });
    await evaluateChallenges(session.userId, today(), ZONE);

    const body = await badge(session, 'a-10k-steps');
    expect(body.unlocked).toBe(true);
    // 10,428 of 10,000 is done, not 104% done.
    expect(body.progress).toMatchObject({ value: 10_428, target: 10_000, percent: 100, completedOn: today() });
    expect(body.progress.caption).toMatch(/^Goal completed on /);
    expect(body.unlockedAt).toEqual(expect.any(String));
    expect(body.note).toBe('You did it! Consistency leads to a healthier you.');
    expect(body.cheer).toEqual({ title: 'Great job!', message: "You're one step closer to a fitter, healthier you." });
  });

  it('shows what a badge pays, and says plainly that badge coins have not started', async () => {
    const session = await signUpAndRegister();

    expect((await badge(session, 'a-10k-steps')).reward).toEqual({
      coins: 50,
      via: 'achievement',
      caption: 'Coins for badges start soon',
      paid: false,
    });
  });

  it('pays the badge once badge coins are on, once, under the ceiling', async () => {
    const session = await signUpAndRegister();
    await badgeCoinsOn();
    await day(session, today(), { verifiedSteps: 10_400, steps: 10_400, verified: true });

    await evaluateChallenges(session.userId, today(), ZONE);
    await evaluateChallenges(session.userId, today(), ZONE);

    const rows = await CoinLedgerModel.find({ userId: session.userId, referenceType: 'achievement' }).lean();
    const tenK = rows.filter(r => r.referenceId === 'a-10k-steps');
    expect(tenK).toHaveLength(1);
    expect(tenK[0]).toMatchObject({ amountMc: 50_000, source: 'challenge', title: '10K Steps badge unlocked' });

    expect((await badge(session, 'a-10k-steps')).reward).toMatchObject({
      coins: 50,
      via: 'achievement',
      caption: 'Paid when you unlocked it',
      paid: true,
    });
  });

  it('borrows the challenge’s period for a badge that has no rule of its own', async () => {
    const session = await signUpAndRegister();
    await day(session, today(), { verifiedSteps: 14_000, steps: 14_000, verified: true });

    // 'a-step-master' has no rule: only the Weekly Step Master challenge gives it.
    const body = await badge(session, 'a-step-master');
    expect(body.progress).toMatchObject({ basis: 'challenge', label: 'Weekly Step Master', target: 70_000, value: 14_000, percent: 20 });
    expect(body.description).toBe('Finish the Weekly Step Master challenge.');
    expect(body.reward).toMatchObject({ coins: 150, via: 'achievement' });
  });

  it('lists the rest of the ladder with what the member holds of it', async () => {
    const session = await signUpAndRegister();
    await day(session, today(), { verifiedSteps: 16_000, steps: 16_000, verified: true });
    await evaluateChallenges(session.userId, today(), ZONE);

    const body = await badge(session, 'a-10k-steps');
    const ids = body.related.map((a: { id: string }) => a.id);
    // Every steps badge, smallest first, this one among them.
    expect(ids).toContain('a-10k-steps');
    expect(ids).toContain('a-20k-steps');
    const values = body.related.map((a: { value: number }) => a.value);
    expect(values).toEqual([...values].sort((a: number, b: number) => a - b));

    const byId = Object.fromEntries(body.related.map((a: { id: string }) => [a.id, a]));
    expect(byId['a-10k-steps'].achievedAt).toEqual(expect.any(String));
    expect(byId['a-20k-steps'].achievedAt).toBeNull();
  });

  it('sends the member back to the shelf once there is no rung left above', async () => {
    const session = await signUpAndRegister();
    // 'a-marathon' has no rule of its own: the Monthly Marathon challenge is
    // the only thing that gives it, so the challenge has to be open.
    await ChallengeDefinitionModel.updateOne({ _id: 'ch-monthly-marathon' }, { $set: { startsOn: null } });
    await day(session, today(), { verifiedSteps: 320_000, steps: 320_000, verified: true });
    await evaluateChallenges(session.userId, today(), ZONE);

    // The largest steps badge: there is no rung above it to send anyone to.
    const body = await badge(session, 'a-marathon');
    expect(body.unlocked).toBe(true);
    expect(body.cta).toEqual({ label: 'View All Achievements', action: 'view_shelf' });
  });

  it('404s a badge that is not in the catalogue', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get('/v1/achievements/a-nope').set(authed(session))).status).toBe(404);
  });
});
