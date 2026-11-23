import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { invalidateConfig } from '../src/config/remote.js';
import { UserModel } from '../src/modules/identity/models.js';
import { forgetMaintenanceBypass } from '../src/modules/platform/maintenance.js';
import { AppConfigModel, AuditLogModel } from '../src/modules/platform/models.js';
import { StaffModel } from '../src/modules/staff/models.js';
import { app, authed, baseHeaders, signUpAndRegister } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

/**
 * Maintenance mode (RULES DV14): one switch on the panel stops every member
 * request with `503 MAINTENANCE`, while testers and staff carry on — told so
 * by a header — and the routes a phone needs to draw the screen, sign in and
 * learn that it is over stay open.
 */

const switchTo = (body: Record<string, unknown>) => request(app).put('/v1/admin/maintenance').set(ADMIN).send(body);
const status = (headers: Record<string, string>) => request(app).get('/v1/app/status').set(headers);

describe('maintenance mode (RULES DV14)', () => {
  afterEach(() => {
    forgetMaintenanceBypass();
  });

  it('is off until switched on, and then stops members with the screen’s own words', async () => {
    const member = await signUpAndRegister();
    expect((await request(app).get('/v1/me').set(authed(member))).status).toBe(200);
    expect((await status(authed(member))).body.maintenance).toMatchObject({ active: false, bypass: false });

    const endsAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const on = await switchTo({ enabled: true, title: 'Back soon', message: 'Upgrading the servers.', endsAt });
    expect(on.status).toBe(200);
    expect(on.body.maintenance).toMatchObject({ enabled: true, title: 'Back soon', endsAt, startedBy: expect.any(String) });
    expect(on.body.maintenance.startedAt).toEqual(expect.any(String));

    const refused = await request(app).get('/v1/me').set(authed(member));
    expect(refused.status).toBe(503);
    expect(refused.body.error).toEqual({ code: 'MAINTENANCE', message: 'Upgrading the servers.', details: { title: 'Back soon', endsAt } });
    expect(refused.headers['x-vokve-maintenance']).toBeUndefined();

    expect((await status(authed(member))).body.maintenance).toEqual({
      active: true, bypass: false, title: 'Back soon', message: 'Upgrading the servers.', endsAt,
    });
    // Still open: the health check, the update check, the panel.
    expect((await request(app).get('/v1/health')).status).toBe(200);
    expect((await request(app).get('/v1/app/update').set(baseHeaders)).status).toBe(200);
    expect((await request(app).get('/v1/admin/maintenance').set(ADMIN)).status).toBe(200);
    expect((await request(app).get('/v1/admin/maintenance/flag').set(ADMIN)).body).toMatchObject({ enabled: true, endsAt });

    // Signing in stays open (a tester may be signing in); making an account does not.
    const signIn = await request(app).post('/v1/auth/sign-in').set(baseHeaders).send({ email: member.email, password: 'walk1000steps' });
    expect(signIn.status).toBe(200);
    const signUp = await request(app).post('/v1/auth/sign-up').set(baseHeaders)
      .send({ email: 'new@example.com', phone: '+919811111111', password: 'walk1000steps', dateOfBirth: '1994-03-21', gender: 'female' });
    expect(signUp.status).toBe(503);

    const off = await switchTo({ enabled: false });
    expect(off.body.maintenance).toMatchObject({ enabled: false, startedAt: null, startedBy: null, endsAt: null });
    expect((await request(app).get('/v1/me').set(authed(member))).status).toBe(200);
    expect((await AuditLogModel.find({ action: /^app\.maintenance/ }).sort({ createdAt: 1 }).lean()).map(row => row.action)).toEqual([
      'app.maintenance_on',
      'app.maintenance_off',
    ]);
  });

  it('lets a tester through with the header, and stops them again once taken off the list', async () => {
    const tester = await signUpAndRegister();
    const other = await signUpAndRegister();
    await switchTo({ enabled: true });

    expect((await request(app).get('/v1/me').set(authed(tester))).status).toBe(503);

    const added = await request(app).post('/v1/admin/maintenance/testers').set(ADMIN).send({ identifier: tester.email.toUpperCase() });
    expect(added.status).toBe(201);
    expect(added.body.testers).toEqual([expect.objectContaining({ id: tester.userId, email: tester.email })]);

    const through = await request(app).get('/v1/me').set(authed(tester));
    expect(through.status).toBe(200);
    expect(through.headers['x-vokve-maintenance']).toBe('bypass');
    expect((await status(authed(tester))).body.maintenance).toMatchObject({ active: true, bypass: true });

    // By phone, too, however it was typed.
    const byPhone = await request(app).post('/v1/admin/maintenance/testers').set(ADMIN).send({ identifier: other.phone.replace('+91', '') });
    expect(byPhone.status).toBe(201);
    expect((await request(app).post('/v1/admin/maintenance/testers').set(ADMIN).send({ identifier: 'nobody@example.com' })).status).toBe(404);

    const removed = await request(app).delete(`/v1/admin/maintenance/testers/${tester.userId}`).set(ADMIN);
    expect(removed.body.testers.map((row: { id: string }) => row.id)).toEqual([other.userId]);
    expect((await request(app).get('/v1/me').set(authed(tester))).status).toBe(503);
    expect(await AuditLogModel.countDocuments({ action: 'member.tester_added' })).toBe(2);
  });

  it('lets staff through by a verified email, and not by one merely typed in', async () => {
    const staff = await signUpAndRegister();
    const impostor = await signUpAndRegister();
    await UserModel.updateOne({ _id: impostor.userId }, { $set: { emailVerifiedAt: null } });
    for (const [id, email] of [['stf_1', staff.email], ['stf_2', impostor.email]]) {
      await StaffModel.create({ _id: id, email, name: 'Team', role: 'agent', passwordHash: 'x' });
    }
    await switchTo({ enabled: true });

    expect((await request(app).get('/v1/me').set(authed(staff))).status).toBe(200);
    expect((await request(app).get('/v1/me').set(authed(impostor))).status).toBe(503);
  });

  it('answers a tester’s expired session 401 rather than the screen, so the app refreshes it', async () => {
    const tester = await signUpAndRegister();
    await UserModel.updateOne({ _id: tester.userId }, { $set: { 'flags.tester': true } });
    await switchTo({ enabled: true });

    const expired = jwt.sign({ sub: tester.userId, tier: 'normal', exp: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET, {
      algorithm: 'HS256',
      issuer: 'vokve',
    });
    const stale = await request(app).get('/v1/me').set({ ...authed(tester), authorization: `Bearer ${expired}` });
    expect(stale.status).toBe(401);
    // The refresh itself is open, and the fresh token is let through.
    const refreshed = await request(app).post('/v1/auth/refresh').set(baseHeaders).send({ refreshToken: tester.refreshToken });
    expect(refreshed.status).toBe(200);
    const again = await request(app).get('/v1/me').set({ ...authed(tester), authorization: `Bearer ${refreshed.body.accessToken}` });
    expect(again.status).toBe(200);
    // A token this server never signed is nobody's.
    const forged = jwt.sign({ sub: tester.userId, tier: 'normal' }, 'not-the-secret', { algorithm: 'HS256', issuer: 'vokve' });
    expect((await request(app).get('/v1/me').set({ ...authed(tester), authorization: `Bearer ${forged}` })).status).toBe(503);
  });

  it('still tells a retired build to update, and refuses an end that has passed', async () => {
    const member = await signUpAndRegister();
    await switchTo({ enabled: true });
    await AppConfigModel.updateOne({ _id: 'app' }, { $set: { 'value.minVersion.android': '9.0.0' } });
    invalidateConfig();
    expect((await request(app).get('/v1/me').set(authed(member))).status).toBe(426);

    const past = await switchTo({ endsAt: new Date(Date.now() - 60_000).toISOString() });
    expect(past.status).toBe(422);
    expect(past.body.error.details.endsAt).toEqual(expect.any(String));
    expect((await switchTo({})).status).toBe(422);
  });
});
