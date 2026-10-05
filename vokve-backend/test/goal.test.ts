import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS } from '../src/config/defaults.js';
import { invalidateConfig } from '../src/config/remote.js';
import { addDays, localDayOf } from '../src/lib/dates.js';
import { ageOn, recommendStepGoal, type GoalInputs } from '../src/modules/activity/goal.service.js';
import { ActivityDailyModel } from '../src/modules/activity/models.js';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

const ZONE = 'Asia/Kolkata';
const today = () => localDayOf(new Date(), ZONE);
const GOAL = CONFIG_DEFAULTS.activity.goal;

const suggest = (inputs: Partial<GoalInputs>) =>
  recommendStepGoal({ age: 32, bmi: 22, activityLevel: 'moderate', recentDays: [], ...inputs }, GOAL);

const days = (count: number, steps: number) => Array.from({ length: count }, () => steps);

async function walked(session: Session, daysAgo: number, steps: number) {
  const localDay = addDays(today(), -daysAgo);
  await ActivityDailyModel.updateOne(
    { _id: `${session.userId}:${localDay}` },
    { $set: { userId: session.userId, localDay, steps } },
    { upsert: true },
  );
}

const goalOf = async (session: Session) => {
  const res = await request(app).get('/v1/activity/goal').set(authed(session));
  expect(res.status).toBe(200);
  return res.body;
};

const saveGoal = (session: Session, dailyStepGoal: number) =>
  request(app).put('/v1/me/settings').set(authed(session)).send({ dailyStepGoal });

describe('step goal: the suggestion (D-55)', () => {
  it('counts whole years, the birthday included', () => {
    expect(ageOn('1994-03-21', '2026-10-04')).toBe(32);
    expect(ageOn('1994-10-04', '2026-10-04')).toBe(32);
    expect(ageOn('1994-10-05', '2026-10-04')).toBe(31);
    expect(ageOn('21/03/1994', '2026-10-04')).toBeNull();
    expect(ageOn('2027-01-01', '2026-10-04')).toBeNull();
  });

  it('goes one stretch past what the member walks now, up to the target for their age', () => {
    // The design's example: 5,000 a day lately — 7,000 suggested.
    expect(suggest({ age: 30, recentDays: days(5, 5000) })).toEqual({
      steps: 7000,
      basedOn: { age: true, bmi: true, recentSteps: true },
    });
    // No history yet: the profile's level stands in (moderate, 8,500), capped at 10,000 under 60.
    expect(suggest({})).toEqual({ steps: 10_000, basedOn: { age: true, bmi: true, recentSteps: false } });
    // Older, sedentary and obese: 4,000 now, so 6,000 — well short of the 9,000 target.
    expect(suggest({ age: 65, bmi: 31, activityLevel: 'sedentary' }).steps).toBe(6000);
    // Overweight raises the target to 11,000, so the stretch is not cut short.
    expect(suggest({ bmi: 27 }).steps).toBe(10_500);
    // A teenager's target is 12,000.
    expect(suggest({ age: 15 }).steps).toBe(10_500);
  });

  it('keeps what someone already past the target walks, on the increment, inside the range', () => {
    expect(suggest({ activityLevel: 'athlete', recentDays: days(6, 14_200) }).steps).toBe(14_000);
    expect(suggest({ recentDays: days(7, 300) }).steps).toBe(GOAL.min);
    expect(suggest({ recentDays: days(7, 26_000) }).steps).toBe(GOAL.max);
  });

  it('needs enough recent days, and works without an age or a BMI', () => {
    const fewDays = suggest({ recentDays: days(GOAL.recommend.minDaysWithSteps - 1, 5000) });
    expect(fewDays).toEqual({ steps: 10_000, basedOn: { age: true, bmi: true, recentSteps: false } });
    expect(suggest({ age: null, bmi: null, activityLevel: 'light' })).toEqual({
      steps: 8000,
      basedOn: { age: false, bmi: false, recentSteps: false },
    });
  });
});

describe('step goal: GET /activity/goal and saving it (D-55)', () => {
  it('a new account: the default goal, not yet chosen, and a suggestion from what is known', async () => {
    const session = await signUpAndRegister(); // born 1994-03-21; no height or weight yet
    expect(await goalOf(session)).toEqual({
      goal: 10_000,
      recommended: 10_000,
      basedOn: { age: true, bmi: false, recentSteps: false },
      min: 3000,
      max: 20_000,
      increment: 500,
      chosenAt: null,
    });
  });

  it('suggests from the recent days walked — today left out — and the BMI', async () => {
    const session = await signUpAndRegister();
    await request(app).post('/v1/me/complete-profile').set(authed(session))
      .send({ name: 'Asha Rao', heightCm: 170, weightKg: 65, units: 'metric' });
    for (let daysAgo = 1; daysAgo <= 6; daysAgo += 1) await walked(session, daysAgo, 5000);
    await walked(session, 0, 15_000);
    await walked(session, 20, 18_000); // outside the 14 days read

    const goal = await goalOf(session);
    expect(goal.recommended).toBe(7000);
    expect(goal.basedOn).toEqual({ age: true, bmi: true, recentSteps: true });
  });

  it('saves only inside the range, and a saved goal is marked as chosen', async () => {
    const session = await signUpAndRegister();

    const tooLow = await saveGoal(session, 2500);
    expect(tooLow.status).toBe(422);
    expect(tooLow.body.error.details).toEqual({ dailyStepGoal: 'Choose a goal between 3,000 and 20,000 steps.' });
    expect((await saveGoal(session, 20_500)).status).toBe(422);

    // Other settings leave the goal unchosen.
    await request(app).put('/v1/me/settings').set(authed(session)).send({ hapticsEnabled: false });
    expect((await goalOf(session)).chosenAt).toBeNull();

    const saved = await saveGoal(session, 7000);
    expect(saved.status).toBe(200);
    expect(saved.body.dailyStepGoal).toBe(7000);
    const goal = await goalOf(session);
    expect(goal.goal).toBe(7000);
    expect(Date.parse(goal.chosenAt)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('takes its range from remote config', async () => {
    const session = await signUpAndRegister();
    await AppConfigModel.updateOne({ _id: 'activity' }, { $set: { 'value.goal.max': 15_000 } }, { upsert: true });
    invalidateConfig();

    expect((await goalOf(session)).max).toBe(15_000);
    const refused = await saveGoal(session, 18_000);
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.dailyStepGoal).toBe('Choose a goal between 3,000 and 15,000 steps.');
    expect((await saveGoal(session, 15_000)).status).toBe(200);
  });
});
