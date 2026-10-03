import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { invalidateConfig } from '../src/config/remote.js';
import { addDays, localDayOf, localMidnightUtc } from '../src/lib/dates.js';
import { ActivityDailyModel } from '../src/modules/activity/models.js';
import { ChallengeCompletionModel } from '../src/modules/challenges/models.js';
import { CoinBalanceModel, CoinLedgerModel } from '../src/modules/economy/models.js';
import { UserModel } from '../src/modules/identity/models.js';
import { FraudFlagModel } from '../src/modules/integrity/models.js';
import { LeaderboardPeriodModel, LeaderboardResultModel, LeaderboardScoreModel } from '../src/modules/leaderboard/models.js';
import { closeDueWeeks, refreshLeaderboardScore, weekOf } from '../src/modules/leaderboard/service.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { WorkoutModel } from '../src/modules/training/models.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

const ZONE = 'Asia/Kolkata';
const today = () => localDayOf(new Date(), ZONE);

async function stepCoinsOn() {
  await AppConfigModel.updateOne({ _id: 'coins' }, { $set: { 'value.steps.enabled': true } }, { upsert: true });
  invalidateConfig();
}

async function member(name: string): Promise<Session> {
  const session = await signUpAndRegister();
  await UserModel.updateOne({ _id: session.userId }, { $set: { name } });
  return session;
}

async function scored(session: Session, periodId: string, score: number, reachedAt = new Date()) {
  await LeaderboardScoreModel.create({
    _id: `${periodId}:IN:${session.userId}`, periodId, country: 'IN', userId: session.userId, score, scoreReachedAt: reachedAt,
  });
}

describe('leaderboard: the week (RULES L1)', () => {
  it('runs Monday to Sunday, and ends at midnight in the country’s zone', () => {
    expect(weekOf('2026-10-02')).toEqual({ id: '2026-09-28', start: '2026-09-28', end: '2026-10-04' });
    // 00:00 in Kolkata is 18:30 the evening before in UTC.
    expect(localMidnightUtc('2026-10-05', ZONE).toISOString()).toBe('2026-10-04T18:30:00.000Z');
  });
});

describe('leaderboard: scores (RULES L3, L4)', () => {
  it('counts a point per 100 verified steps, 50 a workout and 100 a challenge — and nothing unverified', async () => {
    const session = await member('Asha Rao');
    const week = weekOf(today());
    await ActivityDailyModel.insertMany([
      { _id: `${session.userId}:${week.start}`, userId: session.userId, localDay: week.start, verifiedSteps: 12_345, steps: 12_345, verified: true },
      { _id: `${session.userId}:${addDays(week.start, 1)}`, userId: session.userId, localDay: addDays(week.start, 1), verifiedSteps: 0, steps: 30_000, verified: false },
      // Last week's steps are last week's.
      { _id: `${session.userId}:${addDays(week.start, -1)}`, userId: session.userId, localDay: addDays(week.start, -1), verifiedSteps: 9_000, steps: 9_000, verified: true },
    ]);
    await WorkoutModel.create({
      _id: 'wk-1', userId: session.userId, title: 'Push Day', startedAt: new Date(), completedAt: new Date(), localDay: week.start, plausible: true,
    });
    await WorkoutModel.create({
      _id: 'wk-2', userId: session.userId, title: 'Short', startedAt: new Date(), completedAt: new Date(), localDay: week.start, plausible: false,
    });
    await ChallengeCompletionModel.create({
      _id: `${session.userId}:ch-10k-steps:${week.start}`, userId: session.userId, challengeId: 'ch-10k-steps', cadence: 'daily',
      periodStart: week.start, periodEnd: week.start, progress: 12_345, goal: 10_000, rewardCoins: 200, status: 'unpaid',
      completedAt: new Date(localMidnightUtc(week.start, ZONE).getTime() + 12 * 3_600_000),
    });

    await refreshLeaderboardScore(session.userId, week.start);

    expect(await LeaderboardScoreModel.findById(`${week.id}:IN:${session.userId}`).lean())
      .toMatchObject({ steps: 12_345, workouts: 1, challenges: 1, score: 123 + 50 + 100 });
  });
});

describe('leaderboard: the board (GET /leaderboard)', () => {
  it('ranks the country by score, ties by who got there first, and places the caller', async () => {
    const week = weekOf(today());
    const asha = await member('Asha Rao');
    const ravi = await member('Ravi Kumar Singh');
    const meera = await member('Meera');
    const quiet = await member('Quiet One');
    await scored(asha, week.id, 900, new Date('2026-09-29T10:00:00Z'));
    await scored(ravi, week.id, 900, new Date('2026-09-29T09:00:00Z'));
    await scored(meera, week.id, 1_200);
    await scored(quiet, week.id, 0);

    const res = await request(app).get('/v1/leaderboard').set(authed(asha));
    expect(res.status).toBe(200);
    expect(res.body.period).toMatchObject({
      id: week.id, start: week.start, end: week.end, country: 'IN', status: 'live',
      resetsAt: localMidnightUtc(addDays(week.end, 1), ZONE).toISOString(),
    });
    expect(res.body.ranked).toBe(3);
    expect(res.body.entries.map((e: { name: string; rank: number }) => [e.rank, e.name])).toEqual([
      [1, 'Meera'], [2, 'Ravi S.'], [3, 'Asha R.'],
    ]);
    expect(res.body.entries[0]).toMatchObject({ location: 'India', coins: 5_000, perk: 'Premium T-Shirt + Water Bottle', score: 1_200, isCurrentUser: false });
    expect(res.body.entries[2]).toMatchObject({ isCurrentUser: true, coins: 3_000 });
    expect(res.body.me).toEqual({ rank: 3, score: 900, coins: 3_000, percentile: 33 });

    const nobody = await request(app).get('/v1/leaderboard').set(authed(quiet));
    expect(nobody.body.me).toBeNull();
  });
});

