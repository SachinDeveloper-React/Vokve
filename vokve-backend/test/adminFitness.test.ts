import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  AchievementDefinitionModel,
  ChallengeCompletionModel,
  ChallengeDefinitionModel,
  UserAchievementModel,
} from '../src/modules/challenges/models.js';
import { DietPlanModel, FoodItemModel, NutritionProfileModel } from '../src/modules/nutrition/models.js';
import { ExerciseModel, WorkoutTemplateModel } from '../src/modules/training/models.js';
import { seed } from '../src/seed/seed.js';
import { app, authed, signUpAndRegister } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

const challenge = (over: Record<string, unknown> = {}) => ({
  title: '12K Steps Weekend',
  description: 'Walk 12,000 steps on a Saturday.',
  emoji: '🥾',
  metric: 'steps',
  cadence: 'daily',
  goal: 12_000,
  rewardCoins: 250,
  ...over,
});

const badge = (over: Record<string, unknown> = {}) => ({
  label: '12K Steps',
  title: '12K Steps Champion',
  value: 12_000,
  metric: 'steps',
  rule: 'best_day_steps',
  rewardCoins: 120,
  ...over,
});

describe('admin: the challenge board (RULES C1–C5)', () => {
  it('turns a member away, with or without a token', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get('/v1/admin/challenges')).status).toBe(401);
    expect((await request(app).get('/v1/admin/challenges').set(authed(session))).status).toBe(401);
    expect((await request(app).post('/v1/admin/challenges').send(challenge())).status).toBe(401);
  });

  it('writes one the app then serves, with the id derived from the title', async () => {
    await seed();
    const session = await signUpAndRegister();

    const created = await request(app).post('/v1/admin/challenges').set(ADMIN).send(challenge());
    expect(created.status).toBe(201);
    expect(created.body.challenge).toMatchObject({
      id: 'ch-12k-steps-weekend',
      title: '12K Steps Weekend',
      goal: 12_000,
      rewardCoins: 250,
      state: 'live',
      completions: { total: 0, members: 0 },
    });

    // The member's board carries it on the next fetch — no release needed.
    const board = await request(app).get('/v1/challenges').set(authed(session));
    expect(board.status).toBe(200);
    expect(JSON.stringify(board.body)).toContain('ch-12k-steps-weekend');

    // A second one by that id is refused: a completion row keys on it.
    expect((await request(app).post('/v1/admin/challenges').set(ADMIN).send(challenge())).status).toBe(422);

    const edited = await request(app)
      .put('/v1/admin/challenges/ch-12k-steps-weekend')
      .set(ADMIN)
      .send({ goal: 14_000, rewardCoins: 300 });
    expect(edited.body.challenge).toMatchObject({ goal: 14_000, rewardCoins: 300 });

    const retired = await request(app).delete('/v1/admin/challenges/ch-12k-steps-weekend').set(ADMIN).send({});
    expect(retired.body.challenge).toMatchObject({ active: false, state: 'retired' });
    expect(JSON.stringify((await request(app).get('/v1/challenges').set(authed(session))).body)).not.toContain(
      'ch-12k-steps-weekend',
    );
  });

  it('refuses a badge that does not exist, and a window that ends before it starts', async () => {
    await seed();
    const noBadge = await request(app)
      .post('/v1/admin/challenges')
      .set(ADMIN)
      .send(challenge({ rewardsBadge: true, badgeId: 'a-nope' }));
    expect(noBadge.status).toBe(422);

    const unnamed = await request(app).post('/v1/admin/challenges').set(ADMIN).send(challenge({ rewardsBadge: true }));
    expect(unnamed.status).toBe(422);

    const backwards = await request(app)
      .post('/v1/admin/challenges')
      .set(ADMIN)
      .send(challenge({ startsOn: '2026-11-10', endsOn: '2026-11-01' }));
    expect(backwards.status).toBe(422);

    // With a badge that is really there, it takes.
    const withBadge = await request(app)
      .post('/v1/admin/challenges')
      .set(ADMIN)
      .send(challenge({ rewardsBadge: true, badgeId: 'a-10k-steps' }));
    expect(withBadge.status).toBe(201);
    expect(withBadge.body.challenge).toMatchObject({ badgeId: 'a-10k-steps', badgeLabel: '10K Steps', badgeMissing: false });
  });

  it('reports what a challenge has paid, and refuses to delete one anybody finished', async () => {
    await seed();
    const session = await signUpAndRegister();
    await ChallengeCompletionModel.create({
      _id: `${session.userId}:ch-10k-steps:2026-10-18`,
      userId: session.userId,
      challengeId: 'ch-10k-steps',
      cadence: 'daily',
      periodStart: '2026-10-18',
      periodEnd: '2026-10-18',
      progress: 10_400,
      goal: 10_000,
      rewardCoins: 200,
      granted: 150,
      status: 'capped',
      completedAt: new Date(),
    });

    const page = await request(app).get('/v1/admin/challenges').set(ADMIN);
    const row = page.body.data.find((entry: { id: string }) => entry.id === 'ch-10k-steps');
    expect(row.completions).toMatchObject({ total: 1, members: 1, granted: 150, unpaid: 1 });
    expect(page.body.totals.completions).toBe(1);

    const refused = await request(app).delete('/v1/admin/challenges/ch-10k-steps/permanent').set(ADMIN).send({});
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toMatch(/retire/i);
    expect(await ChallengeDefinitionModel.countDocuments({ _id: 'ch-10k-steps' })).toBe(1);

    // One nobody has touched goes.
    await request(app).post('/v1/admin/challenges').set(ADMIN).send(challenge({ id: 'ch-draft' }));
    const gone = await request(app).delete('/v1/admin/challenges/ch-draft/permanent').set(ADMIN).send({});
    expect(gone.body).toMatchObject({ deleted: true, id: 'ch-draft' });
    expect(await ChallengeDefinitionModel.countDocuments({ _id: 'ch-draft' })).toBe(0);
  });
});

