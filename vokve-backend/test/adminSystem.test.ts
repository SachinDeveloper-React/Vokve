import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SupportFaqModel, SupportGuideSectionModel, SupportTicketModel } from '../src/modules/account/models.js';
import { UserModel } from '../src/modules/identity/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { invalidateConfig } from '../src/config/remote.js';
import { seed } from '../src/seed/seed.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };

async function member(name = 'Asha Verma'): Promise<Session> {
  const session = await signUpAndRegister();
  await UserModel.updateOne(
    { _id: session.userId },
    { $set: { phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(), name } },
  );
  return session;
}

/** A feed row in whatever state the test needs; `notify()` has its own tests. */
async function feedRow(userId: string, id: string, overrides: Record<string, unknown> = {}) {
  return NotificationModel.create({
    _id: id,
    userId,
    topic: 'system',
    title: 'Scheduled maintenance',
    message: 'Vokve will be briefly unavailable tonight.',
    read: false,
    createdAt: new Date(),
    ...overrides,
  });
}

/** A ticket, as the member's own route would have written it. */
async function ticket(userId: string, id: string, overrides: Record<string, unknown> = {}) {
  return SupportTicketModel.create({
    _id: id,
    userId,
    reference: `VK-${id.slice(-4).toUpperCase()}`,
    subject: 'My coins have not arrived',
    category: 'coins',
    status: 'open',
    messages: [{ id: `msg_${id}`, from: 'user', body: 'I walked 8,000 steps yesterday and got nothing.', createdAt: new Date() }],
    context: { appVersion: '1.0.0', platform: 'android', osVersion: '14', deviceId: 'dev_1' },
    ...overrides,
  });
}

