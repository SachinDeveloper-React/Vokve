import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AchievementDefinitionModel, ChallengeDefinitionModel } from '../src/modules/challenges/models.js';
import { AppReleaseModel } from '../src/modules/devices/models.js';
import { FraudFlagModel } from '../src/modules/integrity/models.js';
import { DietPlanModel } from '../src/modules/nutrition/models.js';
import { AuditLogModel } from '../src/modules/platform/models.js';
import { ExerciseModel, WorkoutTemplateModel } from '../src/modules/training/models.js';
import { app, signUpAndRegister } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

/**
 * Every list on the operator surface is a page (RULES P15).
 *
 * The reason is not tidiness. A list that answers whole is a list whose cost
 * grows with the business: the challenge board used to group *every
 * completion row ever written* to decorate its rows, the gym unwound every
 * workout anybody had finished, and the closed leaderboard week read one
 * document per person who scored in order to add three numbers up and then
 * show the first twenty. None of that shows on a seeded database and all of
 * it shows on a real one.
 *
 * So what these tests pin is the contract that makes paging possible rather
 * than any one query plan:
 *
 *   - **the envelope** — `total`, `limit`, `offset`, `data` — because the
 *     panel has one pager component and it cannot say "page 3 of 7" without
 *     all four;
 *   - **`total` is of the filter, not of the page**, which is the bug a
 *     pager cannot recover from: a list that reports what it handed over
 *     says "25 of 25" on every page of a thousand;
 *   - **the tallies above the table stay whole-collection**, because "4
 *     live" has to mean four live challenges rather than four on this
 *     screen;
 *   - **the pickers are not paged**, since a dropdown that offers page one
 *     of the badge shelf is a form that cannot reach half of it.
 */

const pageOf = (body: Record<string, unknown>) => ({
  total: body.total,
  limit: body.limit,
  offset: body.offset,
  rows: (body.data as unknown[]).length,
});

