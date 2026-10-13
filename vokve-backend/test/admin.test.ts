import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DeviceModel } from '../src/modules/devices/models.js';
import { OrderModel } from '../src/modules/commerce/models.js';
import { credit } from '../src/modules/economy/service.js';
import { app, authed, baseHeaders, signUpAndRegister, type Session } from './helpers.js';

/** The operator's key, as `test/setup.ts` configures it. */
const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

function screenView(screen: string, at = new Date()) {
  return { name: 'screen_view', at: at.toISOString(), sessionId: 'ses_1', props: { screen } };
}

async function send(session: Session, events: unknown[]) {
  return request(app).post('/v1/events').set(authed(session)).send({ events });
}

const ALL_GRANTED = [
  { key: 'activityRecognition', state: 'granted' },
  { key: 'notifications', state: 'granted' },
  { key: 'healthConnectReadSteps', state: 'granted' },
  { key: 'healthConnectWriteSteps', state: 'denied', detail: 'not asked yet' },
  { key: 'batteryUnrestricted', state: 'denied', detail: 'aggressive OEM' },
  { key: 'camera', state: 'unknown' },
  { key: 'photos', state: 'unavailable' },
];

describe('admin: the trail and the permissions (BACKEND §14.14)', () => {
  it('answers the admin key alone', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get(`/v1/admin/users/${session.userId}/activity`)).status).toBe(401);
    expect((await request(app).get('/v1/admin/users').set({ 'x-admin-key': 'wrong' })).status).toBe(401);
    expect((await request(app).get('/v1/admin/users').set(ADMIN)).status).toBe(200);
  });

  it('finds the account by email, and says how many phones it has', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).get('/v1/admin/users').query({ q: session.email }).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: session.userId, email: session.email, devices: 1 });
    expect(res.body.data[0].lastSeenAt).not.toBeNull();
  });

  it('gives the trail newest first, filtered by name, and cursored', async () => {
    const session = await signUpAndRegister();
    await send(session, [screenView('Home'), screenView('Shop'), { name: 'order_paid', at: new Date().toISOString(), props: { coins: 300 } }]);

    const all = await request(app).get(`/v1/admin/users/${session.userId}/activity`).set(ADMIN);
    expect(all.body.data).toHaveLength(3);
    expect(all.body.nextCursor).toBeNull();

    const orders = await request(app).get(`/v1/admin/users/${session.userId}/activity`).query({ name: 'order_paid' }).set(ADMIN);
    expect(orders.body.data).toHaveLength(1);
    expect(orders.body.data[0]).toMatchObject({ name: 'order_paid', props: { coins: 300 }, deviceId: session.deviceId });

    const firstPage = await request(app).get(`/v1/admin/users/${session.userId}/activity`).query({ limit: 2 }).set(ADMIN);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.nextCursor).not.toBeNull();
    const second = await request(app).get(`/v1/admin/users/${session.userId}/activity`)
      .query({ limit: 2, cursor: firstPage.body.nextCursor }).set(ADMIN);
    expect(second.body.data).toHaveLength(1);
  });

  it('summarises which screens they open, what they do, and the days they did it', async () => {
    const session = await signUpAndRegister();
    await send(session, [
      screenView('Home'),
      screenView('Home'),
      screenView('Shop'),
      { name: 'water_logged', at: new Date().toISOString(), sessionId: 'ses_1', props: { ml: 250 } },
    ]);

    const res = await request(app).get(`/v1/admin/users/${session.userId}/activity/summary`).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ days: 7, events: 4, sessions: 1, timezone: 'Asia/Kolkata' });
    expect(res.body.screens).toEqual([
      expect.objectContaining({ screen: 'Home', views: 2 }),
      expect.objectContaining({ screen: 'Shop', views: 1 }),
    ]);
    expect(res.body.actions).toEqual([expect.objectContaining({ name: 'water_logged', count: 1 })]);
    expect(res.body.byDay).toHaveLength(1);
    expect(res.body.byDay[0]).toMatchObject({ events: 4, screens: 3 });
    expect((await request(app).get('/v1/admin/users/usr_nobody/activity/summary').set(ADMIN)).status).toBe(404);
  });

  it('lists every phone with what it allows, its change history, and whether it can be pushed to', async () => {
    const session = await signUpAndRegister();
    await request(app).put('/v1/me/permissions').set(authed(session)).send({ permissions: ALL_GRANTED });
    await request(app).put('/v1/me/permissions').set(authed(session))
      .send({ permissions: ALL_GRANTED.map(p => (p.key === 'activityRecognition' ? { ...p, state: 'denied' } : p)) });

    const res = await request(app).get(`/v1/admin/users/${session.userId}/permissions`).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const device = res.body.data[0];
    expect(device).toMatchObject({ deviceId: session.deviceId, platform: 'android', model: 'Pixel 8', hasPushToken: false, revoked: false });
    expect(device.permissions.find((p: { key: string }) => p.key === 'activityRecognition')).toMatchObject({ state: 'denied' });
    expect(device.history[0]).toMatchObject({ key: 'activityRecognition', from: 'granted', to: 'denied' });
    expect(device.reportedAt).not.toBeNull();
  });

  it('lists a phone that has reported nothing, with an empty set rather than a gap', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).get(`/v1/admin/users/${session.userId}/permissions`).set(ADMIN);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ permissions: [], history: [], reportedAt: null });
  });
});

