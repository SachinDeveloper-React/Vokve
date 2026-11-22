import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { getKV } from '../src/db/redis.js';
import { totpAt, totpCounter } from '../src/lib/totp.js';
import { registered } from '../src/modules/staff/guard.js';
import { StaffActivityModel, StaffModel } from '../src/modules/staff/models.js';
import { ROUTE_PERMISSIONS } from '../src/modules/staff/permissions.js';
import { app, signUpAndRegister } from './helpers.js';

/**
 * Staff accounts and the hierarchy (RULES Z9): admin → manager → agent,
 * every admin route behind a permission, every request on the log.
 */

const ROOT = { 'x-admin-key': 'test-admin-key-test-admin-key' };
const IP = '::ffff:127.0.0.1';
let counter = 0;
const nextEmail = (role: string) => `${role}${++counter}@staff.vokve.test`;
const as = (token: string) => ({ 'x-staff-session': token });

async function clearThrottles() {
  for (const key of ['rl:staff-login-ip-burst', 'rl:staff-login-ip', 'admin-auth-lock', 'rl:admin-auth-fail']) await getKV().del(`${key}:${IP}`);
}

beforeEach(clearThrottles);

type Person = { id: string; email: string; password: string; secret: string; token: string };

async function create(by: Record<string, string>, body: Record<string, unknown>) {
  const res = await request(app).post('/v1/admin/staff').set(by).send(body);
  return res;
}

/** First sign-in the way the panel walks it: temporary password → new password → authenticator. */
async function onboard(email: string, temporary: string): Promise<Omit<Person, 'id'>> {
  await clearThrottles();
  const first = await request(app).post('/v1/admin/staff/login').send({ email, password: temporary });
  expect(first.status).toBe(200);
  expect(first.body.setup).toEqual({ changePassword: true, enrollTotp: true });
  const token = first.body.token as string;

  // Until set up, nothing but setup opens.
  const early = await request(app).get('/v1/admin/users').set(as(token));
  expect(early.status, JSON.stringify(early.body)).toBe(403);
  expect(early.body.error.code).toBe('STAFF_SETUP_REQUIRED');

  const password = 'a-new-password-42';
  expect((await request(app).post('/v1/admin/staff/me/password').set(as(token)).send({ currentPassword: temporary, newPassword: password })).status).toBe(200);
  const setup = await request(app).post('/v1/admin/staff/me/totp/setup').set(as(token));
  expect(setup.status).toBe(200);
  const secret = setup.body.secret as string;
  expect(setup.body.uri).toContain('otpauth://totp/');
  const confirmed = await request(app).post('/v1/admin/staff/me/totp/confirm').set(as(token)).send({ code: totpAt(secret, totpCounter()) });
  expect(confirmed.status).toBe(200);
  return { email, password, secret, token };
}

