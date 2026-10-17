import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DeviceModel } from '../src/modules/devices/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { app, authed, signUpAndRegister } from './helpers.js';

/** The operator's key, as `test/setup.ts` configures it. */
const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

describe('admin: the step pipeline’s knobs', () => {
  it('answers the admin key alone', async () => {
    expect((await request(app).get('/v1/admin/config/steps')).status).toBe(401);
    expect((await request(app).put('/v1/admin/config/steps').send({ patch: {} })).status).toBe(401);
  });

  it('reads the effective config beside the code’s defaults, with nothing overridden yet', async () => {
    // The seed writes a copy of every section into `app_config`; a stored
    // default is not an override, and this is the test that says so.
    await signUpAndRegister();
    const res = await request(app).get('/v1/admin/config/steps').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.effective.activity.maxAgeDays).toBe(14);
    expect(res.body.defaults.activity.maxAgeDays).toBe(14);
    expect(res.body.effective.coins.steps).toMatchObject({ enabled: false, unitSteps: 100, coinsPerUnit: 0.095 });
    expect(res.body.effective.trust.stepCaps.normal).toBe(30_000);
    expect(res.body.overrides).toEqual([]);
  });

  it('applies a patch, records it as an override, and the phone’s own config read changes with it', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get('/v1/activity/config').set(authed(session))).body.sync.maxAgeDays).toBe(14);

    const res = await request(app)
      .put('/v1/admin/config/steps')
      .set(ADMIN)
      .send({ patch: { activity: { maxAgeDays: 10, syncNudge: { silentAfterHours: 12 } } }, note: 'tighter window' });
    expect(res.status).toBe(200);
    expect(res.body.effective.activity.maxAgeDays).toBe(10);
    expect(res.body.overrides).toEqual(
      expect.arrayContaining([
        { path: 'activity.maxAgeDays', value: 10, default: 14 },
        { path: 'activity.syncNudge.silentAfterHours', value: 12, default: 20 },
      ]),
    );

    // The knob is the one the app is actually served (RULES A8).
    const phone = await request(app).get('/v1/activity/config').set(authed(session));
    expect(phone.body.sync.maxAgeDays).toBe(10);
  });

  it('refuses a patch the config validator would reject, and writes nothing', async () => {
    // A per-source cap above the daily ceiling (RULES E8c).
    const res = await request(app)
      .put('/v1/admin/config/steps')
      .set(ADMIN)
      .send({ patch: { coins: { sourceCaps: { steps: 400 } } } });
    expect(res.status).toBe(422);
    expect(res.body.error.details.config).toContain('coins.dailyCap');

    const after = await request(app).get('/v1/admin/config/steps').set(ADMIN);
    expect(after.body.effective.coins.sourceCaps.steps).toBe(30);
    expect(after.body.overrides).toEqual([]);
  });

  it('refuses a ladder the wrong way round — the reminder before the silent push', async () => {
    const res = await request(app)
      .put('/v1/admin/config/steps')
      .set(ADMIN)
      .send({ patch: { activity: { syncNudge: { silentAfterHours: 48, remindAfterHours: 24 } } } });
    expect(res.status).toBe(422);
    expect(res.body.error.details.config).toContain('remindAfterHours');
  });

  it('refuses a key it does not own, rather than writing one nothing reads', async () => {
    const typo = await request(app)
      .put('/v1/admin/config/steps')
      .set(ADMIN)
      .send({ patch: { activity: { maxAgeDaze: 10 } } });
    expect(typo.status).toBe(422);

    const elsewhere = await request(app)
      .put('/v1/admin/config/steps')
      .set(ADMIN)
      .send({ patch: { commerce: { paymentMode: 'coins' } } });
    expect(elsewhere.status).toBe(422);
  });

  it('puts a key back to the code’s default', async () => {
    await request(app).put('/v1/admin/config/steps').set(ADMIN).send({ patch: { activity: { maxAgeDays: 7 } } });
    const reset = await request(app).put('/v1/admin/config/steps').set(ADMIN).send({ reset: ['activity.maxAgeDays'] });
    expect(reset.status).toBe(200);
    expect(reset.body.effective.activity.maxAgeDays).toBe(14);
    expect(reset.body.overrides).toEqual([]);
  });

  it('turning step coins on is one call, and the economy reads it', async () => {
    const res = await request(app)
      .put('/v1/admin/config/steps')
      .set(ADMIN)
      .send({ patch: { coins: { steps: { enabled: true } } }, note: 'phase 3' });
    expect(res.status).toBe(200);
    expect(res.body.effective.coins.steps.enabled).toBe(true);
    expect((await request(app).get('/v1/admin/activity/shadow').set(ADMIN)).body.rate.enabled).toBe(true);
  });
});