describe('admin: the notification system', () => {
  it('answers the admin key alone', async () => {
    expect((await request(app).get('/v1/admin/notifications')).status).toBe(401);
  });

  it('counts consent switch by switch, and tells a default apart from a refusal', async () => {
    const quiet = await member('Quiet Member');
    const fresh = await member('Never Opened Settings');

    // One member turns two subjects off through their own screen, which is
    // the only way consent is ever given or taken (RULES P14).
    const off = await request(app)
      .put('/v1/me/notification-preferences')
      .set(authed(quiet))
      .send({ categories: { offers: false, coins: false } });
    expect(off.status).toBe(200);

    const consent = await request(app).get('/v1/admin/notifications/consent').set(ADMIN);
    expect(consent.status).toBe(200);
    expect(consent.body.members).toBe(2);

    const bySwitch = Object.fromEntries(
      consent.body.switches.map((row: { key: string }) => [row.key, row]),
    );

    // Two switches refused by one member, so one member is still reachable
    // on each. `chosen` is the figure that says it was a decision: a
    // preferences row is written at sign-up, so the only way to tell a
    // refusal from a default nobody touched is to compare with the default.
    expect(bySwitch.offers).toMatchObject({ on: 1, off: 1, chosen: 1, defaultOn: true });
    expect(bySwitch.coins).toMatchObject({ on: 1, off: 1, chosen: 1, defaultOn: true });
    // Untouched by either member, so nobody has chosen anything about it.
    expect(bySwitch.activity).toMatchObject({ on: 2, off: 0, chosen: 0 });
    // Health is the one switch that starts off, so a member *on* it chose it
    // — and neither of these two did.
    expect(bySwitch.health).toMatchObject({ defaultOn: false, on: 0, off: 2, chosen: 0 });

    // And the honesty: which switches anything is actually sent on. `offers`
    // has no topic of its own — only a broadcast naming it — so a count of
    // refusals against it would otherwise read as lost reach.
    expect(bySwitch.activity.governs).toContain('steps');
    expect(bySwitch.offers.governs).toEqual([]);

    // The drill-down: who, not how many.
    const silenced = await request(app).get('/v1/admin/users').query({ silenced: 'offers' }).set(ADMIN);
    expect(silenced.status).toBe(200);
    expect(silenced.body.total).toBe(1);
    expect(silenced.body.data[0].id).toBe(quiet.userId);
    // Not the member who left it alone: they are on the default, and a list
    // of refusals that included them would be a list of everybody.
    expect(silenced.body.data.some((row: { id: string }) => row.id === fresh.userId)).toBe(false);
  });

  it('lets a broadcast name the switch that governs it, so offers silences something', async () => {
    const session = await member('Promo Refuser');
    await request(app)
      .put('/v1/me/notification-preferences')
      .set(authed(session))
      .send({ categories: { offers: false } });

    // Sent on `system`, which maps to `announcements` — but named as an
    // offer, which is what the member actually switched off.
    const sent = await request(app)
      .post('/v1/admin/notifications/broadcast')
      .set(ADMIN)
      .send({
        topic: 'system',
        preference: 'offers',
        title: 'Half price on everything',
        message: 'Three days only.',
        expected: 1,
        confirm: true,
        reason: 'weekend promotion',
      });
    expect(sent.status).toBe(202);
    // The feed row is still written — it is the channel they can go and look
    // at — and the push is the thing their switch withheld.
    expect(sent.body).toMatchObject({ created: 1, pushed: 0 });
  });

  it('says what became of every notification, across the filter rather than the page', async () => {
    const session = await member();
    await feedRow(session.userId, 'ntf_read', { read: true, readAt: new Date(), pushedAt: new Date() });
    await feedRow(session.userId, 'ntf_unread', { topic: 'coins', title: 'Coins credited' });
    await feedRow(session.userId, 'ntf_held', {
      topic: 'streak',
      title: 'Your streak is at risk',
      pushDeferredUntil: new Date(Date.now() + 3_600_000),
    });

    const page = await request(app).get('/v1/admin/notifications').set(ADMIN);
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(3);
    expect(page.body.totals).toMatchObject({ sent: 3, read: 1, unread: 2, pushed: 1, deferred: 1, notPushed: 1 });
    expect(page.body.byTopic).toEqual(
      expect.arrayContaining([
        { topic: 'system', category: 'system', sent: 1, read: 1 },
        { topic: 'coins', category: 'reward', sent: 1, read: 0 },
        { topic: 'streak', category: 'activity', sent: 1, read: 0 },
      ]),
    );
    expect(page.body.data[0].member).toMatchObject({ id: session.userId, email: session.email });

    const held = await request(app).get('/v1/admin/notifications').query({ state: 'deferred' }).set(ADMIN);
    expect(held.body.total).toBe(1);
    expect(held.body.data[0]).toMatchObject({ id: 'ntf_held', pushPending: true });

    const unread = await request(app).get('/v1/admin/notifications').query({ state: 'unread' }).set(ADMIN);
    expect(unread.body.total).toBe(2);

    const byTopic = await request(app).get('/v1/admin/notifications').query({ topic: 'coins' }).set(ADMIN);
    expect(byTopic.body.total).toBe(1);

    // A search matches the words, or the account.
    const found = await request(app).get('/v1/admin/notifications').query({ q: 'streak' }).set(ADMIN);
    expect(found.body.total).toBe(1);
    const byMember = await request(app).get('/v1/admin/notifications').query({ q: session.email }).set(ADMIN);
    expect(byMember.body.total).toBe(3);
  });

  it('deleting a row cancels the push quiet hours was still holding', async () => {
    const session = await member();
    await feedRow(session.userId, 'ntf_held', { pushDeferredUntil: new Date(Date.now() + 3_600_000) });
    await feedRow(session.userId, 'ntf_done', { read: true, readAt: new Date(), pushedAt: new Date() });

    const held = await request(app)
      .delete('/v1/admin/notifications/ntf_held')
      .set(ADMIN)
      .send({ reason: 'sent to the wrong segment' });
    expect(held.status).toBe(200);
    expect(held.body).toMatchObject({ deleted: true, wasRead: false, wasPushed: false, cancelledPush: true });
    expect(await NotificationModel.exists({ _id: 'ntf_held' })).toBeFalsy();

    // And one that has already rung: removing the row does not unring it.
    const done = await request(app)
      .delete('/v1/admin/notifications/ntf_done')
      .set(ADMIN)
      .send({ reason: 'tidying' });
    expect(done.body).toMatchObject({ wasRead: true, wasPushed: true, cancelledPush: false });

    const missing = await request(app)
      .delete('/v1/admin/notifications/ntf_nothing')
      .set(ADMIN)
      .send({ reason: 'already gone' });
    expect(missing.status).toBe(404);
  });

  it('reads a broadcast back with the open rate the send could not know', async () => {
    const one = await member('Asha');
    const two = await member('Bilal');

    const preview = await request(app).get('/v1/admin/notifications/preview').set(ADMIN);
    expect(preview.status).toBe(200);
    const sent = await request(app).post('/v1/admin/notifications/broadcast').set(ADMIN).send({
      segment: {},
      topic: 'system',
      title: 'Scheduled maintenance',
      message: 'Vokve will be briefly unavailable tonight at 2am.',
      expected: preview.body.matched,
      confirm: true,
      reason: 'planned downtime',
    });
    expect(sent.status).toBe(202);
    expect(sent.body.created).toBe(2);

    // One of them opens it.
    await NotificationModel.updateOne({ userId: one.userId, dedupeKey: sent.body.id }, { $set: { read: true, readAt: new Date() } });

    const history = await request(app).get('/v1/admin/notifications/broadcasts').set(ADMIN);
    expect(history.status).toBe(200);
    expect(history.body.data[0]).toMatchObject({
      id: sent.body.id,
      topic: 'system',
      title: 'Scheduled maintenance',
      reason: 'planned downtime',
      sent: { recipients: 2, created: 2 },
      live: { rows: 2, read: 1, openRate: 0.5 },
      retractable: 1,
    });

    // Retracting takes back what can be taken back, and says what it could not.
    const retracted = await request(app)
      .post(`/v1/admin/notifications/broadcasts/${encodeURIComponent(sent.body.id)}/retract`)
      .set(ADMIN)
      .send({ reason: 'the maintenance was cancelled', confirm: true });
    expect(retracted.status).toBe(200);
    expect(retracted.body).toMatchObject({ retracted: true, removed: 1, leftBecauseRead: 1 });
    expect(await NotificationModel.countDocuments({ dedupeKey: sent.body.id })).toBe(1);
    expect(await NotificationModel.exists({ userId: two.userId, dedupeKey: sent.body.id })).toBeFalsy();

    const nothing = await request(app)
      .post('/v1/admin/notifications/broadcasts/admin_broadcast:0/retract')
      .set(ADMIN)
      .send({ reason: 'nothing there', confirm: true });
    expect(nothing.status).toBe(404);
  });
});