describe('admin: one member in full (RULES P16)', () => {
  it('says who they are, when they installed it, on what, and when they were last here', async () => {
    const session = await signUpAndRegister();
    await send(session, [screenView('Home'), { name: 'water_logged', at: new Date().toISOString(), props: { ml: 250 } }]);
    await request(app).put('/v1/me/permissions').set(authed(session)).send({ permissions: ALL_GRANTED });

    const res = await request(app).get(`/v1/admin/users/${session.userId}`).set(ADMIN);
    expect(res.status).toBe(200);

    expect(res.body.account).toMatchObject({
      id: session.userId,
      email: session.email,
      phone: session.phone,
      trust: { tier: 'normal' },
      flags: { frozen: false, legalHold: false },
    });
    expect(res.body.account.signedUpAt).not.toBeNull();
    // The code went to the email in tests, so the phone is still unproven.
    expect(res.body.account.emailVerifiedAt).not.toBeNull();

    expect(res.body.counts).toMatchObject({ devices: 1, activeDevices: 1, liveSessions: 1 });

    const [install] = res.body.installs;
    expect(install).toMatchObject({
      deviceId: session.deviceId,
      platform: 'android',
      signedIn: true,
      logins: 1,
    });
    expect(install.device).toMatchObject({ brand: 'Google', model: 'Pixel 8', osVersion: '14', isEmulator: false });
    // What they installed, and what they are running now.
    expect(install.app).toMatchObject({ version: '1.0.0', build: '1', firstVersion: '1.0.0', bundleId: 'com.vokve' });
    expect(install.installedAt).not.toBeNull();
    expect(install.lastActiveAt).not.toBeNull();
    expect(install.signedInAt).not.toBeNull();
    expect(install.lastSignedOutAt).toBeNull();
    expect(install.session).toMatchObject({ live: true });
    expect(install.push.hasToken).toBe(false);
    expect(install.permissions.granted).toContain('notifications');
    expect(install.permissions.denied).toContain('batteryUnrestricted');

    expect(res.body.activity).toMatchObject({ events: 2, events7d: 2, lastScreen: 'Home' });
    expect(res.body.activity.lastActiveAt).not.toBeNull();
    expect(res.body.wallet).toMatchObject({ balance: 0, pending: 0, lifetimeEarned: 0 });
    expect(res.body.orders).toMatchObject({ count: 0, payable: 0, coinsUsed: 0, lastAt: null });
  });

  it('carries the wallet and the orders, so a support question needs one call', async () => {
    const session = await signUpAndRegister();
    await credit({
      userId: session.userId, source: 'refund', referenceType: 'test', referenceId: 'fund',
      amount: 500, title: 'Test funds', localDay: '2026-10-13', exemptFromCap: true,
    });
    await OrderModel.create({
      _id: 'ord_test', number: 'VKV1', userId: session.userId, status: 'placed',
      subtotal: 100_000, total: 100_000, payable: 70_000, coinsUsed: 300_000, coinsValue: 30_000,
      addressSnapshot: { name: 'Asha Verma', line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
    });

    const res = await request(app).get(`/v1/admin/users/${session.userId}`).set(ADMIN);
    expect(res.body.wallet).toMatchObject({ balance: 500, lifetimeEarned: 500 });
    expect(res.body.orders).toMatchObject({ count: 1, payable: 70_000, coinsUsed: 300 });
    expect(res.body.orders.lastAt).not.toBeNull();
  });

  it('a phone signed out is still listed, with when that happened', async () => {
    const session = await signUpAndRegister();
    await request(app).post('/v1/auth/sign-out').set(authed(session));

    const res = await request(app).get(`/v1/admin/users/${session.userId}`).set(ADMIN);
    const [install] = res.body.installs;
    expect(install.signedIn).toBe(false);
    expect(install.lastSignedOutAt).not.toBeNull();
    expect(install.session.live).toBe(false);
    expect(res.body.counts.liveSessions).toBe(0);
  });

  it('404s for an account that does not exist', async () => {
    expect((await request(app).get('/v1/admin/users/usr_nobody').set(ADMIN)).status).toBe(404);
    expect((await request(app).get('/v1/admin/users/usr_nobody/logins').set(ADMIN)).status).toBe(200);
  });

  it('answers the admin key alone here too', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get(`/v1/admin/users/${session.userId}`)).status).toBe(401);
    expect((await request(app).get(`/v1/admin/users/${session.userId}/logins`).set({ 'x-admin-key': 'wrong' })).status).toBe(401);
  });
});

