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
    // The week is on record and paid nothing, and the row says which of the
    // three reasons it is (D-90) — a bare zero beside a place that pays
    // 5,000 reads as money kept.
    expect(history.periods).toEqual([
      {
        id: LAST, start: LAST, end: '2026-10-04', rank: 1, score: 1_500,
        coins: 0, won: 5_000, perks: ['Premium T-Shirt', 'Water Bottle'], state: 'held',
        reason: 'Place 1 pays 5,000 coins, and leaderboard prizes were not running when this week closed. Your place is on record.',
      },
    ]);
    expect(history.rewardCoinsHeld).toBe(5_000);
    expect(history.prizesRunning).toBe(false);
    // And the member was told the same thing, in the same words.
    expect(note?.message).toContain('were not running');
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

/**
 * The words the screen says (D-89).
 *
 * The prizes were always the config's and the sentences about them were the
 * code's, so the one page in the app that promises people money could only be
 * reworded by a release. These are about the half that moved: the copy is
 * config, the figures in it are filled in by the server, and a build that
 * does not know about a field still has something to draw.
 */
describe('leaderboard: the words (D-89)', () => {
  async function words(value: Record<string, unknown>) {
    await AppConfigModel.updateOne({ _id: 'leaderboard' }, { $set: { value } }, { upsert: true });
    invalidateConfig();
  }

  it('says what the operator wrote, with the figures filled in', async () => {
    const session = await member('Asha Rao');
    await words({
      score: { stepsPerPoint: 500, perWorkout: 10, perChallenge: 20 },
      tiers: [{ fromRank: 1, toRank: 2, coins: 1_500, perks: ['Cap'], label: 'Winners' }],
      banner: { kicker: 'This week', title: 'Walk for {scope}', subtitle: 'Top {lastPaid} win' },
      note: 'Paid every Monday in {scope}.',
      howItWorks: [{ title: 'Earn {tierCount} way', detail: 'A point per {stepsPerPoint} steps. {prizes}.' }],
    });

    const res = await request(app).get('/v1/leaderboard/reward-tiers').set(authed(session));

    expect(res.status).toBe(200);
    // The rung's own label, not a sentence the code wrote.
    expect(res.body.tiers[0].label).toBe('Winners');
    expect(res.body.banner).toEqual({
      kicker: 'This week',
      title: 'Walk for India',
      subtitle: 'Top 2 win',
    });
    expect(res.body.note).toBe('Paid every Monday in India.');
    expect(res.body.howItWorks).toEqual([
      { title: 'Earn 1 way', detail: 'A point per 500 steps. Places 1–2 take 1,500 coins and Cap.' },
    ]);
  });

  it('leaves a placeholder nothing fills alone, so a typo reads as a typo', async () => {
    const session = await member('Vikram Shah');
    await words({
      tiers: [{ fromRank: 1, toRank: 1, coins: 100, perks: [] }],
      note: 'Paid in {scoop}.',
    });

    const res = await request(app).get('/v1/leaderboard/reward-tiers').set(authed(session));

    expect(res.body.note).toBe('Paid in {scoop}.');
    // And a rung nobody labelled still has a label.
    expect(res.body.tiers[0].label).toBe('Rank 1');
  });

  it('refuses a ladder that would pay the wrong place', async () => {
    // The session comes first on purpose: a config the validator refuses
    // fails *every* read in the process — sign-up included — which is the
    // whole reason the panel validates a patch before it stores it.
    const session = await signUpAndRegister();

    // Two rungs over place 2: `tierFor` takes the first match, so this is a
    // Monday that pays the wrong figure and nothing says so until it has.
    await words({
      tiers: [
        { fromRank: 1, toRank: 2, coins: 5_000, perks: [] },
        { fromRank: 2, toRank: 5, coins: 1_000, perks: [] },
      ],
    });
    const overlapping = await request(app).get('/v1/leaderboard/reward-tiers').set(authed(session));
    expect(overlapping.status).toBe(500);

    // A gap is the same mistake from the other side: place 2 would win
    // nothing while place 3 does.
    await words({
      tiers: [
        { fromRank: 1, toRank: 1, coins: 5_000, perks: [] },
        { fromRank: 3, toRank: 5, coins: 1_000, perks: [] },
      ],
    });
    expect((await request(app).get('/v1/leaderboard/reward-tiers').set(authed(session))).status).toBe(500);

    // And empty copy, which the app would draw as a blank card.
    await words({ tiers: [{ fromRank: 1, toRank: 1, coins: 1, perks: [] }], note: '   ' });
    expect((await request(app).get('/v1/leaderboard/reward-tiers').set(authed(session))).status).toBe(500);
  });
});