async function login(person: { email: string; password: string; secret: string }): Promise<string> {
  await clearThrottles();
  // Each 30-second step opens once; tests sign in faster than that.
  await StaffModel.updateOne({ email: person.email }, { $set: { 'totp.lastStep': null } });
  const res = await request(app).post('/v1/admin/staff/login').send({ email: person.email, password: person.password, code: totpAt(person.secret, totpCounter()) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.token;
}

async function person(by: Record<string, string>, role: 'admin' | 'manager' | 'agent', extra: Record<string, unknown> = {}): Promise<Person> {
  const email = nextEmail(role);
  const created = await create(by, { name: `${role} ${counter}`, email, role, ...extra });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const ready = await onboard(email, created.body.temporaryPassword);
  return { id: created.body.staff.id, ...ready };
}

describe('every admin route has an owner', () => {
  it('registers no route without a permission, and lists none that does not exist', () => {
    const declared = Object.keys(ROUTE_PERMISSIONS);
    expect([...registered].sort()).toEqual([...declared].sort());
    expect(declared.length).toBeGreaterThan(150);
  });
});

describe('signing in (RULES Z9)', () => {
  it('walks a new admin through password and authenticator, then needs the code every time', async () => {
    const admin = await person(ROOT, 'admin');
    expect((await request(app).get('/v1/admin/users').set(as(admin.token))).status).toBe(200);

    await clearThrottles();
    const noCode = await request(app).post('/v1/admin/staff/login').send({ email: admin.email, password: admin.password });
    expect(noCode.body.error.code).toBe('STAFF_MFA_REQUIRED');

    const token = await login(admin);
    const me = await request(app).get('/v1/admin/staff/me').set(as(token));
    expect(me.body).toMatchObject({ role: 'admin', totpEnabled: true, setup: { changePassword: false, enrollTotp: false } });

    // The same code twice is one sign-in, not two.
    const code = totpAt(admin.secret, totpCounter());
    await StaffModel.updateOne({ email: admin.email }, { $set: { 'totp.lastStep': null } });
    expect((await request(app).post('/v1/admin/staff/login').send({ email: admin.email, password: admin.password, code })).status).toBe(200);
    const replay = await request(app).post('/v1/admin/staff/login').send({ email: admin.email, password: admin.password, code });
    expect(replay.body.error.code).toBe('STAFF_MFA_INVALID');
  });

  it('locks an account after five wrong passwords, and says nothing about unknown emails', async () => {
    const admin = await person(ROOT, 'admin');
    for (let i = 0; i < 5; i++) {
      await clearThrottles();
      const res = await request(app).post('/v1/admin/staff/login').send({ email: admin.email, password: 'wrong-password-1' });
      expect(res.body.error.code).toBe('STAFF_LOGIN_FAILED');
    }
    const locked = await request(app).post('/v1/admin/staff/login').send({ email: admin.email, password: admin.password });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('STAFF_LOCKED');

    const nobody = await request(app).post('/v1/admin/staff/login').send({ email: 'nobody@staff.vokve.test', password: 'whatever-1' });
    expect(nobody.body.error.code).toBe('STAFF_LOGIN_FAILED');
  });

  it('keeps the staff collection apart from members', async () => {
    const member = await signUpAndRegister();
    const asMember = await request(app).post('/v1/admin/staff/login').send({ email: member.email, password: 'walk1000steps' });
    expect(asMember.body.error.code).toBe('STAFF_LOGIN_FAILED');
    expect((await request(app).get('/v1/admin/users').set('authorization', `Bearer ${member.accessToken}`)).status).toBe(401);
  });
});

describe('the hierarchy', () => {
  it('admin → manager → agent, each holding at most what the one above holds', async () => {
    const admin = await person(ROOT, 'admin');
    const manager = await person(as(admin.token), 'manager', {
      permissions: ['members.view', 'orders.view', 'staff.view', 'staff.manage', 'audit.view'],
    });

    // A manager reads what they were given and nothing else.
    expect((await request(app).get('/v1/admin/users').set(as(manager.token))).status).toBe(200);
    const coins = await request(app).get('/v1/admin/config').set(as(manager.token));
    expect(coins.status).toBe(403);
    expect(coins.body.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'config.view' } });

    // …creates agents only, under themselves, with only what they hold.
    expect((await create(as(manager.token), { name: 'Xavier', email: nextEmail('m'), role: 'manager' })).body.error.code).toBe('ADMIN_ONLY');
    const tooMuch = await create(as(manager.token), { name: 'Y', email: nextEmail('agent'), role: 'agent', permissions: ['orders.refund'] });
    expect(tooMuch.status).toBe(422);
    const teamPerm = await create(as(manager.token), { name: 'Z', email: nextEmail('agent'), role: 'agent', permissions: ['staff.manage'] });
    expect(teamPerm.status).toBe(422);

    const agent = await person(as(manager.token), 'agent', { permissions: ['members.view'] });
    const me = await request(app).get('/v1/admin/staff/me').set(as(agent.token));
    expect(me.body).toMatchObject({ role: 'agent', manager: { id: manager.id }, effectivePermissions: ['members.view'] });
    expect((await request(app).get('/v1/admin/users').set(as(agent.token))).status).toBe(200);
    expect((await request(app).get('/v1/admin/orders').set(as(agent.token))).status).toBe(403);
    expect((await request(app).get('/v1/admin/staff').set(as(agent.token))).status).toBe(403);

    // Take it off the manager, and the agent loses it on the next request.
    const trimmed = await request(app).put(`/v1/admin/staff/${manager.id}`).set(as(admin.token)).send({ permissions: ['orders.view', 'staff.view', 'staff.manage'] });
    expect(trimmed.body.agentsTrimmed).toBe(1);
    expect((await request(app).get('/v1/admin/users').set(as(agent.token))).status).toBe(403);
  });

  it('a manager sees and manages only their own agents', async () => {
    const admin = await person(ROOT, 'admin');
    const perms = { permissions: ['members.view', 'staff.view', 'staff.manage', 'audit.view'] };
    const one = await person(as(admin.token), 'manager', perms);
    const two = await person(as(admin.token), 'manager', perms);
    const agentOfTwo = await person(as(two.token), 'agent', { permissions: ['members.view'] });
    await person(as(one.token), 'agent', { permissions: ['members.view'] });

    const list = await request(app).get('/v1/admin/staff').set(as(one.token));
    expect(list.body.data.map((s: { id: string }) => s.id)).not.toContain(agentOfTwo.id);
    expect(list.body.data.every((s: { id: string; manager: { id: string } | null }) => s.id === one.id || s.manager?.id === one.id)).toBe(true);

    expect((await request(app).get(`/v1/admin/staff/${agentOfTwo.id}`).set(as(one.token))).status).toBe(404);
    expect((await request(app).post(`/v1/admin/staff/${agentOfTwo.id}/suspend`).set(as(one.token)).send({ reason: 'not mine' })).status).toBe(403);
    expect((await request(app).post(`/v1/admin/staff/${two.id}/reset-password`).set(as(one.token))).status).toBe(403);
    // Nor themselves, through the management door.
    expect((await request(app).post(`/v1/admin/staff/${one.id}/suspend`).set(as(one.token)).send({ reason: 'myself' })).body.error.code).toBe('NOT_ON_YOURSELF');
  });

  it("switching a manager off switches their agents off, until they are moved", async () => {
    const admin = await person(ROOT, 'admin');
    const managerPerms = { permissions: ['members.view', 'orders.view', 'staff.view', 'staff.manage'] };
    const manager = await person(as(admin.token), 'manager', managerPerms);
    const other = await person(as(admin.token), 'manager', { permissions: ['members.view'] });
    const agent = await person(as(manager.token), 'agent', { permissions: ['members.view', 'orders.view'] });

    const suspended = await request(app).post(`/v1/admin/staff/${manager.id}/suspend`).set(as(admin.token)).send({ reason: 'on leave' });
    expect(suspended.body).toMatchObject({ ok: true, agentsBlocked: 1 });
    expect((await request(app).get('/v1/admin/users').set(as(agent.token))).status).toBe(401);
    await clearThrottles();
    await StaffModel.updateOne({ email: agent.email }, { $set: { 'totp.lastStep': null } });
    const refused = await request(app).post('/v1/admin/staff/login').send({ email: agent.email, password: agent.password, code: totpAt(agent.secret, totpCounter()) });
    expect(refused.body.error.code).toBe('STAFF_MANAGER_INACTIVE');

    // Moved to a manager without orders.view: they come back without it, and are told.
    const moved = await request(app).put(`/v1/admin/staff/${agent.id}/manager`).set(as(admin.token)).send({ managerId: other.id });
    expect(moved.status).toBe(200);
    expect(moved.body.dropped).toEqual(['orders.view']);
    const back = await login(agent);
    expect((await request(app).get('/v1/admin/users').set(as(back))).status).toBe(200);
    expect((await request(app).get('/v1/admin/orders').set(as(back))).status).toBe(403);
  });

  it('keeps the last admin, and a manager with agents keeps their role until they are moved', async () => {
    const lonely = await StaffModel.countDocuments({ role: 'admin', status: 'active' });
    const admin = await person(ROOT, 'admin');
    if (lonely === 0) {
      const res = await request(app).post(`/v1/admin/staff/${admin.id}/suspend`).set(ROOT).send({ reason: 'test' });
      expect(res.body.error.code).toBe('LAST_ADMIN');
    }
    const manager = await person(as(admin.token), 'manager', { permissions: ['members.view', 'staff.manage', 'staff.view'] });
    await person(as(manager.token), 'agent', { permissions: ['members.view'] });
    const demote = await request(app).put(`/v1/admin/staff/${manager.id}/role`).set(as(admin.token)).send({ role: 'agent', managerId: manager.id });
    expect(demote.body.error.code).toBe('HAS_AGENTS');
    const remove = await request(app).delete(`/v1/admin/staff/${manager.id}`).set(as(admin.token));
    expect(remove.body.error.code).toBe('HAS_AGENTS');
  });

  it('a deleted account frees its email and signs out at once', async () => {
    const admin = await person(ROOT, 'admin');
    const agentManager = await person(as(admin.token), 'manager', { permissions: ['members.view'] });
    const agent = await person(as(admin.token), 'agent', { managerId: agentManager.id, permissions: ['members.view'] });
    expect((await request(app).delete(`/v1/admin/staff/${agent.id}`).set(as(admin.token))).status).toBe(200);
    expect((await request(app).get('/v1/admin/users').set(as(agent.token))).status).toBe(401);
    const again = await create(as(admin.token), { name: 'Again', email: agent.email, role: 'agent', managerId: agentManager.id });
    expect(again.status).toBe(201);
  });
});