describe('admin: the badge shelf (RULES C7)', () => {
  it('adds one, says what pays it, and marks one nothing can unlock', async () => {
    await seed();
    const created = await request(app).post('/v1/admin/achievements').set(ADMIN).send(badge());
    expect(created.status).toBe(201);
    // A rule with no threshold takes the figure the badge stands for.
    expect(created.body.achievement).toMatchObject({ id: 'a-12k-steps', threshold: 12_000, members: 0, unreachable: false });

    const orphan = await request(app)
      .post('/v1/admin/achievements')
      .set(ADMIN)
      .send(badge({ label: 'Mystery', rule: null, value: 1 }));
    expect(orphan.body.achievement).toMatchObject({ id: 'a-mystery', unreachable: true });

    // Pointing a challenge at it is the other way to unlock one.
    await request(app)
      .post('/v1/admin/challenges')
      .set(ADMIN)
      .send(challenge({ id: 'ch-mystery', rewardsBadge: true, badgeId: 'a-mystery' }));
    const page = await request(app).get('/v1/admin/achievements').set(ADMIN);
    const row = page.body.data.find((entry: { id: string }) => entry.id === 'a-mystery');
    expect(row).toMatchObject({ unreachable: false, awardedBy: [{ id: 'ch-mystery', title: '12K Steps Weekend' }] });

    const edited = await request(app).put('/v1/admin/achievements/a-12k-steps').set(ADMIN).send({ rewardCoins: 200 });
    expect(edited.body.achievement.rewardCoins).toBe(200);
  });

  it('refuses to delete a badge somebody holds, or one a challenge awards', async () => {
    await seed();
    const session = await signUpAndRegister();
    await UserAchievementModel.create({
      _id: `${session.userId}:a-10k-steps`,
      userId: session.userId,
      achievementId: 'a-10k-steps',
      achievedAt: new Date(),
      via: 'best_day_steps',
    });

    const held = await request(app).delete('/v1/admin/achievements/a-10k-steps').set(ADMIN).send({});
    expect(held.status).toBe(422);
    expect(JSON.stringify(held.body)).toMatch(/never taken back/i);

    // Nobody holds this one, but a seeded challenge pays it.
    const awarded = await request(app).delete('/v1/admin/achievements/a-cal-burner').set(ADMIN).send({});
    expect(awarded.status).toBe(422);
    expect(JSON.stringify(awarded.body)).toMatch(/Burn 500 Calories/);

    await request(app).post('/v1/admin/achievements').set(ADMIN).send(badge({ label: 'Spare', value: 1, rule: null }));
    const gone = await request(app).delete('/v1/admin/achievements/a-spare').set(ADMIN).send({});
    expect(gone.body).toMatchObject({ deleted: true, id: 'a-spare' });
    expect(await AchievementDefinitionModel.countDocuments({ _id: 'a-spare' })).toBe(0);
  });
});

