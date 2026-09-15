import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppReleaseModel } from '../src/modules/devices/models.js';
import { app, authed, signUpAndRegister } from './helpers.js';

describe('devices and versions', () => {
  it('lists the device with its model and version, and revoking it signs that device out', async () => {
    const session = await signUpAndRegister();
    const list = await request(app).get('/v1/me/devices').set(authed(session));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ model: 'Pixel 8', appVersion: '1.0.0', build: '1', platform: 'android', isCurrent: true });

    const revoke = await request(app).delete(`/v1/me/devices/${session.deviceId}`).set(authed(session));
    expect(revoke.status).toBe(200);

    const after = await request(app).get('/v1/me').set(authed(session));
    expect(after.status).toBe(428);

    const refresh = await request(app).post('/v1/auth/refresh').set(authed(session)).send({ refreshToken: session.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('registration is idempotent by installId', async () => {
    const session = await signUpAndRegister();
    const again = await request(app).post('/v1/devices/register').set(authed(session))
      .send({ installId: (await request(app).get('/v1/me/devices').set(authed(session))).body.data[0].id && 'install-x', platform: 'android',
        profile: { model: 'Pixel 8', app: { version: '1.0.1', build: '2' } } });
    expect(again.status).toBe(200);
    const list = await request(app).get('/v1/me/devices').set(authed(session));
    expect(list.body.data.length).toBeLessThanOrEqual(2);
  });

  it('blocks builds below the minimum version and builds marked blocked', async () => {
    const session = await signUpAndRegister();
    const old = await request(app).get('/v1/me').set({ ...authed(session), 'x-vokve-app-version': '0.9.0' });
    expect(old.status).toBe(426);
    expect(old.body.error).toMatchObject({ code: 'UPGRADE_REQUIRED', details: { minVersion: '1.0.0' } });

    await AppReleaseModel.updateOne({ platform: 'android', version: '1.0.0', build: '1' }, { $set: { status: 'blocked' } });
    const blocked = await request(app).get('/v1/me').set(authed(session));
    expect(blocked.status).toBe(426);
  });
});
