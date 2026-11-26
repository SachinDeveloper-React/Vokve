import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { invalidateConfig } from '../src/config/remote.js';
import { unpinRetiredDefaults } from '../src/config/retired.js';
import { AppConfigModel, AuditLogModel } from '../src/modules/platform/models.js';
import { seed } from '../src/seed/seed.js';
import { app, authed, baseHeaders, signUpAndRegister } from './helpers.js';

/**
 * Which launcher icon phones show (RULES DV13): the base, a festive icon
 * switched on by hand, and festive windows on a schedule — and the panel's
 * refusals, which are what keep a key no build carries off every phone.
 */

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };
const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const decision = () => request(app).get('/v1/app/icon').set(baseHeaders);
const settings = () => request(app).get('/v1/admin/app-icon').set(ADMIN);
const set = (body: Record<string, unknown>) => request(app).put('/v1/admin/app-icon').set(ADMIN).send(body);
const addWindow = (body: Record<string, unknown>) =>
  request(app).post('/v1/admin/app-icon/schedule').set(ADMIN).send(body);

describe('app icon: what a phone is told (RULES DV13)', () => {
  it('starts on the white classic icon with nothing festive, signed in or not', async () => {
    await seed();
    const res = await decision();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ base: 'classic', festive: null });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('changes the base, and puts a festive icon on by hand until it is taken off', async () => {
    await seed();
    expect((await set({ base: 'night' })).status).toBe(200);
    expect((await decision()).body).toEqual({ base: 'night', festive: null });

    const on = await set({ festive: 'diwali', note: 'Diwali week' });
    expect(on.status).toBe(200);
    expect(on.body.live).toMatchObject({ icon: 'diwali', festive: 'diwali', source: 'manual', until: null });
    expect((await decision()).body).toEqual({ base: 'night', festive: 'diwali' });

    expect((await set({ festive: null })).status).toBe(200);
    expect((await decision()).body).toEqual({ base: 'night', festive: null });

    const audit = await AuditLogModel.find({ action: 'app.icon' }).sort({ createdAt: 1 }).lean();
    expect(audit).toHaveLength(3);
    expect(audit[1]?.after).toMatchObject({ festive: 'diwali', note: 'Diwali week' });
  });

  it('shows a scheduled festive icon only inside its window', async () => {
    await seed();
    const live = await addWindow({ icon: 'holi', startsAt: iso(-DAY), endsAt: iso(DAY), note: 'Holi' });
    expect(live.status).toBe(201);
    const later = await addWindow({ icon: 'eid', startsAt: iso(5 * DAY), endsAt: iso(7 * DAY) });
    expect(later.status).toBe(201);

    expect((await decision()).body).toEqual({ base: 'classic', festive: 'holi' });
    const view = later.body;
    expect(view.live).toMatchObject({ icon: 'holi', source: 'schedule' });
    expect(view.schedule.map((entry: { icon: string; state: string }) => [entry.icon, entry.state])).toEqual([
      ['holi', 'live'],
      ['eid', 'upcoming'],
    ]);

    // Taken off the schedule, it is gone at once.
    const holi = view.schedule.find((entry: { icon: string }) => entry.icon === 'holi');
    expect((await request(app).delete(`/v1/admin/app-icon/schedule/${holi.id}`).set(ADMIN)).status).toBe(200);
    expect((await decision()).body).toEqual({ base: 'classic', festive: null });
  });

  it('lets a festive icon switched on by hand win over the schedule', async () => {
    await seed();
    await addWindow({ icon: 'christmas', startsAt: iso(-DAY), endsAt: iso(DAY) });
    await set({ festive: 'newyear' });
    expect((await decision()).body.festive).toBe('newyear');
  });

  it('refuses what no build carries, the wrong kind, overlaps and windows already over', async () => {
    await seed();
    expect((await set({ base: 'sparkly' })).status).toBe(422);
    // A festive icon is not an everyday one, and the other way round.
    expect((await set({ base: 'diwali' })).status).toBe(422);
    expect((await set({ festive: 'classic' })).status).toBe(422);
    expect((await set({})).status).toBe(422);

    expect((await addWindow({ icon: 'diwali', startsAt: iso(DAY), endsAt: iso(3 * DAY) })).status).toBe(201);
    const overlap = await addWindow({ icon: 'eid', startsAt: iso(2 * DAY), endsAt: iso(4 * DAY) });
    expect(overlap.status).toBe(422);
    expect(JSON.stringify(overlap.body)).toContain('overlap');
    // Back to back is fine: one closes as the next opens.
    expect((await addWindow({ icon: 'eid', startsAt: iso(3 * DAY), endsAt: iso(4 * DAY) })).status).toBe(201);

    expect((await addWindow({ icon: 'holi', startsAt: iso(6 * DAY), endsAt: iso(5 * DAY) })).status).toBe(422);
    expect((await addWindow({ icon: 'holi', startsAt: iso(-3 * DAY), endsAt: iso(-2 * DAY) })).status).toBe(422);
    expect((await request(app).delete('/v1/admin/app-icon/schedule/nope').set(ADMIN)).status).toBe(404);
  });

  it('keeps the generic config page off the icon settings', async () => {
    await seed();
    const res = await request(app)
      .put('/v1/admin/config')
      .set(ADMIN)
      .send({ set: { 'app.icon.base': 'night' } });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('App icon');
  });

  it('counts the phones by the icon they last said they were showing', async () => {
    await seed();
    const session = await signUpAndRegister();
    const before = await settings();
    expect(before.body.devices).toEqual([{ icon: null, platform: 'android', devices: 1 }]);

    const beat = await request(app)
      .patch(`/v1/devices/${session.deviceId}`)
      .set(authed(session))
      .send({ appIcon: 'diwali' });
    expect(beat.body).toEqual({ ok: true });
    expect((await settings()).body.devices).toEqual([{ icon: 'diwali', platform: 'android', devices: 1 }]);

    // A key is a key — nothing else rides in on it.
    const odd = await request(app)
      .patch(`/v1/devices/${session.deviceId}`)
      .set(authed(session))
      .send({ appIcon: 'Diwali; drop' });
    expect(odd.status).toBe(422);
  });

  it('lists every icon in the catalogue for the panel, with the kind of each', async () => {
    await seed();
    const res = await settings();
    expect(res.status).toBe(200);
    expect(res.body.defaultIcon).toBe('classic');
    expect(res.body.catalog.filter((icon: { kind: string }) => icon.kind === 'base').map((icon: { key: string }) => icon.key)).toEqual([
      'redfield',
      'classic',
      'night',
    ]);
    expect(res.body.catalog).toHaveLength(9);
    // Red is still in builds, so still listed, but the panel no longer offers it.
    expect(res.body.catalog.filter((icon: { retired: boolean }) => icon.retired).map((icon: { key: string }) => icon.key)).toEqual(['redfield']);
  });

  it('moves a database still holding the old red default to the white one, and leaves a chosen icon alone', async () => {
    await seed();
    // What a database seeded while red was the default holds.
    await AppConfigModel.updateOne({ _id: 'app' }, { $set: { 'value.icon.base': 'redfield' } });
    invalidateConfig();
    expect((await decision()).body.base).toBe('redfield');

    const { unpinned } = await unpinRetiredDefaults(true);
    expect(unpinned).toContainEqual({ path: 'app.icon.base', was: 'redfield' });
    expect((await decision()).body).toEqual({ base: 'classic', festive: null });

    // Somebody's choice is not a leftover default.
    expect((await set({ base: 'night' })).status).toBe(200);
    expect((await unpinRetiredDefaults(true)).unpinned).toEqual([]);
    expect((await decision()).body.base).toBe('night');
  });
});
