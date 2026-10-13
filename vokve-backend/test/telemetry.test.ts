import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DevicePermissionsModel, EventModel } from '../src/modules/telemetry/models.js';
import { app, authed, baseHeaders, signUpAndRegister, type Session } from './helpers.js';

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

describe('telemetry: the trail (PRD ADV2)', () => {
  it('files a batch with the device and the build taken from the request, not the body', async () => {
    const session = await signUpAndRegister();
    const res = await send(session, [screenView('Home'), { name: 'water_logged', at: new Date().toISOString(), props: { ml: 250 } }]);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 2 });

    const rows = await EventModel.find({ userId: session.userId }).sort({ name: 1 }).lean();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'screen_view',
      screen: 'Home',
      sessionId: 'ses_1',
      deviceId: session.deviceId,
      platform: 'android',
      appVersion: '1.0.0',
      build: '1',
      osVersion: '14',
      timezone: 'Asia/Kolkata',
    });
    expect(rows[1]).toMatchObject({ name: 'water_logged', props: { ml: 250 }, screen: null });
  });

  it('needs a session and a registered device', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).post('/v1/events').set(baseHeaders).send({ events: [screenView('Home')] })).status).toBe(401);
    const noDevice = await request(app).post('/v1/events')
      .set({ ...baseHeaders, authorization: `Bearer ${session.accessToken}` })
      .send({ events: [screenView('Home')] });
    expect(noDevice.status).toBe(428);
  });

  it('refuses a name that is not an event name, and a batch that is too big', async () => {
    const session = await signUpAndRegister();
    expect((await send(session, [{ name: 'Screen View!', at: new Date().toISOString() }])).status).toBe(422);
    expect((await send(session, Array.from({ length: 101 }, () => screenView('Home')))).status).toBe(422);
  });

  it('drops a row older than a month and pulls a phone clock running ahead back to now', async () => {
    const session = await signUpAndRegister();
    const ancient = screenView('Home', new Date(Date.now() - 40 * 86_400_000));
    const future = screenView('Shop', new Date(Date.now() + 3 * 60 * 60 * 1000));
    const res = await send(session, [ancient, future]);
    expect(res.body).toEqual({ accepted: 1, dropped: 1 });

    const [row] = await EventModel.find({ userId: session.userId }).lean();
    expect(row.screen).toBe('Shop');
    expect(row.at.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 1_000);
  });

  it('takes the batch and writes nothing for a member who turned usage analytics off (RULES P7)', async () => {
    const session = await signUpAndRegister();
    await request(app).put('/v1/me/privacy').set(authed(session)).send({ analytics: false });
    const res = await send(session, [screenView('Home')]);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: 0, dropped: 1 });
    expect(await EventModel.countDocuments({ userId: session.userId })).toBe(0);
  });
});

describe('telemetry: what the phone allows (RULES P14)', () => {
  it('keeps the whole set, dates each answer, and reads back', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).put('/v1/me/permissions').set(authed(session)).send({ permissions: ALL_GRANTED });
    expect(res.status).toBe(200);
    expect(res.body.deviceId).toBe(session.deviceId);
    expect(res.body.permissions).toHaveLength(ALL_GRANTED.length);
    const battery = res.body.permissions.find((p: { key: string }) => p.key === 'batteryUnrestricted');
    expect(battery).toMatchObject({ state: 'denied', detail: 'aggressive OEM' });
    expect(typeof battery.since).toBe('string');

    const read = await request(app).get('/v1/me/permissions').set(authed(session));
    expect(read.body.permissions).toHaveLength(ALL_GRANTED.length);
    expect(read.body.updatedAt).not.toBeNull();
  });

  it('keeps "since" while an answer stands, and records the change when it moves', async () => {
    const session = await signUpAndRegister();
    const first = await request(app).put('/v1/me/permissions').set(authed(session)).send({ permissions: ALL_GRANTED });
    const grantedSince = first.body.permissions.find((p: { key: string }) => p.key === 'notifications').since;

    const again = await request(app).put('/v1/me/permissions').set(authed(session)).send({ permissions: ALL_GRANTED });
    expect(again.body.permissions.find((p: { key: string }) => p.key === 'notifications').since).toBe(grantedSince);

    const revoked = ALL_GRANTED.map(p => (p.key === 'notifications' ? { ...p, state: 'blocked' } : p));
    const third = await request(app).put('/v1/me/permissions').set(authed(session)).send({ permissions: revoked });
    const notifications = third.body.permissions.find((p: { key: string }) => p.key === 'notifications');
    expect(notifications.state).toBe('blocked');
    expect(notifications.since).not.toBe(grantedSince);

    const stored = await DevicePermissionsModel.findById(`${session.userId}:${session.deviceId}`).lean();
    expect(stored!.history[0]).toMatchObject({ key: 'notifications', from: 'granted', to: 'blocked' });
  });

  it('refuses a permission it does not know and a state it does not know', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).put('/v1/me/permissions').set(authed(session))
      .send({ permissions: [{ key: 'contacts', state: 'granted' }] })).status).toBe(422);
    expect((await request(app).put('/v1/me/permissions').set(authed(session))
      .send({ permissions: [{ key: 'camera', state: 'maybe' }] })).status).toBe(422);
  });

  it('is kept for a member who turned analytics off — it is support state, not a metric', async () => {
    const session = await signUpAndRegister();
    await request(app).put('/v1/me/privacy').set(authed(session)).send({ analytics: false });
    await request(app).put('/v1/me/permissions').set(authed(session)).send({ permissions: ALL_GRANTED });
    const read = await request(app).get('/v1/me/permissions').set(authed(session));
    expect(read.body.permissions).toHaveLength(ALL_GRANTED.length);
  });
});