describe('the activity log', () => {
  it('records who did what, refusals included, and never a password', async () => {
    const admin = await person(ROOT, 'admin');
    const manager = await person(as(admin.token), 'manager', { permissions: ['members.view', 'staff.view', 'staff.manage', 'audit.view'] });
    const agent = await person(as(manager.token), 'agent', { permissions: ['members.view'] });
    const outsider = await person(as(admin.token), 'manager', { permissions: ['members.view'] });

    await request(app).get('/v1/admin/users').set(as(agent.token)).query({ q: 'asha' });
    await request(app).get('/v1/admin/orders').set(as(agent.token));
    await request(app).get('/v1/admin/users').set(as(outsider.token));

    const denied = await StaffActivityModel.findOne({ 'actor.id': agent.id, route: '/admin/orders' }).lean();
    expect(denied).toMatchObject({ ok: false, status: 403, errorCode: 'PERMISSION_DENIED', permission: 'orders.view', actor: { role: 'agent', managerId: manager.id } });

    const passwordRow = await StaffActivityModel.findOne({ 'actor.id': agent.id, route: '/admin/staff/me/password' }).lean();
    expect(passwordRow?.body).toEqual({ currentPassword: '[redacted]', newPassword: '[redacted]' });
    expect(await StaffActivityModel.exists({ 'actor.id': agent.id, kind: 'auth', event: 'login' })).toBeTruthy();

    // The manager reads their agent's rows, not another team's.
    const log = await request(app).get('/v1/admin/staff/activity').set(as(manager.token)).query({ limit: 200 });
    expect(log.status).toBe(200);
    const actors = new Set(log.body.data.map((row: { actor: { id: string } }) => row.actor.id));
    expect(actors.has(agent.id)).toBe(true);
    expect(actors.has(outsider.id)).toBe(false);

    // An agent reads only their own, and not through the team door.
    expect((await request(app).get('/v1/admin/staff/activity').set(as(agent.token))).status).toBe(403);
    const mine = await request(app).get('/v1/admin/staff/me/activity').set(as(agent.token));
    expect(mine.body.data.every((row: { actor: { id: string } }) => row.actor.id === agent.id)).toBe(true);

    // And the key's own uses are on it too, as root.
    await request(app).get('/v1/admin/users').set(ROOT);
    expect(await StaffActivityModel.exists({ 'actor.kind': 'root', route: '/admin/users' })).toBeTruthy();
  });
});