/**
 * The operator's read (`GET /admin/leaderboard`).
 *
 * A prize ladder is edited while real people are standing on it, so the page
 * shows who is in the paid places and what each would take — and the words
 * exactly as the app will receive them, because the copy carries placeholders
 * and a preview written anywhere else would be a second implementation of the
 * one thing the page exists to get right.
 */
describe('admin: the board and what it pays', () => {
  const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

  it('shows the ladder, the live standings and the preview the app will get', async () => {
    const first = await member('Asha Rao');
    const second = await member('Vikram Shah');
    const week = weekOf(today());
    await scored(first, week.id, 900);
    await scored(second, week.id, 400, new Date(Date.now() + 1_000));

    const res = await request(app).get('/v1/admin/leaderboard').set(ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.country).toBe('IN');
    expect(res.body.scope).toBe('India');
    expect(res.body.period.id).toBe(week.id);
    // Who is holding the paid places, with what the place would take.
    expect(res.body.standings[0]).toMatchObject({ rank: 1, name: 'Asha Rao', score: 900, coins: 5_000 });
    expect(res.body.standings[0].publicName).toBe('Asha R.');
    expect(res.body.standings[1]).toMatchObject({ rank: 2, coins: 3_000 });
    // The words, filled in — the same answer the member's own read gives.
    expect(res.body.preview.tiers[0].label).toBe('1st Place');
    expect(res.body.preview.banner.title).toBe('Win Amazing Rewards!');
    // What a full week costs, so the ladder is edited with the bill in view.
    expect(res.body.totals.coinsPerWeek).toBe(5_000 + 3_000 * 2 + 1_000 * 7);
    expect(res.body.totals.lastPaidRank).toBe(10);
    expect(res.body.totals.paidPlacesFilled).toBe(2);
  });

  it('says when a prize would not actually be paid', async () => {
    // Prizes are step-derived, so they wait on ⚙ `coins.steps.enabled`
    // (D-46): a board can look perfect and pay nobody.
    const off = await request(app).get('/v1/admin/leaderboard').set(ADMIN);
    expect(off.body.payable).toBe(false);

    await stepCoinsOn();
    const on = await request(app).get('/v1/admin/leaderboard').set(ADMIN);
    expect(on.body.payable).toBe(true);
  });

  it('is behind the operator key', async () => {
    expect((await request(app).get('/v1/admin/leaderboard')).status).toBe(401);
  });
});

/**
 * A page of the board (RULES L2b, D-90).
 *
 * The board is the top ⚙ `leaderboard.boardSize` places and nothing further
 * — ranking a whole country is a list nobody scrolls and a query that grows
 * with the member count — and the app asks for it a page at a time rather
 * than taking fifty rows to draw five.
 */
describe('leaderboard: paging the board', () => {
  it('serves a page, numbers it from its offset, and will not walk past the board', async () => {
    const week = weekOf(today());
    const people = [];
    for (let index = 0; index < 6; index += 1) {
      const session = await member(`Walker ${index}`);
      await scored(session, week.id, 1_000 - index * 10);
      people.push(session);
    }
    const caller = people[0];

    const first = await request(app).get('/v1/leaderboard').query({ limit: 2 }).set(authed(caller));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ offset: 0, limit: 2, total: 6, hasMore: true, ranked: 6 });
    expect(first.body.entries.map((e: { rank: number }) => e.rank)).toEqual([1, 2]);

    const second = await request(app).get('/v1/leaderboard').query({ offset: 2, limit: 2 }).set(authed(caller));
    // Ranks continue from the offset rather than restarting at 1 — a page
    // that renumbered itself would put four members at "rank 1".
    expect(second.body.entries.map((e: { rank: number }) => e.rank)).toEqual([3, 4]);
    expect(second.body).toMatchObject({ offset: 2, hasMore: true });

    const last = await request(app).get('/v1/leaderboard').query({ offset: 4, limit: 2 }).set(authed(caller));
    expect(last.body).toMatchObject({ hasMore: false });

    // Past the end: an empty page, not a refusal — an app asking for one
    // page more than there is has simply reached the end.
    const past = await request(app).get('/v1/leaderboard').query({ offset: 20, limit: 2 }).set(authed(caller));
    expect(past.body.entries).toEqual([]);
    expect(past.body.hasMore).toBe(false);
  });

  it('clips a page to the board however it is asked for', async () => {
    await AppConfigModel.updateOne(
      { _id: 'leaderboard' },
      { $set: { 'value.boardSize': 3 } },
      { upsert: true },
    );
    invalidateConfig();
    const week = weekOf(today());
    const people = [];
    for (let index = 0; index < 5; index += 1) {
      const session = await member(`Walker ${index}`);
      await scored(session, week.id, 500 - index);
      people.push(session);
    }

    const greedy = await request(app).get('/v1/leaderboard').query({ limit: 100 }).set(authed(people[0]));

    // Five are scoring; the board is three. `ranked` is the truth about the
    // country, `total` the truth about the list.
    expect(greedy.body.entries).toHaveLength(3);
    expect(greedy.body).toMatchObject({ total: 3, ranked: 5, hasMore: false });
  });

  it('answers an installed build that asks for no page at all', async () => {
    const week = weekOf(today());
    const caller = await member('Asha Rao');
    await scored(caller, week.id, 100);

    const res = await request(app).get('/v1/leaderboard').set(authed(caller));

    expect(res.body.entries).toHaveLength(1);
    expect(res.body).toMatchObject({ offset: 0, total: 1, hasMore: false });
  });
});