describe('admin: importing the food library from a sheet (RULES N8)', () => {
  const rows = [
    { line: 2, name: 'Chapati', portion: '1 piece (40 g)', calories: 104, proteinG: 3, carbsG: 20, fatsG: 1 },
    // Already in the seeded library, with different figures: the sheet
    // corrects the row rather than adding a second Banana.
    { line: 3, name: 'Banana', portion: '1 medium', calories: 105, proteinG: 1, carbsG: 27, fatsG: 0 },
  ];

  it('says what it would do before it does it, then creates and updates by name', async () => {
    await seed();

    const dry = await request(app).post('/v1/admin/foods/import').set(ADMIN).send({ rows, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, created: 1, updated: 1, failed: [] });
    expect(await FoodItemModel.countDocuments({ ownerUserId: null, name: 'Chapati' })).toBe(0);
    expect((await FoodItemModel.findById('fl-banana').lean())!.calories).toBe(89);

    const first = await request(app).post('/v1/admin/foods/import').set(ADMIN).send({ rows });
    expect(first.body).toMatchObject({ created: 1, updated: 1, duplicates: 0 });
    // The existing row was corrected in place, keeping its id — which is
    // what the audit trail and every quick-add tile point at.
    expect((await FoodItemModel.findById('fl-banana').lean())!.calories).toBe(105);
    expect(await FoodItemModel.countDocuments({ ownerUserId: null, name: 'Banana' })).toBe(1);
    const chapati = await FoodItemModel.findOne({ ownerUserId: null, name: 'Chapati' }).lean();
    expect(chapati).toMatchObject({ calories: 104, portion: '1 piece (40 g)' });

    // The same sheet again, with a figure corrected: an edit of the same
    // row, not a second Chapati.
    const again = await request(app)
      .post('/v1/admin/foods/import')
      .set(ADMIN)
      .send({ rows: [{ ...rows[0], calories: 110 }, rows[1]] });
    expect(again.body).toMatchObject({ created: 0, updated: 2 });
    expect(again.body.failed).toEqual([]);
    expect(await FoodItemModel.countDocuments({ ownerUserId: null, name: 'Chapati' })).toBe(1);
    expect((await FoodItemModel.findById(chapati!._id).lean())!.calories).toBe(110);

    // And the member's library serves it.
    const session = await signUpAndRegister();
    const search = await request(app).get('/v1/foods').query({ q: 'chapati' }).set(authed(session));
    expect(search.status).toBe(200);
    expect(JSON.stringify(search.body)).toContain('Chapati');
  });

  it('names the line it could not read, and keeps the rest', async () => {
    await seed();
    const mixed = await request(app)
      .post('/v1/admin/foods/import')
      .set(ADMIN)
      .send({
        rows: [
          { line: 2, name: 'Poha', portion: '1 bowl', calories: 250 },
          { line: 3, name: 'Poha', portion: '1 bowl', calories: 260 },
        ],
      });
    expect(mixed.body).toMatchObject({ created: 1, updated: 1, duplicates: 1, failed: [] });
    expect(await FoodItemModel.countDocuments({ ownerUserId: null, name: 'Poha' })).toBe(1);
    // The later row wins, which is what a corrected line in a sheet means.
    expect((await FoodItemModel.findOne({ ownerUserId: null, name: 'Poha' }).lean())!.calories).toBe(260);

    // A row with no name never reaches the library, and the body says so.
    const empty = await request(app)
      .post('/v1/admin/foods/import')
      .set(ADMIN)
      .send({ rows: [{ line: 9, name: '   ', portion: '1', calories: 10 }] });
    expect(empty.status).toBe(422);
  });

  it('deletes a food outright, and leaves what members ate alone', async () => {
    await seed();
    const created = await request(app)
      .post('/v1/admin/foods')
      .set(ADMIN)
      .send({ name: 'Test Row', portion: '1', calories: 1 });
    const id = created.body.id;
    const gone = await request(app).delete(`/v1/admin/foods/${id}/permanent`).set(ADMIN).send({});
    expect(gone.body).toMatchObject({ deleted: true, id });
    expect(await FoodItemModel.countDocuments({ _id: id })).toBe(0);
    expect((await request(app).get(`/v1/admin/foods/${id}`).set(ADMIN)).status).toBe(404);
  });
});