describe('behind the panel, every request shares one address', () => {
  it('twenty wrong admin keys lock the key out, not the staff', async () => {
    const admin = await person(ROOT, 'admin');
    for (let i = 0; i < 20; i++) await request(app).get('/v1/admin/users').set('x-admin-key', `wrong-key-${i}`);
    expect((await request(app).get('/v1/admin/users').set(ROOT)).status).toBe(429);
    // Same address, a staff session: unaffected.
    expect((await request(app).get('/v1/admin/users').set(as(admin.token))).status).toBe(200);
  });

  it('many people signing in from the panel at once are not one person', async () => {
    const admin = await person(ROOT, 'admin');
    const team = [] as Person[];
    for (let i = 0; i < 3; i++) team.push(await person(as(admin.token), 'manager', { permissions: ['members.view'] }));
    // A dozen sign-ins in a row from one address — a team's morning.
    for (let round = 0; round < 4; round++) {
      for (const member of team) {
        await StaffModel.updateOne({ email: member.email }, { $set: { 'totp.lastStep': null } });
        const res = await request(app).post('/v1/admin/staff/login').send({ email: member.email, password: member.password, code: totpAt(member.secret, totpCounter()) });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      }
    }
  });

  it("keeps the person's own address and browser, beside the panel's", async () => {
    const admin = await person(ROOT, 'admin');
    await request(app).get('/v1/admin/users').set(as(admin.token)).set({ 'x-vokve-operator-ip': '203.0.113.9', 'x-vokve-operator-agent': 'Mozilla/5.0 (Macintosh) Chrome/140' });
    const row = await StaffActivityModel.findOne({ 'actor.id': admin.id, route: '/admin/users' }).sort({ at: -1 }).lean();
    expect(row).toMatchObject({ clientIp: '203.0.113.9', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140' });
    expect(row?.ip).toBeTruthy();
    // Junk in the header is dropped, not stored.
    await request(app).get('/v1/admin/users').set(as(admin.token)).set({ 'x-vokve-operator-ip': '<script>' });
    const junk = await StaffActivityModel.findOne({ 'actor.id': admin.id, route: '/admin/users' }).sort({ at: -1 }).lean();
    expect(junk?.clientIp).toBeNull();
  });
});

describe('what the log leaves out', () => {
  it('does not record the panel asking who is signed in, but does record a change to one’s own account', async () => {
    const admin = await person(ROOT, 'admin');
    await request(app).get('/v1/admin/staff/me').set(as(admin.token));
    await request(app).get('/v1/admin/staff/permissions').set(as(admin.token));
    expect(await StaffActivityModel.exists({ 'actor.id': admin.id, route: '/admin/staff/me' })).toBeNull();
    expect(await StaffActivityModel.exists({ 'actor.id': admin.id, route: '/admin/staff/me/password' })).toBeTruthy();
  });
});