/**
 * The owner's own question: a member wins #1 and 5,000 coins, slips to #18
 * the next week, then takes #1 again. Do they get 5,000 again?
 *
 * They do. Each week is its own `referenceId` into the ledger, so the credit
 * is idempotent *within* a week and independent *between* weeks — which is
 * what "every week is paid on its own" means, and what the How-it-works step
 * and the app's weeks list now say out loud.
 */
describe('leaderboard: a place won twice is paid twice (RULES L10)', () => {
  const weeks = ['2026-09-28', '2026-10-05', '2026-10-12'] as const;
  /** The Monday after a week, past the grace hours. */
  const closingDay = (week: string) =>
    new Date(localMidnightUtc(addDays(week, 7), ZONE).getTime() + 7 * 3_600_000);

  it('pays the same prize again the next time the place is won', async () => {
    await stepCoinsOn();
    const star = await member('Asha Rao');
    const rival = await member('Ravi Kumar');

    // Week one: #1.
    await scored(star, weeks[0], 2_000);
    await scored(rival, weeks[0], 500);
    await closeDueWeeks(closingDay(weeks[0]));

    // Week two: the rival takes it, and #2 pays its own tier.
    await scored(star, weeks[1], 400);
    await scored(rival, weeks[1], 2_400);
    await closeDueWeeks(closingDay(weeks[1]));

    // Week three: back on top.
    await scored(star, weeks[2], 2_600);
    await scored(rival, weeks[2], 900);
    await closeDueWeeks(closingDay(weeks[2]));

    const history = (await request(app).get('/v1/leaderboard/history').set(authed(star))).body;
    const byWeek = Object.fromEntries(
      history.periods.map((p: { id: string; rank: number; coins: number; state: string }) => [
        p.id,
        { rank: p.rank, coins: p.coins, state: p.state },
      ]),
    );

    expect(byWeek[weeks[0]]).toEqual({ rank: 1, coins: 5_000, state: 'paid' });
    expect(byWeek[weeks[1]]).toEqual({ rank: 2, coins: 3_000, state: 'paid' });
    // The same place, the same prize, a second time — nothing about the
    // first week stops the third from paying.
    expect(byWeek[weeks[2]]).toEqual({ rank: 1, coins: 5_000, state: 'paid' });
    expect(history.rewardCoinsEarned).toBe(13_000);

    // Three ledger rows, one per week, each keyed by its own week.
    const paid = await CoinLedgerModel.find({ userId: star.userId, referenceType: 'leaderboard' }).lean();
    expect(paid.map(row => row.referenceId).sort()).toEqual(weeks.map(w => `${w}:IN`).sort());

    // And closing a week again pays nothing: the credit is idempotent inside
    // a week even though it repeats between them.
    await LeaderboardPeriodModel.deleteOne({ _id: `${weeks[2]}:IN` });
    await closeDueWeeks(closingDay(weeks[2]));
    expect(await CoinLedgerModel.countDocuments({ userId: star.userId, referenceType: 'leaderboard' })).toBe(3);
  });
});
