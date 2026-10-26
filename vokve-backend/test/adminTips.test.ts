import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ContentTipModel } from '../src/modules/content/models.js';
import { AuditLogModel } from '../src/modules/platform/models.js';
import { seed } from '../src/seed/seed.js';
import { app, authed, signUpAndRegister } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

/**
 * The lines the app says in its own voice (`/admin/tips`, BACKEND §6.15).
 *
 * The collection was always read by the app, one line per topic per day, and
 * was only ever written by the seed — so the checks here are about the half
 * that was missing: writing a line, the rotation the panel has to be able to
 * explain, and the member endpoint reading what was just written without an
 * app release.
 */

describe('admin: the app’s own words', () => {
  it('lists every screen with what it is saying today', async () => {
    await seed();

    const page = await request(app).get('/v1/admin/tips').set(ADMIN);

    expect(page.status).toBe(200);
    expect(page.body.topics).toContain('motivation');
    const home = page.body.byTopic.find((row: { topic: string }) => row.topic === 'motivation');
    // The rotation is a function of the day, so only the server can say
    // which line is on the home screen — which is the first question asked.
    expect(home).toMatchObject({ lines: expect.any(Number), active: expect.any(Number) });
    expect(home.todayId).toMatch(/^motivation-/);
    expect(page.body.data.filter((row: { showingToday: boolean }) => row.showingToday).length).toBeGreaterThan(0);
    expect(page.body.totals.silentTopics).toEqual([]);
  });

  it('writes a line, and the app reads it without a release', async () => {
    await seed();
    // Only one line in rotation, so today's is not in doubt.
    await ContentTipModel.updateMany({ topic: 'motivation' }, { $set: { active: false } });

    const written = await request(app)
      .post('/v1/admin/tips')
      .set(ADMIN)
      .send({ id: 'motivation-owner', topic: 'motivation', text: 'Walk like somebody is waiting for you.' });

    expect(written.status).toBe(201);
    expect(written.body).toMatchObject({ created: true, tip: { topic: 'motivation', active: true } });

    const session = await signUpAndRegister();
    const read = await request(app).get('/v1/content/tips/motivation').set(authed(session));
    expect(read.body).toMatchObject({ id: 'motivation-owner', text: 'Walk like somebody is waiting for you.' });

    // And again is a correction, not a second line.
    const corrected = await request(app)
      .post('/v1/admin/tips')
      .set(ADMIN)
      .send({ id: 'motivation-owner', topic: 'motivation', text: 'Walk like somebody is waiting.' });
    expect(corrected.status).toBe(200);
    expect(corrected.body.created).toBe(false);
    expect(await ContentTipModel.countDocuments({ _id: 'motivation-owner' })).toBe(1);
  });

  it('hiding a line takes it out of the rotation and keeps it', async () => {
    await seed();
    const before = await ContentTipModel.countDocuments({ topic: 'hydration' });

    const hidden = await request(app).put('/v1/admin/tips/hydration-1').set(ADMIN).send({ active: false });

    expect(hidden.status).toBe(200);
    expect(hidden.body.tip).toMatchObject({ active: false });
    expect(await ContentTipModel.countDocuments({ topic: 'hydration' })).toBe(before);
    const page = await request(app).get('/v1/admin/tips').set(ADMIN).query({ topic: 'hydration' });
    const row = page.body.byTopic.find((entry: { topic: string }) => entry.topic === 'hydration');
    expect(row.active).toBe(before - 1);
    expect(row.todayId).not.toBe('hydration-1');
  });

  it('a screen with nothing in rotation is named, and draws no card', async () => {
    await seed();
    await ContentTipModel.updateMany({ topic: 'nutrition' }, { $set: { active: false } });

    const page = await request(app).get('/v1/admin/tips').set(ADMIN);
    expect(page.body.totals.silentTopics).toContain('nutrition');

    // Which is exactly what the app sees: no tip, so no card.
    const session = await signUpAndRegister();
    const read = await request(app).get('/v1/content/tips/nutrition').set(authed(session));
    expect(read.status).toBe(404);
  });

  it('takes a pasted list, numbering it on from what is there', async () => {
    await seed();
    const before = await ContentTipModel.countDocuments({ topic: 'motivation' });

    const added = await request(app)
      .post('/v1/admin/tips/bulk')
      .set(ADMIN)
      .send({
        topic: 'motivation',
        lines: [
          { text: 'Today’s walk is tomorrow’s habit.' },
          { text: 'The hardest step is the one out of the door.' },
          // The same line again: a list pasted twice is the same list.
          { text: 'Today’s walk is tomorrow’s habit.' },
        ],
      });

    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ added: 2, skipped: 1 });
    expect(added.body.ids).toEqual([`motivation-${before + 1}`, `motivation-${before + 2}`]);
    expect(await ContentTipModel.countDocuments({ topic: 'motivation' })).toBe(before + 2);
    // Added at the end of the rotation, so the lines already there keep
    // their place in it.
    const last = await ContentTipModel.findById(`motivation-${before + 2}`).lean();
    const first = await ContentTipModel.findById('motivation-1').lean();
    expect((last?.sort ?? 0) > (first?.sort ?? 0)).toBe(true);
  });

  it('numbers an underscored topic with hyphens, like the seed does', async () => {
    await seed();

    const added = await request(app)
      .post('/v1/admin/tips/bulk')
      .set(ADMIN)
      .send({ topic: 'heart_rate', lines: [{ text: 'A resting rate that drifts down is fitness arriving.' }] });

    expect(added.status).toBe(201);
    // `heart_rate-3` would not pass the id pattern, and the seeded ones read
    // `heart-rate-1`.
    expect(added.body.ids[0]).toMatch(/^heart-rate-\d+$/);
  });

  it('deletes a line outright, and logs who did', async () => {
    await seed();

    const gone = await request(app).delete('/v1/admin/tips/hydration-2').set(ADMIN).send({ note: 'wrong advice' });

    expect(gone.status).toBe(200);
    expect(await ContentTipModel.findById('hydration-2').lean()).toBeNull();
    expect(await AuditLogModel.countDocuments({ action: 'content.tip_deleted', subjectId: 'hydration-2' })).toBe(1);
  });

  it('refuses a topic the app has no card for, and an id that is not a slug', async () => {
    await seed();

    const nowhere = await request(app)
      .post('/v1/admin/tips')
      .set(ADMIN)
      .send({ id: 'somewhere-1', topic: 'somewhere', text: 'A line with nowhere to go.' });
    expect(nowhere.status).toBe(422);

    const shouty = await request(app)
      .post('/v1/admin/tips')
      .set(ADMIN)
      .send({ id: 'Motivation One', topic: 'motivation', text: 'A line with a bad id.' });
    expect(shouty.status).toBe(422);
  });

  it('is behind the operator key', async () => {
    await seed();

    expect((await request(app).get('/v1/admin/tips')).status).toBe(401);
    expect(
      (await request(app).post('/v1/admin/tips').send({ id: 'x-1', topic: 'motivation', text: 'No key.' })).status,
    ).toBe(401);
  });
});