describe('admin: every list is a page', () => {
  it('pages the challenge board, and keeps the tallies above it of the whole shelf', async () => {
    await signUpAndRegister(); // seeds
    await ChallengeDefinitionModel.deleteMany({});
    await ChallengeDefinitionModel.insertMany(
      Array.from({ length: 7 }, (_unused, index) => ({
        _id: `ch-page-${index}`,
        title: `Page ${index}`,
        metric: 'steps',
        cadence: 'daily',
        goal: 1_000 * (index + 1),
        rewardCoins: 10,
        sort: index,
        active: index !== 6, // one retired, so a state filter has something to find
      })),
    );

    const first = await request(app).get('/v1/admin/challenges?limit=3').set(ADMIN);
    expect(first.status).toBe(200);
    expect(pageOf(first.body)).toEqual({ total: 7, limit: 3, offset: 0, rows: 3 });
    // The figures above the table are of the shelf, not of the three rows.
    expect(first.body.totals).toMatchObject({ challenges: 7, live: 6, retired: 1 });

    const second = await request(app).get('/v1/admin/challenges?limit=3&offset=3').set(ADMIN);
    expect(second.body.offset).toBe(3);
    expect(second.body.total).toBe(7);
    // A different window of the same ordering, with nothing shown twice.
    const ids = (rows: { id: string }[]) => rows.map(row => row.id);
    expect(ids(second.body.data)).not.toEqual(ids(first.body.data));
    expect(ids(second.body.data).some(id => ids(first.body.data).includes(id))).toBe(false);

    // The last page is short, and the pager can tell because `total` is the
    // filter's rather than the page's.
    const last = await request(app).get('/v1/admin/challenges?limit=3&offset=6').set(ADMIN);
    expect(pageOf(last.body)).toEqual({ total: 7, limit: 3, offset: 6, rows: 1 });

    // `state` is cut by the database: "the retired one" is page one of a
    // filter, not a row that happened to be in the first twenty-five.
    const retired = await request(app).get('/v1/admin/challenges?state=retired').set(ADMIN);
    expect(retired.body.total).toBe(1);
    expect(retired.body.data[0]).toMatchObject({ id: 'ch-page-6', state: 'retired' });
    // And the tallies do not move with the filter.
    expect(retired.body.totals.challenges).toBe(7);

    const searched = await request(app).get('/v1/admin/challenges?q=Page%204').set(ADMIN);
    expect(searched.body.total).toBe(1);
    expect(searched.body.data[0].title).toBe('Page 4');
  });

  it('pages the badge shelf, and offers the whole of it to the pickers', async () => {
    await signUpAndRegister();
    await AchievementDefinitionModel.deleteMany({});
    await AchievementDefinitionModel.insertMany(
      Array.from({ length: 5 }, (_unused, index) => ({
        _id: `a-page-${index}`,
        label: `Badge ${index}`,
        title: `Badge ${index}`,
        value: 100 * index,
        metric: 'steps',
        // No rule and no challenge paying it: nothing can ever unlock it.
        rule: null,
        rewardCoins: 10,
        sort: index,
      })),
    );

    const page = await request(app).get('/v1/admin/achievements?limit=2').set(ADMIN);
    expect(pageOf(page.body)).toEqual({ total: 5, limit: 2, offset: 0, rows: 2 });
    // Unreachable is a question about two collections, and it is still asked
    // of the whole shelf rather than of the two rows handed over.
    expect(page.body.totals).toMatchObject({ achievements: 5, unreachable: 5 });

    const unreachable = await request(app).get('/v1/admin/achievements?state=unreachable&limit=2').set(ADMIN);
    expect(unreachable.body.total).toBe(5);

    /**
     * The picker is the other half of paging a catalogue.
     *
     * A challenge's badge dropdown and the grant-by-hand form need every
     * badge to choose from, so they read this instead: the whole shelf with
     * three fields a row and no joins.
     */
    const picker = await request(app).get('/v1/admin/achievements/picker').set(ADMIN);
    expect(picker.status).toBe(200);
    expect(picker.body.total).toBe(5);
    expect(picker.body.data).toHaveLength(5);
    expect(picker.body.data[0]).toEqual({
      id: 'a-page-0',
      label: 'Badge 0',
      title: 'Badge 0',
      rewardCoins: 10,
    });
    // And it is a picker, not a second copy of the list: no holders, no
    // awarding challenges, nothing that costs a read per row.
    expect(picker.body.data[0]).not.toHaveProperty('members');
  });

  it('pages the gym’s two lists apart, because one offset cannot mean both', async () => {
    await signUpAndRegister();
    await ExerciseModel.deleteMany({});
    await WorkoutTemplateModel.deleteMany({});
    await ExerciseModel.insertMany(
      Array.from({ length: 6 }, (_unused, index) => ({
        _id: `ex-page-${index}`,
        name: `Lift ${index}`,
        muscleGroup: 'chest',
        equipment: 'barbell',
      })),
    );
    await WorkoutTemplateModel.insertMany([
      { _id: 'tpl-ok', title: 'Push day', exerciseIds: ['ex-page-0', 'ex-page-1'], sort: 0 },
      // Names an exercise no row answers to: one the app drops.
      { _id: 'tpl-broken', title: 'Ghost day', exerciseIds: ['ex-gone'], sort: 1 },
      { _id: 'tpl-third', title: 'Pull day', exerciseIds: ['ex-page-2'], sort: 2 },
    ]);

    const gym = await request(app)
      .get('/v1/admin/training?exerciseLimit=2&exerciseOffset=2&templateLimit=1')
      .set(ADMIN);
    expect(gym.status).toBe(200);
    // Each list reports its own window, and neither moved the other's.
    expect(gym.body.exercisePage).toEqual({ total: 6, limit: 2, offset: 2 });
    expect(gym.body.templatePage).toEqual({ total: 3, limit: 1, offset: 0 });
    expect(gym.body.exercises).toHaveLength(2);
    expect(gym.body.templates).toHaveLength(1);
    // The tallies are of the gym: three templates, one of them broken, and
    // the three exercises no template names and nobody has logged. Both of
    // the awkward figures are questions across two collections, and both
    // are still asked of the whole gym rather than of the rows handed over.
    expect(gym.body.totals).toMatchObject({ exercises: 6, templates: 3, broken: 1, unused: 3 });

    // A template's exercises still carry their names, resolved for the page
    // rather than from a list of every exercise there is.
    const named = await request(app).get('/v1/admin/training?templateLimit=1&templateOffset=0').set(ADMIN);
    expect(named.body.templates[0].exercises).toEqual([
      { id: 'ex-page-0', name: 'Lift 0' },
      { id: 'ex-page-1', name: 'Lift 1' },
    ]);

    const broken = await request(app).get('/v1/admin/training?templateState=broken').set(ADMIN);
    expect(broken.body.templatePage.total).toBe(1);
    expect(broken.body.templates[0]).toMatchObject({ id: 'tpl-broken', missing: ['ex-gone'] });

    // And the picker the template form is built from is not paged.
    const picker = await request(app).get('/v1/admin/training/exercises/picker').set(ADMIN);
    expect(picker.body.total).toBe(6);
    expect(picker.body.data).toHaveLength(6);
    expect(picker.body.data[0]).toEqual({
      id: 'ex-page-0',
      name: 'Lift 0',
      muscleGroup: 'chest',
      equipment: 'barbell',
      isTimed: false,
    });
  });

  it('pages the diet plan library, which is the heaviest row on the panel', async () => {
    await signUpAndRegister();
    await DietPlanModel.deleteMany({});
    await DietPlanModel.insertMany(
      Array.from({ length: 4 }, (_unused, index) => ({
        _id: `plan-page-${index}`,
        name: `Plan ${index}`,
        dietTypes: ['vegetarian'],
        mealPlans: ['balanced'],
        days: [{ label: 'Day 1', meals: [] }, { label: 'Day 2', meals: [] }],
        sort: index,
        active: index !== 3,
        updatedBy: 'seed',
      })),
    );

    const page = await request(app).get('/v1/admin/diet-plans?limit=2').set(ADMIN);
    expect(pageOf(page.body)).toEqual({ total: 4, limit: 2, offset: 0, rows: 2 });
    // Days are counted where the documents are, so the figure above the
    // table does not need every plan read out to produce it.
    expect(page.body.totals).toEqual({ plans: 4, active: 3, days: 8 });

    const retired = await request(app).get('/v1/admin/diet-plans?state=retired').set(ADMIN);
    expect(retired.body.total).toBe(1);
    expect(retired.body.data[0].id).toBe('plan-page-3');
  });

  it('pages the releases, which is a list that only ever grows', async () => {
    await signUpAndRegister();
    await AppReleaseModel.deleteMany({});
    await AppReleaseModel.insertMany([
      { platform: 'android', version: '1.4.0', build: '140', status: 'current', releasedAt: new Date() },
      { platform: 'android', version: '1.3.0', build: '130', status: 'supported', releasedAt: new Date(Date.now() - 1e8) },
      { platform: 'android', version: '1.2.0', build: '120', status: 'deprecated', releasedAt: new Date(Date.now() - 2e8) },
      { platform: 'ios', version: '1.4.0', build: '141', status: 'current', releasedAt: new Date() },
    ]);

    const page = await request(app).get('/v1/admin/releases?limit=2').set(ADMIN);
    expect(pageOf(page.body)).toEqual({ total: 4, limit: 2, offset: 0, rows: 2 });
    expect(page.body.totals).toMatchObject({ releases: 4, current: 2, supported: 1, deprecated: 1 });
    /**
     * What each store is serving comes with the answer rather than being
     * found among the rows: the current build for a platform can be on any
     * page of a list sorted by date, and "store is serving nothing
     * recorded" on page two would be a lie.
     */
    expect(page.body.current).toEqual({
      ios: { version: '1.4.0', build: '141' },
      android: { version: '1.4.0', build: '140' },
    });

    const android = await request(app).get('/v1/admin/releases?platform=android').set(ADMIN);
    expect(android.body.total).toBe(3);
    expect(android.body.data.every((row: { platform: string }) => row.platform === 'android')).toBe(true);
  });

  it('pages a member’s sign-ins and the audit trail on their account', async () => {
    const session = await signUpAndRegister();
    await AuditLogModel.deleteMany({ subjectType: 'user', subjectId: session.userId });
    await AuditLogModel.insertMany(
      Array.from({ length: 5 }, (_unused, index) => ({
        actorType: 'admin',
        actorId: 'tester',
        action: 'member.note',
        subjectType: 'user',
        subjectId: session.userId,
        after: { index },
        at: new Date(Date.now() - index * 60_000),
      })),
    );

    const audit = await request(app)
      .get(`/v1/admin/users/${session.userId}/audit?limit=2&offset=2`)
      .set(ADMIN);
    expect(pageOf(audit.body)).toEqual({ total: 5, limit: 2, offset: 2, rows: 2 });

    // Sign-ins are periods inside a device rather than rows of their own, so
    // the page is cut after every install's periods are laid end to end —
    // and the envelope is the same either way.
    const logins = await request(app).get(`/v1/admin/users/${session.userId}/logins?limit=1`).set(ADMIN);
    expect(logins.body).toMatchObject({ limit: 1, offset: 0 });
    expect(logins.body.total).toBeGreaterThanOrEqual(1);
  });

  it('pages the fraud queue by account, and counts accounts rather than flags', async () => {
    const session = await signUpAndRegister();
    await FraudFlagModel.deleteMany({});
    // Two accounts, and three flags between them: the queue is by account,
    // so the total is two however many flags they have written.
    await FraudFlagModel.insertMany([
      { _id: 'flag-1', userId: session.userId, deviceId: session.deviceId, localDay: '2026-11-01', layer: 'L2', kind: 'shake', severity: 'hard', status: 'open', lastSeenAt: new Date() },
      { _id: 'flag-2', userId: session.userId, deviceId: session.deviceId, localDay: '2026-11-02', layer: 'L2', kind: 'shake', severity: 'soft', status: 'open', lastSeenAt: new Date() },
      { _id: 'flag-3', userId: 'usr-other', deviceId: 'dev-other', localDay: '2026-11-02', layer: 'L3', kind: 'teleport', severity: 'hard', status: 'open', lastSeenAt: new Date() },
    ]);

    const page = await request(app).get('/v1/admin/fraud/queue?limit=1').set(ADMIN);
    expect(pageOf(page.body)).toEqual({ total: 2, limit: 1, offset: 0, rows: 1 });

    const next = await request(app).get('/v1/admin/fraud/queue?limit=1&offset=1').set(ADMIN);
    expect(next.body.total).toBe(2);
    expect(next.body.data[0].userId).not.toBe(page.body.data[0].userId);

    // Past the end is an empty page, not an error and not page one again.
    const beyond = await request(app).get('/v1/admin/fraud/queue?limit=1&offset=50').set(ADMIN);
    expect(beyond.body).toMatchObject({ total: 2, offset: 50 });
    expect(beyond.body.data).toEqual([]);
  });

  it('refuses a limit big enough to be a whole-collection read', async () => {
    await signUpAndRegister();
    /**
     * The ceiling matters more than the default.
     *
     * `limit` is clamped rather than trusted because the query string is
     * somebody's address bar: `?limit=999999` is a request to read a whole
     * collection into memory, decorate it row by row and serialise the lot,
     * which is the load this surface exists not to put on the database.
     */
    const greedy = await request(app).get('/v1/admin/challenges?limit=999999').set(ADMIN);
    expect(greedy.status).toBe(422);

    const negative = await request(app).get('/v1/admin/challenges?offset=-5').set(ADMIN);
    expect(negative.status).toBe(422);
  });
});
