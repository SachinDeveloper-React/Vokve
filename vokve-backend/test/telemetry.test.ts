import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppErrorModel, DeviceHealthModel, DevicePermissionsModel, EventModel } from '../src/modules/telemetry/models.js';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { DeviceModel } from '../src/modules/devices/models.js';
import { invalidateConfig } from '../src/config/remote.js';
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

describe('telemetry: what went wrong (RULES P17)', () => {
  const fault = (over: Record<string, unknown> = {}) => ({
    kind: 'js',
    name: 'TypeError',
    message: "undefined is not an object (evaluating 'day.steps')",
    scope: 'steps',
    screen: 'StepTracking',
    stack: 'at syncDay (steps.ts:1040)\nat flush (steps.ts:980)',
    fatal: false,
    at: new Date().toISOString(),
    sessionId: 'ses_1',
    context: { status: 500, path: '/activity/ingest' },
    ...over,
  });

  const post = (session: Session, errors: unknown[]) =>
    request(app).post('/v1/me/errors').set(authed(session)).send({ errors });

  it('groups the same fault and keeps the latest of it, rather than writing a row a throw', async () => {
    const session = await signUpAndRegister();
    const first = await post(session, [fault()]);
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ accepted: 1 });

    // The same fault twice more, the last one from a later moment.
    const later = new Date(Date.now() + 1000).toISOString();
    await post(session, [fault(), fault({ at: later, context: { status: 503 } })]);

    const rows = await AppErrorModel.find({ userId: session.userId }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      count: 3,
      kind: 'js',
      name: 'TypeError',
      scope: 'steps',
      screen: 'StepTracking',
      deviceId: session.deviceId,
      // The build it last happened on is what a fix ships against.
      platform: 'android',
      appVersion: '1.0.0',
      // The newest context wins: an older copy of the same fault says nothing new.
      context: { status: 503 },
    });
    expect(rows[0].lastAt.toISOString()).toBe(later);
    expect(rows[0].firstAt.getTime()).toBeLessThan(rows[0].lastAt.getTime());
  });

  it('tells two faults apart by message and by where they were thrown', async () => {
    const session = await signUpAndRegister();
    await post(session, [
      fault(),
      fault({ message: "undefined is not an object (evaluating 'order.id')" }),
      fault({ stack: 'at pay (payments.ts:40)' }),
    ]);

    expect(await AppErrorModel.countDocuments({ userId: session.userId })).toBe(3);
  });

  it('is kept for a member who turned analytics off — a crash is not a metric', async () => {
    const session = await signUpAndRegister();
    await request(app).put('/v1/me/privacy').set(authed(session)).send({ analytics: false });

    const res = await post(session, [fault({ kind: 'boundary', fatal: true })]);
    expect(res.body).toEqual({ accepted: 1 });
    expect(await AppErrorModel.countDocuments({ userId: session.userId })).toBe(1);
  });

  it('drops a report from a clock that is wrong rather than filing it', async () => {
    const session = await signUpAndRegister();
    const ahead = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const ancient = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const res = await post(session, [fault({ at: ahead }), fault({ at: ancient }), fault()]);
    expect(res.body).toEqual({ accepted: 1, dropped: 2 });
  });

  it('stops opening new groups past the day"s ceiling, so a crash loop cannot write without bound', async () => {
    const session = await signUpAndRegister();
    await AppConfigModel.updateOne(
      { _id: 'telemetry' },
      { $set: { value: { errors: { maxGroupsPerDevicePerDay: 2 } } } },
      { upsert: true },
    );
    invalidateConfig();

    const res = await post(session, [
      fault({ message: 'one' }),
      fault({ message: 'two' }),
      fault({ message: 'three' }),
    ]);
    expect(res.body).toEqual({ accepted: 2, dropped: 1 });
    // But a fault already grouped still counts, however many there are.
    const again = await post(session, [fault({ message: 'one' })]);
    expect(again.body).toEqual({ accepted: 1 });
    expect(await AppErrorModel.countDocuments({ userId: session.userId })).toBe(2);
  });
});