describe('admin: one member’s own config and messages', () => {
  it('reads their goal, their ceiling, their phones and what can reach them', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).get(`/v1/admin/users/${session.userId}/config`).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({ id: session.userId, timezone: 'Asia/Kolkata' });
    expect(res.body.steps.goal).toMatchObject({ current: 10_000, setAt: null, min: 3000, max: 20_000, increment: 500 });
    expect(res.body.steps.ceiling).toMatchObject({ tier: 'normal', dailySteps: 30_000, holdHours: 72 });
    expect(res.body.steps.installs).toHaveLength(1);
    expect(res.body.steps.installs[0]).toMatchObject({ signedIn: true, push: { hasToken: false, canShow: false } });
    expect(res.body.steps.signedIn).toBe(1);
    // Sign-up writes the preferences document, so what is worth saying is
    // whether the member has ever moved one of the switches.
    expect(res.body.notifications.preferences.changed).toBe(false);
    expect(res.body.notifications.preferences.categories.activity).toBe(true);
    expect(res.body.notifications.reachable).toMatchObject({ installs: 1, withToken: 0, canShow: 0 });
  });

  it('sets the step goal, and the member’s own settings read it back', async () => {
    const session = await signUpAndRegister();
    const res = await request(app)
      .put(`/v1/admin/users/${session.userId}/config`)
      .set(ADMIN)
      .send({ dailyStepGoal: 8000, note: 'asked on chat' });
    expect(res.status).toBe(200);
    expect(res.body.steps.goal).toMatchObject({ current: 8000 });
    expect(res.body.steps.goal.setAt).not.toBeNull();

    const mine = await request(app).get('/v1/me/settings').set(authed(session));
    expect(mine.body.dailyStepGoal).toBe(8000);
  });

  it('refuses a goal the member’s own screen would refuse', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).put(`/v1/admin/users/${session.userId}/config`).set(ADMIN).send({ dailyStepGoal: 100 });
    expect(res.status).toBe(422);
    expect(res.body.error.details.dailyStepGoal).toContain('3,000');
  });

  it('silences a category, and cannot turn one back on', async () => {
    const session = await signUpAndRegister();
    const off = await request(app)
      .put(`/v1/admin/users/${session.userId}/config`)
      .set(ADMIN)
      .send({ silence: ['activity'], quietHours: { start: '23:00' } });
    expect(off.status).toBe(200);
    expect(off.body.notifications.preferences.categories.activity).toBe(false);
    expect(off.body.notifications.preferences.changed).toBe(true);
    expect(off.body.notifications.preferences.quietHours.start).toBe('23:00');

    // There is no shape for "on": consent is the member's to give.
    const on = await request(app)
      .put(`/v1/admin/users/${session.userId}/config`)
      .set(ADMIN)
      .send({ categories: { activity: true } });
    expect(on.status).toBe(422);
  });

  it('changes the timezone a day is counted in', async () => {
    const session = await signUpAndRegister();
    const res = await request(app)
      .put(`/v1/admin/users/${session.userId}/config`)
      .set(ADMIN)
      .send({ timezone: 'Asia/Dubai' });
    expect(res.status).toBe(200);
    expect(res.body.account.timezone).toBe('Asia/Dubai');

    const nonsense = await request(app)
      .put(`/v1/admin/users/${session.userId}/config`)
      .set(ADMIN)
      .send({ timezone: 'Mars/Olympus' });
    expect(nonsense.status).toBe(422);
  });

  it('sends a message, which lands in the member’s own feed', async () => {
    const session = await signUpAndRegister();
    const sent = await request(app)
      .post(`/v1/admin/users/${session.userId}/notifications`)
      .set(ADMIN)
      .send({ topic: 'steps', title: 'About your steps', message: 'We have fixed the sync on your phone.' });
    expect(sent.status).toBe(201);
    expect(sent.body.status).toBe('created');
    // No FCM in tests and no token on the install: the row is written anyway.
    // `deferred` belongs in the list too — run this suite between 22:00 and
    // 07:00 in the member's timezone and quiet hours answer first, which is
    // the one thing this assertion must not depend on.
    expect(['no_provider', 'no_device', 'not_permitted', 'skipped', 'deferred']).toContain(sent.body.push);

    const mine = await request(app).get('/v1/notifications').set(authed(session));
    expect(mine.body.data[0]).toMatchObject({ title: 'About your steps', topic: 'steps', read: false });

    const theirs = await request(app).get(`/v1/admin/users/${session.userId}/notifications`).set(ADMIN);
    expect(theirs.body.data[0]).toMatchObject({ title: 'About your steps', pushedAt: null });
  });

  it('a message to a member who silenced that category is written and not pushed', async () => {
    const session = await signUpAndRegister();
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { 'push.token': 'tok_test' } });
    await request(app).put(`/v1/admin/users/${session.userId}/config`).set(ADMIN).send({ silence: ['activity'] });

    const sent = await request(app)
      .post(`/v1/admin/users/${session.userId}/notifications`)
      .set(ADMIN)
      .send({ topic: 'steps', title: 'Walk today', message: 'Nearly there.' });
    expect(sent.status).toBe(201);
    expect(sent.body.status).toBe('created');
    expect(sent.body.push).toBe('category_off');
    expect(await NotificationModel.countDocuments({ userId: session.userId })).toBe(1);
  });

  it('nudges each signed-in phone, and says what became of each', async () => {
    const session = await signUpAndRegister();
    const none = await request(app).post(`/v1/admin/users/${session.userId}/sync-nudge`).set(ADMIN).send({});
    expect(none.status).toBe(200);
    expect(none.body.results[0]).toMatchObject({ deviceId: session.deviceId, outcome: 'no_token' });

    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { 'push.token': 'tok_test' } });
    const withToken = await request(app).post(`/v1/admin/users/${session.userId}/sync-nudge`).set(ADMIN).send({ remind: true });
    // No provider is configured in tests, so the push cannot go — but the
    // member is still told, and that is a separate rung.
    expect(withToken.body.results[0].outcome).toBe('no_provider');
    expect(withToken.body.reminded).toBe('created');
    const feed = await request(app).get('/v1/notifications').set(authed(session));
    expect(feed.body.data[0].title).toContain('steps are not reaching us');
  });

  it('404s for an account that does not exist', async () => {
    expect((await request(app).get('/v1/admin/users/usr_nobody/config').set(ADMIN)).status).toBe(404);
    expect((await request(app).post('/v1/admin/users/usr_nobody/sync-nudge').set(ADMIN).send({})).status).toBe(404);
  });
});