describe('admin: diet plans and the nutrition overview (RULES N4, N10)', () => {
  it('deletes a plan and hands the members on it back to the server’s choice', async () => {
    await seed();
    const session = await signUpAndRegister();
    const plan = await DietPlanModel.findOne({ active: true }).lean();
    await NutritionProfileModel.updateOne(
      { _id: session.userId },
      {
        $set: {
          goals: { calories: 2200, proteinG: 120, carbsG: 300, fatsG: 70 },
          preferences: { dietType: 'vegetarian', mealPlan: 'balanced', goal: 'maintain' },
          selectedPlanId: plan!._id,
        },
      },
      { upsert: true },
    );

    const gone = await request(app).delete(`/v1/admin/diet-plans/${plan!._id}/permanent`).set(ADMIN).send({});
    expect(gone.body).toMatchObject({ deleted: true, released: 1 });
    expect(await DietPlanModel.countDocuments({ _id: plan!._id })).toBe(0);
    expect((await NutritionProfileModel.findById(session.userId).lean())!.selectedPlanId).toBeNull();
  });

  it('counts the library, the plans and what members chose', async () => {
    await seed();
    const session = await signUpAndRegister();
    await request(app).put('/v1/nutrition/profile').set(authed(session)).send({ preferences: { dietType: 'vegan' } });

    const overview = await request(app).get('/v1/admin/nutrition/overview').set(ADMIN);
    expect(overview.status).toBe(200);
    expect(overview.body.foods.total).toBeGreaterThan(0);
    expect(overview.body.plans.total).toBeGreaterThan(0);
    expect(overview.body.members.dietTypes.find((row: { value: string }) => row.value === 'vegan').members).toBe(1);
    expect(overview.body.defaults.defaultGoals).toMatchObject({ calories: expect.any(Number) });
  });
});

describe('admin: the gym — exercises and the templates built from them', () => {
  it('adds an exercise, builds a template on it, and keeps the two in step', async () => {
    await seed();
    const session = await signUpAndRegister();

    const exercise = await request(app)
      .post('/v1/admin/training/exercises')
      .set(ADMIN)
      .send({ name: 'Landmine Press', muscleGroup: 'shoulders', equipment: 'barbell' });
    expect(exercise.status).toBe(201);
    const added = exercise.body.exercises.find((row: { id: string }) => row.id === 'landmine-press');
    expect(added).toMatchObject({ name: 'Landmine Press', muscleGroup: 'shoulders', templates: [], logged: { sessions: 0 } });

    // A template may only name exercises that exist: the app carries whole
    // exercises in a template, so a missing one is a template it drops.
    const unknown = await request(app)
      .post('/v1/admin/training/templates')
      .set(ADMIN)
      .send({ title: 'Shoulder Day', estimatedMinutes: 40, exerciseIds: ['landmine-press', 'not-a-lift'] });
    expect(unknown.status).toBe(422);

    const template = await request(app)
      .post('/v1/admin/training/templates')
      .set(ADMIN)
      .send({ title: 'Shoulder Day', estimatedMinutes: 40, exerciseIds: ['landmine-press'] });
    expect(template.status).toBe(201);
    const built = template.body.templates.find((row: { id: string }) => row.id === 'shoulder-day');
    // The muscle groups follow the contents unless the operator names them.
    expect(built).toMatchObject({ title: 'Shoulder Day', muscleGroups: ['shoulders'], missing: [] });

    // The app serves it, with the exercise in full.
    const served = await request(app).get('/v1/workout-templates').set(authed(session));
    expect(served.status).toBe(200);
    const mine = served.body.find((row: { id: string }) => row.id === 'shoulder-day');
    expect(mine.exercises[0]).toMatchObject({ id: 'landmine-press', name: 'Landmine Press' });

    // And an exercise a template uses is not deleted out from under it.
    const used = await request(app).delete('/v1/admin/training/exercises/landmine-press').set(ADMIN).send({});
    expect(used.status).toBe(422);
    expect(JSON.stringify(used.body)).toMatch(/Shoulder Day/);

    const goneTemplate = await request(app).delete('/v1/admin/training/templates/shoulder-day').set(ADMIN).send({});
    expect(goneTemplate.body).toMatchObject({ deleted: true, id: 'shoulder-day' });
    const goneExercise = await request(app).delete('/v1/admin/training/exercises/landmine-press').set(ADMIN).send({});
    expect(goneExercise.body).toMatchObject({ deleted: true, id: 'landmine-press' });
    expect(await ExerciseModel.countDocuments({ _id: 'landmine-press' })).toBe(0);
  });

  it('marks a template that names an exercise nobody has', async () => {
    await seed();
    const template = await WorkoutTemplateModel.findOne().lean();
    await WorkoutTemplateModel.updateOne({ _id: template!._id }, { $push: { exerciseIds: 'ghost-lift' } });

    const page = await request(app).get('/v1/admin/training').set(ADMIN);
    const broken = page.body.templates.find((row: { id: string }) => row.id === template!._id);
    expect(broken.missing).toEqual(['ghost-lift']);
    expect(page.body.totals.broken).toBeGreaterThan(0);

    // Correcting it is an ordinary edit, and the groups follow the contents.
    const fixed = await request(app)
      .put(`/v1/admin/training/templates/${template!._id}`)
      .set(ADMIN)
      .send({ exerciseIds: (template!.exerciseIds ?? []).slice(0, 2) });
    expect(fixed.status).toBe(200);
    expect(fixed.body.templates.find((row: { id: string }) => row.id === template!._id).missing).toEqual([]);
  });
});