describe('telemetry: whether the phone is working (RULES P17)', () => {
  const report = {
    tracking: {
      state: 'running',
      wanted: true,
      serviceAlive: false,
      looksDead: true,
      heartbeatAgeMs: 5_400_000,
      recoveryCount: 4,
      lastRecoveryReason: 'watchdog',
      batteryOptimizationEnabled: true,
      aggressiveOem: true,
      manufacturer: 'Xiaomi',
    },
    healthConnect: { availability: 'installed', canRead: false, canWrite: false, grantedReadTypes: [] },
    sync: { status: 'failed', lastSyncedAt: null, queued: 3, error: 'No connection.', todaySteps: 4120 },
  };

  it('keeps one current verdict per install, replaced rather than appended to', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).put('/v1/me/device-health').set(authed(session)).send(report);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deviceId: session.deviceId, tracking: { looksDead: true } });

    await request(app)
      .put('/v1/me/device-health')
      .set(authed(session))
      .send({ ...report, tracking: { ...report.tracking, looksDead: false, serviceAlive: true } });

    const rows = await DeviceHealthModel.find({ userId: session.userId }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].tracking).toMatchObject({ looksDead: false, serviceAlive: true });
    expect(rows[0].appVersion).toBe('1.0.0');
  });

  it('the operator reads it beside the faults and the last upload', async () => {
    const session = await signUpAndRegister();
    await request(app).put('/v1/me/device-health').set(authed(session)).send(report);
    await request(app).post('/v1/me/errors').set(authed(session)).send({
      errors: [{ kind: 'boundary', message: 'Cannot read property of null', fatal: true, at: new Date().toISOString() }],
    });

    const res = await request(app)
      .get(`/v1/admin/users/${session.userId}/health`)
      .set({ 'x-admin-key': 'test-admin-key-test-admin-key' });
    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(1);
    expect(res.body.devices[0]).toMatchObject({
      deviceId: session.deviceId,
      signedIn: true,
      brand: 'Google',
      model: 'Pixel 8',
      // The tracker's own answer about the OEM, which is the one the
      // battery rules are about.
      health: { stale: false, tracking: { looksDead: true, manufacturer: 'Xiaomi' }, sync: { status: 'failed' } },
      // Nothing has been uploaded by this install yet, which is itself a finding.
      stepSync: { uploadedAt: null },
    });
    expect(res.body.errors).toMatchObject({ total: 1 });
    expect(res.body.errors.data[0]).toMatchObject({ kind: 'boundary', fatal: true, count: 1 });
  });

  it('says so when the verdict is too old to be called current', async () => {
    const session = await signUpAndRegister();
    await request(app).put('/v1/me/device-health').set(authed(session)).send(report);
    await DeviceHealthModel.updateOne(
      { userId: session.userId },
      { $set: { at: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
    );

    const res = await request(app)
      .get(`/v1/admin/users/${session.userId}/health`)
      .set({ 'x-admin-key': 'test-admin-key-test-admin-key' });
    expect(res.body.devices[0].health.stale).toBe(true);
  });

  it('answers the admin key alone', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get(`/v1/admin/users/${session.userId}/health`)).status).toBe(401);
  });
});

