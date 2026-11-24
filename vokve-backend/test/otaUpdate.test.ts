import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { getKV } from '../src/db/redis.js';
import { DeviceModel } from '../src/modules/devices/models.js';
import { app, authed, signUpAndRegister } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

/**
 * Which over-the-air update a phone runs (D-111): the app says so in
 * `X-Vokve-Ota-Update` on every request, the device heartbeat keeps it on
 * the install, and the panel shows it — so a fault or a support question can
 * be matched to the JavaScript that was actually running.
 */

/** The heartbeat is written at most every five minutes; each step here wants the next one. */
const nextHeartbeat = () => getKV().quit();

describe('the over-the-air update an install runs (D-111)', () => {
  it('is kept on the install, cleared by builtin, and shown on the panel', async () => {
    const member = await signUpAndRegister();
    const update = '0198a7c2-5f1e-7000-8000-000000000001';

    await nextHeartbeat();
    expect((await request(app).get('/v1/me').set({ ...authed(member), 'x-vokve-ota-update': update })).status).toBe(200);
    expect((await DeviceModel.findById(member.deviceId).lean())!.app?.otaUpdate).toBe(update);

    const overview = await request(app).get(`/v1/admin/users/${member.userId}`).set(ADMIN);
    expect(overview.status).toBe(200);
    expect(overview.body.installs[0].app.otaUpdate).toBe(update);

    // Rolled back to the bundle inside the build.
    await nextHeartbeat();
    await request(app).get('/v1/me').set({ ...authed(member), 'x-vokve-ota-update': 'builtin' });
    expect((await DeviceModel.findById(member.deviceId).lean())!.app?.otaUpdate).toBeNull();

    // Anything that is not an id is not written.
    await nextHeartbeat();
    await request(app).get('/v1/me').set({ ...authed(member), 'x-vokve-ota-update': 'x'.repeat(200) });
    await request(app).get('/v1/me').set({ ...authed(member), 'x-vokve-ota-update': '<script>' });
    expect((await DeviceModel.findById(member.deviceId).lean())!.app?.otaUpdate).toBeNull();
  });
});