describe('leaderboard: the rules (GET /leaderboard/reward-tiers)', () => {
  it('words the prizes and the scoring from the config in force', async () => {
    const session = await member('Asha Rao');
    await AppConfigModel.updateOne(
      { _id: 'leaderboard' },
      { $set: { value: { score: { stepsPerPoint: 200, perWorkout: 40, perChallenge: 80 }, tiers: [{ fromRank: 1, toRank: 3, coins: 2_000, perks: [] }] } } },
      { upsert: true },
    );
    invalidateConfig();

    const res = await request(app).get('/v1/leaderboard/reward-tiers').set(authed(session));
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('India');
    expect(res.body.tiers).toEqual([{ id: 'rank-1-3', fromRank: 1, toRank: 3, label: 'Rank 1 – 3', coins: 2_000, perks: [] }]);
    expect(res.body.howItWorks[0].detail).toContain('a point for every 200 steps, 40 for a workout and 80 for a challenge');
    expect(res.body.howItWorks[1].detail).toContain('everyone in India');
    expect(res.body.howItWorks[2]).toEqual({ title: 'Finish in the top 3', detail: 'Places 1–3 take 2,000 coins.' });
  });
});

describe('leaderboard: closing a week (RULES L6, L9, L10, E8d)', () => {
  // Monday 5 October 2026: last week is 28 Sep – 4 Oct.
  const LAST = '2026-09-28';
  const mondayAt = (hourIst: number) => new Date(localMidnightUtc('2026-10-05', ZONE).getTime() + hourIst * 3_600_000);

  it('waits for the grace hours, then freezes the standings once and tells everyone placed', async () => {
    const first = await member('Asha Rao');
    const second = await member('Ravi Kumar');
    await scored(first, LAST, 1_500);
    await scored(second, LAST, 700);

    expect(await closeDueWeeks(mondayAt(5))).toEqual({ closed: [] });
    expect(await closeDueWeeks(mondayAt(7))).toEqual({ closed: [`${LAST}:IN`] });
    expect(await closeDueWeeks(mondayAt(8))).toEqual({ closed: [] });

    expect(await LeaderboardPeriodModel.findById(`${LAST}:IN`).lean()).toMatchObject({ ranked: 2, start: LAST, end: '2026-10-04' });
    expect(await LeaderboardResultModel.findById(`${LAST}:IN:${first.userId}`).lean())
      .toMatchObject({ rank: 1, score: 1_500, coins: 5_000, perks: ['Premium T-Shirt', 'Water Bottle'], paid: false, granted: 0 });
    // Step coins are off: the place is on record, nothing is paid (D-46).
    expect(await CoinLedgerModel.countDocuments({ referenceType: 'leaderboard' })).toBe(0);
    const note = await NotificationModel.findOne({ userId: first.userId, topic: 'reward' }).lean();
    expect(note?.title).toBe('You finished #1 on the India board! 🏆');

    // A score that moves after the close changes nothing frozen.
    await refreshLeaderboardScore(second.userId, '2026-10-04');
    expect((await LeaderboardScoreModel.findById(`${LAST}:IN:${second.userId}`).lean())?.score).toBe(700);

    const history = (await request(app).get('/v1/leaderboard/history').set(authed(first))).body;
    expect(history).toMatchObject({ bestRank: 1, bestRankAchievedOn: '2026-10-04', topTenFinishes: 1, rewardCoinsEarned: 0, rewardsWon: 1 });
    expect(history.periods).toEqual([{ id: LAST, start: LAST, end: '2026-10-04', rank: 1, score: 1_500, coins: 0 }]);
  });

  it('pays the prize tiers once step coins are on, above the daily ceiling, and skips a flagged place without moving anyone up', async () => {
    await stepCoinsOn();
    const first = await member('Asha Rao');
    const flagged = await member('Ravi Kumar');
    const third = await member('Meera Iyer');
    await scored(first, LAST, 1_500);
    await scored(flagged, LAST, 1_200);
    await scored(third, LAST, 800);
    await FraudFlagModel.create({
      _id: 'flg-1', userId: flagged.userId, localDay: '2026-10-01', kind: 'impossible_cadence', layer: 'L2', severity: 'hard', status: 'open',
    });

    await closeDueWeeks(mondayAt(7));
    await closeDueWeeks(mondayAt(9));

    expect((await CoinBalanceModel.findById(first.userId).lean())?.balanceMc).toBe(5_000_000);
    expect(await CoinLedgerModel.findOne({ userId: first.userId, referenceType: 'leaderboard' }).lean())
      .toMatchObject({ source: 'challenge', amountMc: 5_000_000, referenceId: `${LAST}:IN` });
    expect(await LeaderboardResultModel.findById(`${LAST}:IN:${flagged.userId}`).lean()).toMatchObject({ rank: 2, excluded: true, paid: false });
    expect((await CoinBalanceModel.findById(flagged.userId).lean())?.balanceMc ?? 0).toBe(0);
    expect(await LeaderboardResultModel.findById(`${LAST}:IN:${third.userId}`).lean()).toMatchObject({ rank: 3, granted: 3_000, paid: true });
    expect(await CoinLedgerModel.countDocuments({ referenceType: 'leaderboard' })).toBe(2);

    const history = (await request(app).get('/v1/leaderboard/history').set(authed(third))).body;
    expect(history).toMatchObject({ bestRank: 3, rewardCoinsEarned: 3_000 });
  });
});