describe('telemetry: the diagnosis, in words (RULES P18)', () => {
  const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };
  const problems = (userId: string) =>
    request(app).get(`/v1/admin/users/${userId}/problems`).set(ADMIN);

  const brokenPhone = {
    tracking: {
      state: 'running',
      wanted: true,
      serviceAlive: false,
      looksDead: true,
      heartbeatAgeMs: 5_400_000,
      recoveryCount: 4,
      lastRecoveryReason: 'watchdog',
      batteryOptimizationEnabled: true,
      aggressiveOem: true,
      manufacturer: 'Xiaomi',
    },
    healthConnect: { availability: 'installed', canRead: false, canWrite: false },
    sync: { status: 'failed', lastSyncedAt: null, queued: 3, error: 'No connection.', todaySteps: 4120 },
  };

  it('names the dead counter, the battery behind it and the days that are not going up', async () => {
    const session = await signUpAndRegister();
    await request(app).put('/v1/me/device-health').set(authed(session)).send(brokenPhone);
    // Registered a week ago and has never had a snapshot accepted.
    await DeviceModel.updateOne(
      { _id: session.deviceId },
      { $set: { firstSeenAt: new Date(Date.now() - 7 * 86_400_000) } },
    );

    const res = await problems(session.userId);
    expect(res.status).toBe(200);
    const codes = res.body.findings.map((f: { code: string }) => f.code);

    // Worst first, and the one to act on is the headline.
    expect(codes[0]).toBe('tracking_service_dead');
    expect(res.body.summary.headline).toContain('stopped counting');
    expect(codes).toContain('never_uploaded');
    expect(codes).toContain('sync_failing');
    expect(codes).toContain('health_connect_not_readable');

    const dead = res.body.findings.find((f: { code: string }) => f.code === 'tracking_service_dead');
    // The sentence carries the numbers, and the fix names the real cause.
    expect(dead.detail).toContain('4 times');
    expect(dead.detail).toContain('Xiaomi');
    expect(dead.fix).toContain('battery');
    expect(dead.evidence).toMatchObject({ recoveryCount: 4, batteryOptimizationEnabled: true });
  });

  it('says when a phone is quiet rather than broken, with the clock that is running out', async () => {
    const session = await signUpAndRegister();
    await request(app)
      .put('/v1/me/device-health')
      .set(authed(session))
      .send({ tracking: { state: 'running', wanted: true, serviceAlive: true, looksDead: false }, sync: { status: 'idle', queued: 0 } });
    await DeviceModel.updateOne(
      { _id: session.deviceId },
      { $set: { 'stepSync.uploadedAt': new Date(Date.now() - 50 * 3_600_000) } },
    );

    const res = await problems(session.userId);
    const quiet = res.body.findings.find((f: { code: string }) => f.code === 'steps_not_uploading');
    expect(quiet).toMatchObject({ severity: 'high' });
    expect(quiet.title).toContain('50 hours');
    // The ingest window is what makes it urgent, and it is named.
    expect(quiet.detail).toContain('14 days');
  });

  it('a refused permission is the first thing said, because nothing else can work', async () => {
    const session = await signUpAndRegister();
    await request(app).put('/v1/me/permissions').set(authed(session)).send({
      permissions: [
        { key: 'activityRecognition', state: 'blocked', detail: 'refused twice' },
        { key: 'notifications', state: 'denied' },
      ],
    });
    // With a token on file, the refusal is the finding; without one, "cannot
    // be reached at all" is the stronger thing to say and takes its place.
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { 'push.token': 'tok-1' } });

    const res = await problems(session.userId);
    const denied = res.body.findings.find((f: { code: string }) => f.code === 'activity_permission_denied');
    expect(denied.severity).toBe('high');
    expect(denied.fix).toContain('Android Settings');
    // Their own choice about notifications is a note, not a problem.
    const notifications = res.body.findings.find((f: { code: string }) => f.code === 'notifications_refused');
    expect(notifications.severity).toBe('low');
  });

  it('counts the crashes and names the worst of them', async () => {
    const session = await signUpAndRegister();
    const at = new Date().toISOString();
    await request(app).post('/v1/me/errors').set(authed(session)).send({
      errors: [
        { kind: 'boundary', name: 'TypeError', message: 'null is not an object', screen: 'Wallet', fatal: true, at },
        { kind: 'boundary', name: 'TypeError', message: 'null is not an object', screen: 'Wallet', fatal: true, at },
        { kind: 'js', name: 'ApiError', message: 'Offline', scope: 'steps', fatal: false, at },
      ],
    });

    const res = await problems(session.userId);
    const crashing = res.body.findings.find((f: { code: string }) => f.code === 'app_crashing');
    expect(crashing.severity).toBe('high');
    expect(crashing.title).toContain('2 times');
    expect(crashing.detail).toContain('null is not an object');
  });

  it('a healthy member gets an empty verdict, not a reassuring guess', async () => {
    const session = await signUpAndRegister();
    await request(app)
      .put('/v1/me/device-health')
      .set(authed(session))
      .send({ tracking: { state: 'running', wanted: true, serviceAlive: true, looksDead: false }, sync: { status: 'idle', queued: 0 } });
    await DeviceModel.updateOne(
      { _id: session.deviceId },
      { $set: { 'stepSync.uploadedAt': new Date(), 'push.token': 'tok-1' } },
    );
    await request(app).put('/v1/me/permissions').set(authed(session)).send({
      permissions: [{ key: 'activityRecognition', state: 'granted' }, { key: 'notifications', state: 'granted' }],
    });

    const res = await problems(session.userId);
    expect(res.body.findings).toEqual([]);
    expect(res.body.summary).toMatchObject({ headline: null, high: 0, installs: 1, signedIn: 1 });
  });

  it('answers the admin key alone', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get(`/v1/admin/users/${session.userId}/problems`)).status).toBe(401);
  });
});

