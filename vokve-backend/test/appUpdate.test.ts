import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { invalidateConfig } from '../src/config/remote.js';
import { AppReleaseModel } from '../src/modules/devices/models.js';
import { AppConfigModel, AuditLogModel } from '../src/modules/platform/models.js';
import { app, authed, baseHeaders, signUpAndRegister } from './helpers.js';
import { seed } from '../src/seed/seed.js';

/**
 * What a build is told about its own version (RULES DV12): silence, a knock,
 * or a wall — and the two operator calls that decide which.
 */

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

/** The headers a build of this version and build number sends. */
const asBuild = (version: string, build = '1') => ({
  ...baseHeaders,
  'x-vokve-app-version': version,
  'x-vokve-build': build,
});

async function release(fields: Record<string, unknown>) {
  const res = await request(app).post('/v1/admin/releases').set(ADMIN).send(fields);
  if (res.status !== 201) throw new Error(`release failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function policy(fields: Record<string, unknown>) {
  return request(app).put('/v1/admin/app/update-policy').set(ADMIN).send(fields);
}

const update = (version: string, build = '1') =>
  request(app).get('/v1/app/update').set(asBuild(version, build));

describe('app update: what a build is told (RULES DV12)', () => {
  it('says nothing to the build the store is serving', async () => {
    await seed();
    await release({ platform: 'android', version: '1.2.0', build: '12', status: 'current' });

    const res = await update('1.2.0', '12');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'none',
      reason: null,
      installed: { version: '1.2.0', build: '12' },
      latest: { version: '1.2.0', build: '12' },
      minVersion: '1.0.0',
      dismissible: true,
      remindAfterHours: null,
    });
    expect(res.body.storeUrl).toContain('play.google.com');
  });

  it('knocks — softly, with a way out — when there is something newer', async () => {
    await seed();
    await release({ platform: 'android', version: '1.3.0', build: '13', status: 'current', notes: 'Faster step sync.' });

    const res = await update('1.2.0', '12');
    expect(res.body).toMatchObject({
      status: 'soft',
      reason: 'newer_available',
      dismissible: true,
      remindAfterHours: 24,
      laterLabel: 'Later',
      actionLabel: 'Update now',
    });
    expect(res.body.title).toBe('A new VOKVE is out');
    expect(res.body.message).toContain('1.3.0');
    expect(res.body.latest).toMatchObject({ version: '1.3.0', notes: 'Faster step sync.' });
  });

  it('keeps quiet about a newer release where the operator would rather it did', async () => {
    await seed();
    await release({ platform: 'android', version: '1.3.0', build: '13', status: 'current' });
    expect((await policy({ nudgeOnNewer: false })).status).toBe(200);

    expect((await update('1.2.0', '12')).body).toMatchObject({ status: 'none', reason: null });
  });

  it('knocks for a version the operator has deprecated, even with nudging off', async () => {
    await seed();
    await release({ platform: 'android', version: '1.3.0', build: '13', status: 'current' });
    await release({ platform: 'android', version: '1.2.0', build: '12', status: 'deprecated' });
    await policy({ nudgeOnNewer: false });

    expect((await update('1.2.0', '12')).body).toMatchObject({ status: 'soft', reason: 'deprecated' });
  });

  it('walls off a build below the minimum, with no way out and the store to go to', async () => {
    await seed();
    // Signed up before the wall goes up: the helper's own headers say 1.0.0,
    // and the gate would refuse them afterwards — which is the point of it.
    const session = await signUpAndRegister();
    await release({ platform: 'android', version: '1.3.0', build: '13', status: 'current' });
    const raised = await policy({ minVersion: { android: '1.3.0' } });
    expect(raised.status).toBe(200);
    expect(raised.body.minVersion.android).toBe('1.3.0');

    const res = await update('1.2.0', '12');
    expect(res.body).toMatchObject({
      status: 'hard',
      reason: 'below_min',
      dismissible: false,
      laterLabel: null,
      remindAfterHours: null,
      minVersion: '1.3.0',
    });
    expect(res.body.title).toBe('Update VOKVE to continue');
    expect(res.body.message).toContain('1.2.0');
    expect(res.body.message).toContain('1.3.0');

    // And the version gate is already refusing that build everywhere else.
    const gated = await request(app).get('/v1/me').set({ ...authed(session), ...asBuild('1.2.0', '12') });
    expect(gated.status).toBe(426);
    expect(gated.body.error).toMatchObject({ code: 'UPGRADE_REQUIRED', details: { minVersion: '1.3.0' } });
    // The update endpoint itself still answers it — it is how the wall is drawn.
    expect((await update('1.2.0', '12')).status).toBe(200);
  });

  it('walls off one broken build without moving the minimum for everybody', async () => {
    await seed();
    await release({ platform: 'android', version: '1.3.0', build: '13', status: 'current' });
    await release({ platform: 'android', version: '1.3.0', build: '14', status: 'blocked' });

    expect((await update('1.3.0', '14')).body).toMatchObject({ status: 'hard', reason: 'blocked_build' });
    // The same version on the good build is fine.
    expect((await update('1.3.0', '13')).body).toMatchObject({ status: 'none' });
  });

  it('answers a build the server has never heard of, pointing at the newest there is', async () => {
    await seed();
    await release({ platform: 'android', version: '1.3.0', build: '13', status: 'current' });
    const res = await update('1.2.5', '99');
    expect(res.body).toMatchObject({ status: 'soft', reason: 'newer_available' });
    expect(res.body.latest.version).toBe('1.3.0');
  });

  it('takes its words from the server, so a wall can be reworded without an app', async () => {
    await seed();
    await release({ platform: 'android', version: '2.0.0', build: '20', status: 'current' });
    await policy({
      minVersion: { android: '2.0.0' },
      hardTitle: 'Zaroori update',
      hardMessage: 'Purana version {version} band ho gaya. {latest} install karein.',
    });

    const res = await update('1.0.0', '1');
    expect(res.body).toMatchObject({ status: 'hard', title: 'Zaroori update' });
    expect(res.body.message).toBe('Purana version 1.0.0 band ho gaya. 2.0.0 install karein.');
  });
});

describe('app update: the operator side (RULES DV12)', () => {
  it('records a release, keeps one current per platform, and is idempotent on the build', async () => {
    await seed();
    await release({ platform: 'android', version: '1.2.0', build: '12', status: 'current' });
    await release({ platform: 'android', version: '1.3.0', build: '13', status: 'current', notes: 'Shop' });

    const rows = await AppReleaseModel.find({ platform: 'android' }).sort({ version: 1 }).lean();
    const byVersion = new Map(rows.map(row => [row.version, row]));
    expect(byVersion.get('1.2.0')?.status).toBe('supported');
    expect(byVersion.get('1.3.0')?.status).toBe('current');

    // The same build again updates it rather than adding a second row.
    await release({ platform: 'android', version: '1.3.0', build: '13', status: 'current', notes: 'Shop and cart' });
    expect(await AppReleaseModel.countDocuments({ platform: 'android', version: '1.3.0', build: '13' })).toBe(1);
    expect((await AppReleaseModel.findOne({ version: '1.3.0', build: '13' }).lean())?.notes).toBe('Shop and cart');

    const list = await request(app).get('/v1/admin/releases').query({ platform: 'android' }).set(ADMIN);
    expect(list.status).toBe(200);
    expect(list.body.minVersion.android).toBe('1.0.0');
    expect(list.body.data[0]).toMatchObject({ version: '1.3.0', status: 'current', refused: false });
    expect(await AuditLogModel.countDocuments({ action: 'app.release_saved' })).toBeGreaterThan(0);
  });

  it('refuses a minimum that would leave members with nowhere to go', async () => {
    await seed();
    await release({ platform: 'android', version: '1.3.0', build: '13', status: 'current' });

    const res = await policy({ minVersion: { android: '1.4.0' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'NO_BUILD_TO_UPDATE_TO', details: { currentRelease: '1.3.0' } });
    // Nothing moved.
    expect((await update('1.2.0', '12')).body.status).toBe('soft');
  });

  it('lets the wall come down again', async () => {
    await seed();
    await release({ platform: 'android', version: '1.3.0', build: '13', status: 'current' });
    await policy({ minVersion: { android: '1.3.0' } });
    expect((await update('1.2.0', '12')).body.status).toBe('hard');

    await policy({ minVersion: { android: '1.0.0' } });
    expect((await update('1.2.0', '12')).body.status).toBe('soft');
    expect(await AuditLogModel.countDocuments({ action: 'app.update_policy' })).toBe(2);
  });

  it('answers the admin key alone, and refuses a version that is not one', async () => {
    await seed();
    expect((await request(app).get('/v1/admin/releases')).status).toBe(401);
    expect((await request(app).post('/v1/admin/releases').set({ 'x-admin-key': 'wrong' }).send({})).status).toBe(401);
    expect(
      (await request(app).post('/v1/admin/releases').set(ADMIN).send({ platform: 'android', version: 'latest', build: '1' })).status,
    ).toBe(422);
    expect((await policy({})).status).toBe(422);
  });

  it('is the same config the gate reads, so the two can never disagree', async () => {
    await seed();
    const session = await signUpAndRegister();
    await release({ platform: 'android', version: '1.3.0', build: '13', status: 'current' });
    await policy({ minVersion: { android: '1.3.0' } });
    invalidateConfig();

    const stored = await AppConfigModel.findById('app').lean();
    expect((stored?.value as { minVersion: { android: string } }).minVersion.android).toBe('1.3.0');
    expect((await request(app).get('/v1/me').set({ ...authed(session), ...asBuild('1.2.0', '12') })).status).toBe(426);
    // The build that is current is served as it always was.
    expect((await request(app).get('/v1/me').set({ ...authed(session), ...asBuild('1.3.0', '13') })).status).toBe(200);
  });
});