describe('admin: sign-ins (RULES P16)', () => {
  it('lists every sign-in newest first, with the phone and the build', async () => {
    const session = await signUpAndRegister();
    // A sign-out, then a sign-in again on the same phone: two periods.
    await request(app).post('/v1/auth/sign-out').set(authed(session));
    const again = await request(app).post('/v1/auth/sign-in').set({ ...baseHeaders, 'x-vokve-device-id': session.deviceId })
      .send({ email: session.email, password: 'walk1000steps' });
    expect(again.status).toBe(200);

    const res = await request(app).get(`/v1/admin/users/${session.userId}/logins`).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data[0]).toMatchObject({
      deviceId: session.deviceId,
      platform: 'android',
      model: 'Pixel 8',
      appVersion: '1.0.0',
      open: true,
    });
    expect(res.body.data[0].until).toBeNull();
    // Newest first: the earlier period is the one that was closed.
    expect(res.body.data[1].open).toBe(false);
    expect(res.body.data[1].until).not.toBeNull();
    expect(res.body.data[1].at <= res.body.data[0].at).toBe(true);
  });

  it('counts the sign-ins on every phone, and keeps the newest page to the limit', async () => {
    const session = await signUpAndRegister();
    await DeviceModel.updateOne(
      { _id: session.deviceId },
      {
        $set: {
          counting: [
            { from: new Date('2026-10-01T06:00:00Z'), to: new Date('2026-10-02T06:00:00Z'), appVersion: '0.9.0' },
            { from: new Date('2026-10-05T06:00:00Z'), to: new Date('2026-10-06T06:00:00Z'), appVersion: '1.0.0' },
            { from: new Date('2026-10-10T06:00:00Z'), to: null, appVersion: '1.0.0' },
          ],
        },
      },
    );
    const res = await request(app).get(`/v1/admin/users/${session.userId}/logins`).query({ limit: 2 }).set(ADMIN);
    expect(res.body.total).toBe(3);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ at: '2026-10-10T06:00:00.000Z', open: true });
    expect(res.body.data[1]).toMatchObject({ at: '2026-10-05T06:00:00.000Z', appVersion: '1.0.0', open: false });

    const overview = await request(app).get(`/v1/admin/users/${session.userId}`).set(ADMIN);
    expect(overview.body.counts.logins).toBe(3);
    expect(overview.body.installs[0].logins).toBe(3);
  });
});

describe('admin: finding the account (RULES P15)', () => {
  it('says what each account is running and when it installed it', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).get('/v1/admin/users').query({ q: session.phone }).set(ADMIN);
    expect(res.body.data[0]).toMatchObject({
      id: session.userId,
      platform: 'android',
      appVersion: '1.0.0',
      devices: 1,
      deleted: false,
    });
    expect(res.body.data[0].installedAt).not.toBeNull();
    expect(res.body.data[0].createdAt).not.toBeNull();
  });

  it('finds nobody without inventing anybody', async () => {
    await signUpAndRegister();
    const res = await request(app).get('/v1/admin/users').query({ q: 'nobody@example.com' }).set(ADMIN);
    expect(res.body.data).toEqual([]);
  });
});