describe('telemetry: the fleet (RULES P18)', () => {
  const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

  it('counts each problem across installs, names the OEM behind the dead ones, and ranks the faults', async () => {
    const xiaomi = await signUpAndRegister();
    const pixel = await signUpAndRegister();
    const at = new Date().toISOString();

    await request(app).put('/v1/me/device-health').set(authed(xiaomi)).send({
      tracking: { looksDead: true, batteryOptimizationEnabled: true, aggressiveOem: true, manufacturer: 'Xiaomi' },
      sync: { status: 'failed', queued: 2 },
    });
    await request(app).put('/v1/me/device-health').set(authed(pixel)).send({
      tracking: { looksDead: false, serviceAlive: true, batteryOptimizationEnabled: false, aggressiveOem: false, manufacturer: 'Google' },
      sync: { status: 'idle', queued: 0 },
    });

    // The same fault on two accounts, and one of them twice.
    const crash = { kind: 'boundary', name: 'TypeError', message: 'x is not a function', fatal: true, at };
    await request(app).post('/v1/me/errors').set(authed(xiaomi)).send({ errors: [crash, crash] });
    await request(app).post('/v1/me/errors').set(authed(pixel)).send({ errors: [crash] });
    await request(app).post('/v1/me/errors').set(authed(pixel)).send({
      errors: [{ kind: 'js', message: 'Offline', scope: 'steps', fatal: false, at }],
    });

    const res = await request(app).get('/v1/admin/health/fleet?days=7').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.installs).toMatchObject({ total: 2, signedIn: 2, reportingHealth: 2, quiet: 2 });

    const problems = new Map<string, number>(
      res.body.problems.map((p: { code: string; installs: number }) => [p.code, p.installs]),
    );
    expect(problems.get('tracking_service_dead')).toBe(1);
    expect(problems.get('battery_restricted')).toBe(1);
    expect(problems.get('sync_failing')).toBe(1);
    // Neither phone has uploaded anything yet.
    expect(problems.get('steps_not_uploading')).toBe(2);

    const xiaomiRow = res.body.byManufacturer.find((m: { manufacturer: string }) => m.manufacturer === 'Xiaomi');
    expect(xiaomiRow).toMatchObject({ installs: 1, serviceDead: 1, batteryRestricted: 1 });

    // The fatal one first, with both accounts counted and the occurrences added up.
    expect(res.body.topErrors[0]).toMatchObject({
      message: 'x is not a function',
      fatal: true,
      users: 2,
      occurrences: 3,
      appVersions: ['1.0.0'],
    });
    expect(res.body.byAppVersion[0]).toMatchObject({ appVersion: '1.0.0', installs: 2, fatalGroups: 2 });
  });

  it('answers the admin key alone', async () => {
    expect((await request(app).get('/v1/admin/health/fleet')).status).toBe(401);
  });
});