describe('admin: the support system (RULES P12)', () => {
  it('queues by who has been waiting longest for us', async () => {
    const session = await member();
    const old = new Date(Date.now() - 3 * 86_400_000);
    await ticket(session.userId, 'tkt_waiting', { createdAt: old, messages: [{ id: 'm1', from: 'user', body: 'Still nothing on my coins, three days now.', createdAt: old }] });
    await ticket(session.userId, 'tkt_answered', {
      status: 'in_progress',
      subject: 'Order never arrived',
      category: 'orders',
      messages: [
        { id: 'm2', from: 'user', body: 'My order has not come.', createdAt: new Date(Date.now() - 7_200_000) },
        { id: 'm3', from: 'support', body: 'We have chased the courier.', createdAt: new Date(Date.now() - 3_600_000) },
      ],
    });
    await ticket(session.userId, 'tkt_closed', { status: 'closed', subject: 'Old question' });

    const queue = await request(app).get('/v1/admin/support/tickets').set(ADMIN);
    expect(queue.status).toBe(200);
    expect(queue.body.total).toBe(3);
    // Waiting on us first, oldest wait at the top.
    expect(queue.body.data[0]).toMatchObject({ id: 'tkt_waiting', waitingOnUs: true, lastFrom: 'user' });
    expect(queue.body.data[0].waitingHours).toBeGreaterThan(60);
    expect(queue.body.data[0].member).toMatchObject({ id: session.userId, email: session.email });
    expect(queue.body.totals).toMatchObject({ tickets: 3, waitingOnUs: 1, oldestWaitReference: queue.body.data[0].reference });
    expect(queue.body.byStatus).toEqual(
      expect.arrayContaining([
        { status: 'open', tickets: 1 },
        { status: 'in_progress', tickets: 1 },
        { status: 'closed', tickets: 1 },
      ]),
    );
    // Category counts are about what still needs help, so a closed one is out.
    expect(queue.body.byCategory).toEqual(
      expect.arrayContaining([{ category: 'coins', tickets: 1 }, { category: 'orders', tickets: 1 }]),
    );

    const ours = await request(app).get('/v1/admin/support/tickets').query({ waiting: 'us' }).set(ADMIN);
    expect(ours.body.data.map((row: { id: string }) => row.id)).toEqual(['tkt_waiting']);

    const theirs = await request(app).get('/v1/admin/support/tickets').query({ waiting: 'them' }).set(ADMIN);
    expect(theirs.body.data.map((row: { id: string }) => row.id).sort()).toEqual(['tkt_answered', 'tkt_closed']);

    const byStatus = await request(app).get('/v1/admin/support/tickets').query({ status: 'closed' }).set(ADMIN);
    expect(byStatus.body.total).toBe(1);

    // The reference is what a member reads out on a call.
    const byRef = await request(app)
      .get('/v1/admin/support/tickets')
      .query({ q: queue.body.data[0].reference })
      .set(ADMIN);
    expect(byRef.body.data[0].id).toBe('tkt_waiting');
  });

  it('answers them as support, tells them, and moves the status in the same write', async () => {
    const session = await member();
    await ticket(session.userId, 'tkt_1');

    const replied = await request(app)
      .post('/v1/admin/support/tickets/tkt_1/replies')
      .set(ADMIN)
      .send({ message: 'Your 8,000 steps were held for review and have now been credited.' });
    expect(replied.status).toBe(201);
    expect(replied.body.ticket.messages).toHaveLength(2);
    expect(replied.body.ticket.messages[1]).toMatchObject({ from: 'support' });
    // Answering an open ticket means somebody has it.
    expect(replied.body.ticket).toMatchObject({ status: 'in_progress', waitingOnUs: false });
    expect(replied.body.ticket.context).toMatchObject({ appVersion: '1.0.0', platform: 'android' });
    expect(replied.body.member).toMatchObject({ id: session.userId, email: session.email });

    // And they were told, through the same path every job uses.
    expect(replied.body.notified).toMatchObject({ status: 'created' });
    const told = await NotificationModel.findOne({ userId: session.userId, topic: 'system' }).lean();
    expect(told?.title).toContain('Support replied');

    // The member can read it on their own route, which is the point.
    const theirs = await request(app).get('/v1/support/tickets/tkt_1').set(authed(session));
    expect(theirs.status).toBe(200);
    expect(theirs.body.messages[1]).toMatchObject({ from: 'support' });

    // Reply and resolve is one action.
    const resolved = await request(app)
      .post('/v1/admin/support/tickets/tkt_1/replies')
      .set(ADMIN)
      .send({ message: 'Anything else, just say.', status: 'resolved', notifyMember: false });
    expect(resolved.body.ticket.status).toBe('resolved');
  });

  it('refuses to reply to a closed ticket, because the member could not reply back', async () => {
    const session = await member();
    await ticket(session.userId, 'tkt_closed', { status: 'closed' });
    const refused = await request(app)
      .post('/v1/admin/support/tickets/tkt_closed/replies')
      .set(ADMIN)
      .send({ message: 'One more thing.' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('TICKET_CLOSED');
  });

  it('moves a status, and tells them only when asked', async () => {
    const session = await member();
    await ticket(session.userId, 'tkt_1');

    const quiet = await request(app)
      .put('/v1/admin/support/tickets/tkt_1/status')
      .set(ADMIN)
      .send({ status: 'in_progress', note: 'picked up' });
    expect(quiet.status).toBe(200);
    expect(quiet.body.ticket.status).toBe('in_progress');
    expect(await NotificationModel.countDocuments({ userId: session.userId })).toBe(0);

    const closed = await request(app)
      .put('/v1/admin/support/tickets/tkt_1/status')
      .set(ADMIN)
      .send({ status: 'closed', notifyMember: true });
    expect(closed.body.ticket.status).toBe('closed');
    const told = await NotificationModel.findOne({ userId: session.userId }).lean();
    expect(told?.title).toContain('closed');
  });

  it('deletes spam, and refuses to delete a conversation we took part in', async () => {
    const session = await member();
    await ticket(session.userId, 'tkt_spam', { subject: 'cheap watches', messages: [{ id: 'm1', from: 'user', body: 'buy cheap watches at example.com', createdAt: new Date() }] });
    await ticket(session.userId, 'tkt_real', {
      messages: [
        { id: 'm2', from: 'user', body: 'My coins are missing.', createdAt: new Date() },
        { id: 'm3', from: 'support', body: 'Credited now.', createdAt: new Date() },
      ],
    });

    const spam = await request(app)
      .delete('/v1/admin/support/tickets/tkt_spam')
      .set(ADMIN)
      .send({ reason: 'spam', confirm: true });
    expect(spam.status).toBe(200);
    expect(await SupportTicketModel.exists({ _id: 'tkt_spam' })).toBeFalsy();

    const refused = await request(app)
      .delete('/v1/admin/support/tickets/tkt_real')
      .set(ADMIN)
      .send({ reason: 'tidying', confirm: true });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details.id).toMatch(/Close it instead/);
    expect(await SupportTicketModel.exists({ _id: 'tkt_real' })).toBeTruthy();
  });
});

describe('admin: the help centre’s own content', () => {
  it('writes an article the member can then read, and hides one without deleting it', async () => {
    const session = await member();

    const created = await request(app).post('/v1/admin/support/faqs').set(ADMIN).send({
      id: 'how-coins-expire',
      category: 'coins',
      question: 'Do my coins expire?',
      answer: 'Coins expire 180 days after they are earned. The oldest are always spent first.',
      tags: ['expiry', 'coins', 'validity'],
      sort: 1,
    });
    expect(created.status).toBe(201);
    expect(created.body.article).toMatchObject({ id: 'how-coins-expire', category: 'coins', active: true });

    // The whole point: the member reads it without an app release.
    const theirs = await request(app).get('/v1/support/faqs').query({ q: 'expire' }).set(authed(session));
    expect(theirs.status).toBe(200);
    expect(theirs.body.data.map((row: { id: string }) => row.id)).toContain('how-coins-expire');

    const hidden = await request(app)
      .put('/v1/admin/support/faqs/how-coins-expire')
      .set(ADMIN)
      .send({ active: false, note: 'rewording' });
    expect(hidden.body.article.active).toBe(false);
    const after = await request(app).get('/v1/support/faqs').query({ q: 'expire' }).set(authed(session));
    expect(after.body.data.map((row: { id: string }) => row.id)).not.toContain('how-coins-expire');

    const gone = await request(app)
      .delete('/v1/admin/support/faqs/how-coins-expire')
      .set(ADMIN)
      .send({ note: 'answered in the guide instead' });
    expect(gone.status).toBe(200);
    expect(await SupportFaqModel.exists({ _id: 'how-coins-expire' })).toBeFalsy();
  });

  it('lists the shelves, and names the ones with nothing on them', async () => {
    await SupportFaqModel.create({ _id: 'a', category: 'coins', question: 'Q1?', answer: 'A1', active: true });
    await SupportFaqModel.create({ _id: 'b', category: 'coins', question: 'Q2?', answer: 'A2', active: false });

    const page = await request(app).get('/v1/admin/support/faqs').set(ADMIN);
    expect(page.status).toBe(200);
    expect(page.body.byCategory).toEqual(expect.arrayContaining([{ category: 'coins', articles: 2, active: 1 }]));
    // A help-page row that opens an empty list is a dead end worth naming.
    expect(page.body.totals.emptyCategories).toEqual(expect.arrayContaining(['orders', 'account', 'privacy']));
    expect(page.body.totals.emptyCategories).not.toContain('coins');

    const hidden = await request(app).get('/v1/admin/support/faqs').query({ state: 'hidden' }).set(ADMIN);
    expect(hidden.body.total).toBe(1);
  });

  it('writes a guide chapter, and refuses an icon the app cannot draw', async () => {
    const session = await member();

    const created = await request(app).post('/v1/admin/support/guide').set(ADMIN).send({
      id: 'first-steps',
      title: 'Your first walk',
      summary: 'Where the steps come from, and when they count.',
      icon: 'guide',
      tint: 'success',
      steps: [
        { title: 'Allow activity access', body: 'VOKVE counts with the phone’s own step sensor.' },
        { title: 'Walk', body: 'Steps appear on the home screen as you go.' },
      ],
      sort: 1,
    });
    expect(created.status).toBe(201);
    // The seed ships chapters of its own, so the figure to check is that
    // this one joined them rather than the total.
    const mine = created.body.data.find((row: { id: string }) => row.id === 'first-steps');
    expect(mine).toMatchObject({ title: 'Your first walk', icon: 'guide', tint: 'success', active: true });
    expect(mine.steps).toHaveLength(2);

    const theirs = await request(app).get('/v1/support/guide').set(authed(session));
    expect(theirs.status).toBe(200);
    expect(theirs.body.sections[0]).toMatchObject({ id: 'first-steps', icon: 'guide', tint: 'success' });
    expect(theirs.body.sections[0].steps).toHaveLength(2);

    // The app parses the whole guide, so an unknown glyph would not be a
    // blank tile — it would be a screen that fails to load.
    const bad = await request(app).post('/v1/admin/support/guide').set(ADMIN).send({
      id: 'bad-icon',
      title: 'Nope',
      icon: 'rocket',
      steps: [{ title: 'One', body: 'Two' }],
    });
    expect(bad.status).toBe(422);

    const empty = await request(app).post('/v1/admin/support/guide').set(ADMIN).send({
      id: 'no-steps',
      title: 'A heading',
      steps: [],
    });
    expect(empty.status).toBe(422);

    const gone = await request(app).delete('/v1/admin/support/guide/first-steps').set(ADMIN).send({});
    expect(gone.status).toBe(200);
    expect(await SupportGuideSectionModel.exists({ _id: 'first-steps' })).toBeFalsy();
  });
});

describe('admin: the whole config, key by key', () => {
  it('reads every section, and shows only where the stored value has parted from the code', async () => {
    await seed();
    const page = await request(app).get('/v1/admin/config').set(ADMIN);
    expect(page.status).toBe(200);

    const names = page.body.sections.map((row: { section: string }) => row.section);
    expect(names).toEqual(expect.arrayContaining(['coins', 'commerce', 'hydration', 'support', 'app', 'activity']));

    // The seed writes a copy of every section, and a copy is not an override.
    expect(page.body.totals.overrides).toBe(0);

    // The step pipeline's sections are marked rather than hidden: they have
    // their own curated page.
    const activity = page.body.sections.find((row: { section: string }) => row.section === 'activity');
    expect(activity.alsoOnStepsPage).toBe(true);
    const appSection = page.body.sections.find((row: { section: string }) => row.section === 'app');
    expect(appSection.managedElsewhere[0]).toMatchObject({ prefix: 'app.minVersion', by: 'Releases' });
  });

  it('writes a key by its path, reports it as an override, and puts it back', async () => {
    await seed();

    const written = await request(app)
      .put('/v1/admin/config')
      .set(ADMIN)
      .send({ set: { 'commerce.shippingFeePaise': 9900, 'support.phone': null }, note: 'courier rates went up' });
    expect(written.status).toBe(200);

    const commerce = written.body.sections.find((row: { section: string }) => row.section === 'commerce');
    expect(commerce.overrides).toEqual(
      expect.arrayContaining([{ path: 'commerce.shippingFeePaise', value: 9900, default: 4900 }]),
    );
    expect(commerce.effective.shippingFeePaise).toBe(9900);
    expect(commerce.updatedBy).toBeTruthy();

    // A nullable key really can be set to null: that is how the phone number
    // is taken off the help page.
    const support = written.body.sections.find((row: { section: string }) => row.section === 'support');
    expect(support.effective.phone).toBeNull();

    // And the member's own read sees it at once — the cache is invalidated.
    const session = await member();
    const shop = await request(app).get('/v1/shop/config').set(authed(session));
    expect(shop.body.shippingFeePaise).toBe(9900);

    const back = await request(app)
      .put('/v1/admin/config')
      .set(ADMIN)
      .send({ reset: ['commerce.shippingFeePaise'], note: 'back to the standard rate' });
    const after = back.body.sections.find((row: { section: string }) => row.section === 'commerce');
    expect(after.effective.shippingFeePaise).toBe(4900);
    expect(after.overrides.some((row: { path: string }) => row.path === 'commerce.shippingFeePaise')).toBe(false);
  });

  it('refuses a path that does not exist, rather than writing a key nothing reads', async () => {
    const typo = await request(app)
      .put('/v1/admin/config')
      .set(ADMIN)
      .send({ set: { 'commerce.shippingFeePiase': 9900 } });
    expect(typo.status).toBe(422);
    expect(typo.body.error.details['commerce.shippingFeePiase']).toMatch(/no such config key/);

    const nested = await request(app)
      .put('/v1/admin/config')
      .set(ADMIN)
      .send({ set: { commerce: { shippingFeePiase: 9900 } } });
    expect(nested.status).toBe(422);
    expect(nested.body.error.details.commerce).toMatch(/no 'shippingFeePiase' under commerce/);
  });

  it('refuses a value of the wrong kind, against the shape of the defaults', async () => {
    const asText = await request(app)
      .put('/v1/admin/config')
      .set(ADMIN)
      .send({ set: { 'commerce.shippingFeePaise': '9900' } });
    expect(asText.status).toBe(422);
    expect(asText.body.error.details['commerce.shippingFeePaise']).toMatch(/holds a number, and this is a string/);

    const asNumber = await request(app)
      .put('/v1/admin/config')
      .set(ADMIN)
      .send({ set: { 'commerce.couponsEnabled': 1 } });
    expect(asNumber.status).toBe(422);
    expect(asNumber.body.error.details['commerce.couponsEnabled']).toMatch(/holds a boolean/);

    // Inside a list of objects, a key the app does not read is a blank tile.
    const strayKey = await request(app)
      .put('/v1/admin/config')
      .set(ADMIN)
      .send({
        set: {
          'support.topics': [
            { id: 'faq', title: 'FAQ', subtitle: 'Answers', kind: 'faq', category: null, icon: 'question', tint: 'primary', colour: 'red' },
          ],
        },
      });
    expect(strayKey.status).toBe(422);
    expect(strayKey.body.error.details['support.topics']).toMatch(/does not read: 'colour'/);
  });

  it('refuses a key another page owns, and says which page', async () => {
    const wall = await request(app)
      .put('/v1/admin/config')
      .set(ADMIN)
      .send({ set: { 'app.minVersion.android': '9.9.9' } });
    expect(wall.status).toBe(422);
    expect(wall.body.error.details['app.minVersion.android']).toMatch(/Releases page/);
  });

  it('runs the same cross-field validator every read runs, before anything is written', async () => {
    await seed();
    // A single drink bigger than the largest one allowed: in range on its
    // own, and nonsense beside the key next to it.
    const ladder = await request(app)
      .put('/v1/admin/config')
      .set(ADMIN)
      .send({ set: { 'hydration.minMl': 99_999 } });
    expect(ladder.status).toBe(422);
    // The validator speaks in whole sentences, and that is what comes back.
    expect(ladder.body.error.details.config).toMatch(/not a range a drink can be in/);

    // And the same for a cap above the ceiling it is counted against (E8c).
    const caps = await request(app)
      .put('/v1/admin/config')
      .set(ADMIN)
      .send({ set: { 'coins.sourceCaps.steps': 999_999 } });
    expect(caps.status).toBe(422);
    expect(caps.body.error.details.config).toMatch(/exceeds coins.dailyCap/);

    // Nothing was written: a bad document would otherwise fail every read in
    // the process rather than the write that caused it.
    invalidateConfig();
    const stored = await AppConfigModel.findById('hydration').lean();
    expect((stored?.value as { minMl?: number } | undefined)?.minMl).not.toBe(99_999);
  });

  it('writes the help centre’s own copy, which is what the member reads', async () => {
    await seed();
    const session = await member();

    const written = await request(app)
      .put('/v1/admin/config')
      .set(ADMIN)
      .send({
        set: {
          'support.responseTime': 'We usually reply within 4 hours.',
          'support.hours': 'Every day, 8 am – 10 pm IST',
        },
        note: 'new support shift',
      });
    expect(written.status).toBe(200);

    const home = await request(app).get('/v1/support/home').set(authed(session));
    expect(home.status).toBe(200);
    expect(JSON.stringify(home.body)).toContain('within 4 hours');
  });
});
