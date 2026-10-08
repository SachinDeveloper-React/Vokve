import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AccountPrivacyModel, MediaModel, SupportFaqModel, SupportTicketModel } from '../src/modules/account/models.js';
import { invalidateConfig } from '../src/config/remote.js';
import { levelFor, purgeScheduledDeletions, tierTitleFor } from '../src/modules/account/service.js';
import { ActivityDailyModel } from '../src/modules/activity/models.js';
import { AddressModel, OrderModel } from '../src/modules/commerce/models.js';
import { credit } from '../src/modules/economy/service.js';
import { RefreshTokenModel, UserModel } from '../src/modules/identity/models.js';
import { notify } from '../src/modules/notifications/service.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { EventModel } from '../src/modules/platform/models.js';
import { StreakDayModel } from '../src/modules/streak/models.js';
import { WorkoutModel } from '../src/modules/training/models.js';
import { app, authed, baseHeaders, signUpAndRegister, type Session } from './helpers.js';

const DAY = '2026-09-14';
const PASSWORD = 'walk1000steps';

/** `YYYY-MM-DD`, `n` days before today in UTC — the calendar the rollups use. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function fund(session: Session, coins: number, reference = 'fund') {
  await credit({
    userId: session.userId, source: 'refund', referenceType: 'test', referenceId: reference,
    amount: coins, title: 'Test funds', localDay: DAY, exemptFromCap: true,
  });
}

describe('account: profile summary (RULES P4, P6)', () => {
  it('starts a new member at level 1, unranked, with every badge locked and the gaps named', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).get('/v1/me/profile').set(authed(session));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      level: 1,
      tierTitle: 'Athlo Rookie',
      xp: 0,
      trustTier: 'normal',
      stats: { coins: 0, lifetimeCoins: 0, currentStreak: 0, longestStreak: 0, totalSteps: 0, totalWorkouts: 0, orders: 0, referrals: 0 },
    });
    expect(res.body.memberSince).toEqual(expect.any(String));
    expect(res.body.badges.every((b: { unlockedAt: string | null }) => b.unlockedAt === null)).toBe(true);
    // Sign-up asked for a date of birth and a gender; everything else is still missing.
    const fields = res.body.gaps.map((g: { field: string }) => g.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'avatarUrl', 'heightCm', 'weightKg', 'phone', 'address']));
    expect(fields).not.toContain('dateOfBirth');
    expect(res.body.completeness).toBeLessThan(50);
  });

  it('reads the level from lifetime coins and the stats from the rows that prove them', async () => {
    const session = await signUpAndRegister();
    // 2,500 lifetime coins → floor(sqrt(25)) = level 5, "Athlo Runner", a
    // quarter of the way to level 6 (3,600).
    await fund(session, 2_500);
    await ActivityDailyModel.insertMany([
      { _id: `${session.userId}:${daysAgo(0)}`, userId: session.userId, localDay: daysAgo(0), steps: 8_000 },
      { _id: `${session.userId}:${daysAgo(1)}`, userId: session.userId, localDay: daysAgo(1), steps: 12_000 },
      { _id: `${session.userId}:${daysAgo(2)}`, userId: session.userId, localDay: daysAgo(2), steps: 6_000, workoutsCompleted: 1 },
      // A gap, then an older run.
      { _id: `${session.userId}:${daysAgo(6)}`, userId: session.userId, localDay: daysAgo(6), steps: 5_000 },
      { _id: `${session.userId}:${daysAgo(7)}`, userId: session.userId, localDay: daysAgo(7), steps: 5_000 },
      { _id: `${session.userId}:${daysAgo(8)}`, userId: session.userId, localDay: daysAgo(8), steps: 5_000 },
      { _id: `${session.userId}:${daysAgo(9)}`, userId: session.userId, localDay: daysAgo(9), steps: 5_000 },
    ]);
    // The streak figures are the streak module's: the days it recorded as
    // earned, the same ones the streak screen draws.
    await StreakDayModel.insertMany(
      [0, 1, 2, 6, 7, 8, 9].map(n => ({
        _id: `${session.userId}:${daysAgo(n)}`, userId: session.userId, localDay: daysAgo(n), kind: 'earned', source: 'steps',
      })),
    );
    const started = new Date('2026-09-14T06:00:00Z');
    await WorkoutModel.create({
      _id: 'wk-1', userId: session.userId, title: 'Push Day', startedAt: started,
      completedAt: new Date(started.getTime() + 45 * 60_000), localDay: DAY,
    });

    const res = await request(app).get('/v1/me/profile').set(authed(session));
    expect(res.body).toMatchObject({
      level: 5,
      tierTitle: 'Athlo Runner',
      xp: 2_500,
      xpIntoLevel: 0,
      xpForNextLevel: 1_100, // 3,600 − 2,500
      levelProgress: 0,
      stats: {
        coins: 2_500, lifetimeCoins: 2_500, currentStreak: 3, longestStreak: 4,
        totalSteps: 46_000, activeDays: 7, totalWorkouts: 1, totalWorkoutMinutes: 45,
      },
    });
    // Rank needs somebody to be ranked against.
    expect(res.body.rank === null || res.body.rank >= 1).toBe(true);

    const streakBadge = res.body.badges.find((b: { id: string }) => b.id === 'streak-7');
    expect(streakBadge).toMatchObject({ value: 4, goal: 7, unlockedAt: null });
    expect(streakBadge.progress).toBeCloseTo(4 / 7, 5);
  });

  it('unlocks a badge when its figure is reached, and ranks by lifetime coins', async () => {
    const quiet = await signUpAndRegister();
    await fund(quiet, 500);
    const busy = await signUpAndRegister();
    await fund(busy, 6_000);

    const leader = await request(app).get('/v1/me/profile').set(authed(busy));
    expect(leader.body.rank).toBe(1);
    expect(leader.body.totalMembers).toBeGreaterThanOrEqual(2);
    expect(leader.body.badges.find((b: { id: string }) => b.id === 'coins-5000')).toMatchObject({ value: 5_000, unlockedAt: expect.any(String) });

    const follower = await request(app).get('/v1/me/profile').set(authed(quiet));
    expect(follower.body.rank).toBe(2);
  });

  it('counts the gaps it can close: a filled profile is complete', async () => {
    const session = await signUpAndRegister();
    await UserModel.updateOne({ _id: session.userId }, {
      $set: {
        name: 'Asha Verma', avatarUrl: 'https://cdn.vokve.app/a/1.png', heightCm: 165, weightKg: 58,
        emailVerifiedAt: new Date(), phoneVerifiedAt: new Date(),
      },
    });
    await AddressModel.create({
      _id: 'adr-1', userId: session.userId, label: 'Home', name: 'Asha Verma', phone: '+919876543210',
      line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', isDefault: true,
    });
    const res = await request(app).get('/v1/me/profile').set(authed(session));
    expect(res.body.completeness).toBe(100);
    expect(res.body.gaps).toEqual([]);
  });

  it('computes the level and its title without a database', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(99)).toBe(1);
    expect(levelFor(100)).toBe(1);
    expect(levelFor(2_500)).toBe(5);
    expect(levelFor(32_400)).toBe(18);
    expect(tierTitleFor(1)).toBe('Athlo Rookie');
    expect(tierTitleFor(18)).toBe('Athlo Warrior');
    expect(tierTitleFor(99)).toBe('Athlo Legend');
  });
});

describe('account: privacy (RULES P7)', () => {
  it('defaults to on, patches one switch at a time, and drops analytics for a member who opted out', async () => {
    const session = await signUpAndRegister();
    const initial = await request(app).get('/v1/me/privacy').set(authed(session));
    expect(initial.body).toEqual({ analytics: true, personalisedOffers: true, shareNameWithReferrer: true });

    const event = { name: 'screen_view', at: new Date().toISOString() };
    expect((await request(app).post('/v1/events').set(authed(session)).send({ events: [event] })).body).toEqual({ accepted: 1 });
    expect(await EventModel.countDocuments({ userId: session.userId })).toBe(1);

    const off = await request(app).put('/v1/me/privacy').set(authed(session)).send({ analytics: false });
    expect(off.body).toEqual({ analytics: false, personalisedOffers: true, shareNameWithReferrer: true });

    const dropped = await request(app).post('/v1/events').set(authed(session)).send({ events: [event] });
    expect(dropped.status).toBe(202);
    expect(dropped.body).toEqual({ accepted: 0, dropped: 1 });
    expect(await EventModel.countDocuments({ userId: session.userId })).toBe(1);
    expect((await request(app).put('/v1/me/privacy').set(authed(session)).send({ nope: true })).status).toBe(422);
  });

  it('suppresses a targeted offer entirely, while an untargeted one still lands', async () => {
    const session = await signUpAndRegister();
    await request(app).put('/v1/me/privacy').set(authed(session)).send({ personalisedOffers: false });

    const targeted = await notify({ userId: session.userId, topic: 'reward', preference: 'offers', personalised: true, title: 'Just for you', message: 'A deal picked for you.' });
    expect(targeted).toMatchObject({ id: null, status: 'suppressed' });

    const everyone = await notify({ userId: session.userId, topic: 'system', title: 'Maintenance', message: 'Back in ten minutes.' });
    expect(everyone.status).toBe('created');
    const feed = await request(app).get('/v1/notifications').set(authed(session));
    expect(feed.body.data.map((n: { title: string }) => n.title)).toEqual(['Maintenance']);
  });

  it('withholds a member\'s name from the friend who invited them when they ask it to', async () => {
    const inviter = await signUpAndRegister();
    await UserModel.updateOne({ _id: inviter.userId }, { $set: { name: 'Asha Verma' } });
    const code = (await request(app).get('/v1/referrals/me').set(authed(inviter))).body.code;

    const invitee = await signUpAndRegister();
    await UserModel.updateOne({ _id: invitee.userId }, { $set: { name: 'Ravi Kumar' } });
    await request(app).post('/v1/referrals/apply').set(authed(invitee)).send({ code });

    const named = await request(app).get('/v1/referrals').set(authed(inviter));
    expect(named.body.data[0].name).toBe('Ravi');

    await request(app).put('/v1/me/privacy').set(authed(invitee)).send({ shareNameWithReferrer: false });
    const hidden = await request(app).get('/v1/referrals').set(authed(inviter));
    expect(hidden.body.data[0].name).toBe('A friend');
    // The referral itself is untouched — only the name is withheld.
    expect(hidden.body.data).toHaveLength(1);
  });
});

describe('account: password, contacts and sessions', () => {
  it('refuses the wrong current password, refuses the same one again, then changes it and signs other devices out', async () => {
    const session = await signUpAndRegister();
    const other = await request(app).post('/v1/auth/sign-in').set(baseHeaders).send({ email: session.email, password: PASSWORD });
    expect(other.status).toBe(200);
    expect(await RefreshTokenModel.countDocuments({ userId: session.userId, revokedAt: null })).toBe(2);

    const wrong = await request(app).put('/v1/me/password').set(authed(session)).send({ currentPassword: 'nope1234', newPassword: 'newpass123' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('PASSWORD_INCORRECT');

    const same = await request(app).put('/v1/me/password').set(authed(session)).send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.body.error.code).toBe('PASSWORD_UNCHANGED');
    expect((await request(app).put('/v1/me/password').set(authed(session)).send({ currentPassword: PASSWORD, newPassword: 'short1' })).status).toBe(422);

    const changed = await request(app).put('/v1/me/password').set(authed(session)).send({ currentPassword: PASSWORD, newPassword: 'newpass123' });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ ok: true, signedOutSessions: 1 });

    // The old password is gone; the new one works; this device is still signed in.
    expect((await request(app).post('/v1/auth/sign-in').set(baseHeaders).send({ email: session.email, password: PASSWORD })).status).toBe(401);
    expect((await request(app).post('/v1/auth/sign-in').set(baseHeaders).send({ email: session.email, password: 'newpass123' })).status).toBe(200);
    expect((await request(app).get('/v1/me').set(authed(session))).status).toBe(200);
  });

  it('moves the email only once a code sent to the new address is passed', async () => {
    const session = await signUpAndRegister();
    const next = `moved-${session.userId.slice(-6)}@example.com`;

    expect((await request(app).post('/v1/me/email').set(authed(session)).send({ email: next, password: 'nope1234' })).body.error.code).toBe('PASSWORD_INCORRECT');
    expect((await request(app).post('/v1/me/email').set(authed(session)).send({ email: session.email, password: PASSWORD })).status).toBe(422);
    const taken = await signUpAndRegister();
    expect((await request(app).post('/v1/me/email').set(authed(session)).send({ email: taken.email, password: PASSWORD })).status).toBe(422);

    const challenge = await request(app).post('/v1/me/email').set(authed(session)).send({ email: next, password: PASSWORD });
    expect(challenge.status).toBe(200);
    expect(challenge.body).toMatchObject({ channel: 'email', purpose: 'change_email', target: expect.stringContaining('@') });
    // Not yet: the code is what moves it.
    expect((await request(app).get('/v1/me').set(authed(session))).body.email).toBe(session.email);

    const verified = await request(app).post('/v1/auth/verify-otp').set(authed(session)).send({ verificationId: challenge.body.verificationId, code: challenge.body.devCode });
    expect(verified.status).toBe(200);
    expect(verified.body.user.email).toBe(next);
    expect((await request(app).get('/v1/me').set(authed(session))).body.email).toBe(next);
  });

  it('lists the devices with a session, marks the one asking, and signs the rest out', async () => {
    const session = await signUpAndRegister();
    const second = await request(app).post('/v1/auth/sign-in').set(baseHeaders).send({ email: session.email, password: PASSWORD });
    const registered = await request(app).post('/v1/devices/register').set(baseHeaders)
      .set('authorization', `Bearer ${second.body.tokens.accessToken}`)
      .set('x-vokve-refresh-token', second.body.tokens.refreshToken)
      .send({ installId: 'install-second-device', platform: 'ios', profile: { brand: 'Apple', model: 'iPhone 15', osVersion: '18', app: { version: '1.0.0', build: '1' } } });
    expect(registered.status).toBe(200);

    const list = await request(app).get('/v1/me/sessions').set(authed(session));
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((d: { isCurrent: boolean }) => d.isCurrent)).toHaveLength(1);
    expect(list.body.data.map((d: { platform: string }) => d.platform).sort()).toEqual(['android', 'ios']);

    const revoked = await request(app).post('/v1/me/sessions/revoke-others').set(authed(session));
    expect(revoked.body).toEqual({ signedOut: 1 });
    expect((await request(app).get('/v1/me/sessions').set(authed(session))).body.data).toHaveLength(1);
    // The other device's refresh token no longer works; this one is untouched.
    expect((await request(app).post('/v1/auth/refresh').set(baseHeaders).send({ refreshToken: second.body.tokens.refreshToken })).status).toBe(401);
    expect((await request(app).get('/v1/me').set(authed(session))).status).toBe(200);
  });
});

describe('account: export and deletion (RULES P5, P8)', () => {
  it('exports everything the account holds, once a day', async () => {
    const session = await signUpAndRegister();
    await fund(session, 300);
    await ActivityDailyModel.create({ _id: `${session.userId}:${DAY}`, userId: session.userId, localDay: DAY, steps: 9_000 });

    const res = await request(app).get('/v1/me/export').set(authed(session));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ format: 'vokve.account.v1', profile: { email: session.email }, privacy: { analytics: true } });
    expect(res.body.activity).toHaveLength(1);
    expect(Object.keys(res.body)).toEqual(expect.arrayContaining(['workouts', 'orders', 'addresses', 'referrals', 'notifications', 'supportTickets', 'devices']));

    const again = await request(app).get('/v1/me/export').set(authed(session));
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('EXPORT_TOO_SOON');
  });

  it('schedules a deletion the password proves, lets it be cancelled, and purges when the window closes', async () => {
    const session = await signUpAndRegister();
    await ActivityDailyModel.create({ _id: `${session.userId}:${DAY}`, userId: session.userId, localDay: DAY, steps: 9_000 });
    await AddressModel.create({
      _id: 'adr-del', userId: session.userId, label: 'Home', name: 'Asha', phone: '+919876543210',
      line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001',
    });
    await notify({ userId: session.userId, topic: 'system', title: 'Hello', message: 'Welcome.' });

    expect((await request(app).get('/v1/me/deletion').set(authed(session))).body).toMatchObject({ scheduledAt: null, purgeAt: null, graceDays: 14 });
    expect((await request(app).post('/v1/me/deletion').set(authed(session)).send({ password: 'wrong1234' })).body.error.code).toBe('PASSWORD_INCORRECT');

    const scheduled = await request(app).post('/v1/me/deletion').set(authed(session)).send({ password: PASSWORD, reason: 'Taking a break' });
    expect(scheduled.status).toBe(200);
    expect(scheduled.body).toMatchObject({ scheduledAt: expect.any(String), purgeAt: expect.any(String), reason: 'Taking a break', graceDays: 14 });
    // Nothing has gone yet, and the account still works.
    expect(await purgeScheduledDeletions()).toEqual({ purged: 0 });
    expect((await request(app).get('/v1/me').set(authed(session))).status).toBe(200);

    const cancelled = await request(app).delete('/v1/me/deletion').set(authed(session));
    expect(cancelled.body).toMatchObject({ scheduledAt: null, purgeAt: null });

    // Scheduled again, with the window already behind us: the sweep takes it.
    await request(app).post('/v1/me/deletion').set(authed(session)).send({ password: PASSWORD });
    await UserModel.updateOne({ _id: session.userId }, { $set: { 'deletion.purgeAt': new Date(Date.now() - 1000) } });
    expect(await purgeScheduledDeletions()).toEqual({ purged: 1 });

    const purged = await UserModel.findById(session.userId).lean();
    expect(purged).toMatchObject({ name: 'Deleted member', avatarUrl: null, heightCm: null, weightKg: null, dateOfBirth: null });
    expect(purged!.email).not.toBe(session.email);
    expect(purged!.deletedAt).toBeTruthy();
    expect(await ActivityDailyModel.countDocuments({ userId: session.userId })).toBe(0);
    expect(await NotificationModel.countDocuments({ userId: session.userId })).toBe(0);
    expect(await AccountPrivacyModel.countDocuments({ _id: session.userId })).toBe(0);
    expect(await RefreshTokenModel.countDocuments({ userId: session.userId, revokedAt: null })).toBe(0);
    expect((await AddressModel.findById('adr-del').lean())!.deletedAt).toBeTruthy();
    // The session is over, and a second sweep finds nothing left to do.
    expect((await request(app).get('/v1/me').set(authed(session))).status).toBe(401);
    expect(await purgeScheduledDeletions()).toEqual({ purged: 0 });
  });

  it('keeps the ledger and the orders, anonymised, and cancels what was still on its way', async () => {
    const session = await signUpAndRegister();
    await fund(session, 1_000);
    await OrderModel.create({
      _id: 'ord-open', number: 'VKV2610080001', userId: session.userId, status: 'placed', currency: 'INR', subtotal: 44900, total: 49800,
      payable: 42300, coinsUsed: 300, coinsValue: 7500, payment: { status: 'paid', amount: 42300, currency: 'INR' },
      items: [{ itemId: 'cap', title: 'VOKVE Cap', quantity: 1, price: 44900 }],
      addressSnapshot: { label: 'Home', name: 'Asha', phone: '+91', line1: '1', line2: '', city: 'B', state: 'K', postalCode: '560001', country: 'IN' },
    });

    await request(app).post('/v1/me/deletion').set(authed(session)).send({ password: PASSWORD });
    await UserModel.updateOne({ _id: session.userId }, { $set: { 'deletion.purgeAt': new Date(Date.now() - 1000) } });
    await purgeScheduledDeletions();

    const order = await OrderModel.findById('ord-open').lean();
    expect(order).toMatchObject({ status: 'cancelled', coinsUsed: 300 });
  });
});

describe('account: support and about', () => {
  it('searches the help centre by word and by category', async () => {
    const session = await signUpAndRegister();
    const all = await request(app).get('/v1/support/faqs').set(authed(session));
    expect(all.body.data.length).toBeGreaterThan(5);

    const coins = await request(app).get('/v1/support/faqs').query({ category: 'coins' }).set(authed(session));
    expect(coins.body.data.every((f: { category: string }) => f.category === 'coins')).toBe(true);

    // A word from the tags, not the question: "expire" finds the expiry article.
    const expiry = await request(app).get('/v1/support/faqs').query({ q: 'expire' }).set(authed(session));
    expect(expiry.body.data.map((f: { id: string }) => f.id)).toContain('faq-coins-expiry');
    expect((await request(app).get('/v1/support/faqs').query({ q: 'zzzqqq' }).set(authed(session))).body.data).toEqual([]);
  });

  it('serves the help centre\'s front page: the rows with their counts, the channels, and the promise (P12)', async () => {
    const session = await signUpAndRegister();
    const home = await request(app).get('/v1/support/home').set(authed(session));
    expect(home.status).toBe(200);

    // The design's eight rows, in the ⚙ order.
    expect(home.body.topics.map((t: { id: string }) => t.id)).toEqual([
      'faq', 'contact', 'report', 'orders', 'coins', 'account', 'privacy', 'guide',
    ]);
    // A shelf says how many articles are behind it; a page does not.
    const byId = Object.fromEntries(home.body.topics.map((t: { id: string }) => [t.id, t]));
    expect(byId.faq).toMatchObject({ kind: 'faq', category: null, icon: 'question', tint: 'destructive' });
    expect(byId.faq.count).toBeGreaterThan(5);
    expect(byId.coins).toMatchObject({ kind: 'faq', category: 'coins', count: 3 });
    expect(byId.privacy).toMatchObject({ kind: 'faq', category: 'privacy', count: 3 });
    expect(byId.contact).toMatchObject({ kind: 'contact', count: null });
    expect(byId.guide).toMatchObject({ kind: 'guide', count: null });

    // The promise is the server's, and so is the way to reach a human.
    expect(home.body.chat).toMatchObject({
      title: 'Chat with our Support Team',
      responseTime: 'We usually reply within 24 hours.',
      openTicketId: null,
    });
    expect(home.body.channels.map((c: { kind: string; url: string }) => [c.kind, c.url])).toEqual([
      ['email', 'mailto:support@vokve.app'],
      ['phone', 'tel:+918000000000'],
    ]);
    expect(home.body.hours).toBe('Mon–Sat, 9 am – 7 pm IST');

    // A shelf nobody has written for is not offered at all.
    await SupportFaqModel.updateMany({ category: 'privacy' }, { $set: { active: false } });
    invalidateConfig();
    const fewer = await request(app).get('/v1/support/home').set(authed(session));
    expect(fewer.body.topics.map((t: { id: string }) => t.id)).not.toContain('privacy');
    await SupportFaqModel.updateMany({ category: 'privacy' }, { $set: { active: true } });

    // A conversation already going is what "Chat Now" carries on.
    const ticket = await request(app).post('/v1/support/tickets').set(authed(session))
      .send({ subject: 'Coins missing', category: 'coins', message: 'I walked 8,000 steps and saw no coins at all today.' });
    expect((await request(app).get('/v1/support/home').set(authed(session))).body.chat.openTicketId).toBe(ticket.body.id);
  });

  it('serves the app guide as chapters of steps, in reading order', async () => {
    const session = await signUpAndRegister();
    const guide = await request(app).get('/v1/support/guide').set(authed(session));
    expect(guide.status).toBe(200);
    expect(guide.body.sections.map((s: { id: string }) => s.id)).toEqual([
      'guide-start', 'guide-earn', 'guide-spend', 'guide-orders', 'guide-safe',
    ]);
    expect(guide.body.sections[0]).toMatchObject({
      title: 'Getting started',
      icon: 'guide',
      tint: 'primary',
    });
    expect(guide.body.sections[0].steps[0]).toMatchObject({ title: 'Create your account' });
    expect(guide.body.sections.every((s: { steps: unknown[] }) => s.steps.length > 0)).toBe(true);
  });

  it('privacy is a shelf of its own, and a ticket may be opened about it', async () => {
    const session = await signUpAndRegister();
    const privacy = await request(app).get('/v1/support/faqs').query({ category: 'privacy' }).set(authed(session));
    expect(privacy.body.data.map((f: { id: string }) => f.id)).toContain('faq-privacy-health');

    const ticket = await request(app).post('/v1/support/tickets').set(authed(session))
      .send({ subject: 'Who sees my steps?', category: 'privacy', message: 'I want to understand who can see my health data in this app.' });
    expect(ticket.status).toBe(201);
    expect(ticket.body.category).toBe('privacy');
  });

  it('opens a ticket with the phone\'s details attached, threads a reply, and keeps it to its owner', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).post('/v1/support/tickets').set(authed(session)).send({ subject: 'Hi', category: 'coins', message: 'too short' })).status).toBe(422);

    const created = await request(app).post('/v1/support/tickets').set(authed(session))
      .send({ subject: 'Coins missing', category: 'coins', message: 'I walked 12,000 steps yesterday and no coins arrived.' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ subject: 'Coins missing', category: 'coins', status: 'open', reference: expect.stringMatching(/^VK-[A-Z2-9]{4}$/) });
    expect(created.body.messages).toHaveLength(1);
    expect(created.body.messages[0]).toMatchObject({ from: 'user' });
    const stored = await SupportTicketModel.findById(created.body.id).lean();
    expect(stored!.context).toMatchObject({ appVersion: '1.0.0', platform: 'android' });

    // Support answers, and the member replies: the thread reopens.
    await SupportTicketModel.updateOne({ _id: created.body.id }, {
      $set: { status: 'resolved' },
      $push: { messages: { id: 'msg-support', from: 'support', body: 'They were held pending a check — released now.', createdAt: new Date() } },
    });
    const replied = await request(app).post(`/v1/support/tickets/${created.body.id}/replies`).set(authed(session)).send({ message: 'Thanks, I can see them now.' });
    expect(replied.body).toMatchObject({ status: 'open' });
    expect(replied.body.messages.map((m: { from: string }) => m.from)).toEqual(['user', 'support', 'user']);

    await SupportTicketModel.updateOne({ _id: created.body.id }, { $set: { status: 'closed' } });
    const closed = await request(app).post(`/v1/support/tickets/${created.body.id}/replies`).set(authed(session)).send({ message: 'One more thing.' });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('TICKET_CLOSED');

    const other = await signUpAndRegister();
    expect((await request(app).get(`/v1/support/tickets/${created.body.id}`).set(authed(other))).status).toBe(404);
    expect((await request(app).get('/v1/support/tickets').set(authed(other))).body.data).toEqual([]);
    expect((await request(app).get('/v1/support/tickets').set(authed(session))).body.data).toHaveLength(1);
  });

  it('tells a build where it stands, without needing a session', async () => {
    await signUpAndRegister(); // seeds the releases the notes are read from
    const current = await request(app).get('/v1/app/about').set(baseHeaders);
    expect(current.status).toBe(200);
    expect(current.body).toMatchObject({
      name: 'VOKVE', version: '1.0.0', minVersion: '1.0.0', updateRequired: false, updateAvailable: false,
      supportEmail: 'support@vokve.app', links: { privacy: expect.stringContaining('http') },
    });
    expect(current.body.releaseNotes.length).toBeGreaterThan(0);

    const old = await request(app).get('/v1/app/about').set({ ...baseHeaders, 'x-vokve-app-version': '0.9.0' });
    expect(old.body).toMatchObject({ version: '0.9.0', updateRequired: true, updateAvailable: true });
  });
});

/**
 * Supertest parses a response by its content-type and has no parser for an
 * image, so the bytes have to be collected by hand to be compared.
 */
function binary(path: string) {
  return request(app)
    .get(path)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

describe('account: avatar (RULES P10)', () => {
  /** The smallest real files of each kind — enough for the sniffer to judge. */
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 7)]);

  it('stores the photo, points the record at it, and serves it to anyone with the link', async () => {
    const session = await signUpAndRegister();
    expect((await request(app).get('/v1/me').set(authed(session))).body.avatarUrl).toBeNull();

    const uploaded = await request(app).post('/v1/me/avatar').set(authed(session))
      .send({ contentType: 'image/jpeg', data: JPEG.toString('base64') });
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.avatarUrl).toMatch(/\/v1\/media\/avatars\/avt_/);
    expect((await request(app).get('/v1/me').set(authed(session))).body.avatarUrl).toBe(uploaded.body.avatarUrl);

    // The URL needs no session: an avatar sits beside reviews other people read.
    const path = new URL(uploaded.body.avatarUrl).pathname;
    const served = await binary(path);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/jpeg');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.body).toEqual(JPEG);

    expect((await request(app).get('/v1/media/avatars/avt_nope')).status).toBe(404);
  });

  it('keeps one photo per member: a second upload replaces the first', async () => {
    const session = await signUpAndRegister();
    const first = await request(app).post('/v1/me/avatar').set(authed(session))
      .send({ contentType: 'image/jpeg', data: JPEG.toString('base64') });
    const second = await request(app).post('/v1/me/avatar').set(authed(session))
      .send({ contentType: 'image/png', data: PNG.toString('base64') });

    expect(second.body.avatarUrl).not.toBe(first.body.avatarUrl);
    expect(await MediaModel.countDocuments({ userId: session.userId })).toBe(1);
    // The old id is gone, so nothing keeps serving a face that was replaced.
    expect((await request(app).get(new URL(first.body.avatarUrl).pathname)).status).toBe(404);
    expect((await request(app).get(new URL(second.body.avatarUrl).pathname)).headers['content-type']).toContain('image/png');
  });

  it('refuses anything that is not the image it claims to be, and anything too big', async () => {
    const session = await signUpAndRegister();

    const lying = await request(app).post('/v1/me/avatar').set(authed(session))
      .send({ contentType: 'image/jpeg', data: Buffer.from('%PDF-1.7 not an image at all').toString('base64') });
    expect(lying.status).toBe(422);
    expect(lying.body.error.details.data).toContain('not a JPEG');

    // A real PNG declared as a JPEG is refused too: the bytes decide.
    const mismatched = await request(app).post('/v1/me/avatar').set(authed(session))
      .send({ contentType: 'image/jpeg', data: PNG.toString('base64') });
    expect(mismatched.status).toBe(422);

    const huge = Buffer.concat([JPEG, Buffer.alloc(600 * 1024, 1)]);
    const tooBig = await request(app).post('/v1/me/avatar').set(authed(session))
      .send({ contentType: 'image/jpeg', data: huge.toString('base64') });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error).toMatchObject({ code: 'AVATAR_TOO_LARGE', details: { maxKb: 512 } });

    expect((await request(app).post('/v1/me/avatar').set(authed(session)).send({ contentType: 'image/gif', data: 'x' })).status).toBe(422);
    expect(await MediaModel.countDocuments({ userId: session.userId })).toBe(0);
  });

  it('removing the photo goes back to initials, and counts towards completeness either way', async () => {
    const session = await signUpAndRegister();
    const withPhoto = await request(app).post('/v1/me/avatar').set(authed(session))
      .send({ contentType: 'image/jpeg', data: JPEG.toString('base64') });
    expect(withPhoto.status).toBe(200);

    const profile = await request(app).get('/v1/me/profile').set(authed(session));
    expect(profile.body.gaps.map((g: { field: string }) => g.field)).not.toContain('avatarUrl');

    const removed = await request(app).delete('/v1/me/avatar').set(authed(session));
    expect(removed.body.avatarUrl).toBeNull();
    expect(await MediaModel.countDocuments({ userId: session.userId })).toBe(0);
    const after = await request(app).get('/v1/me/profile').set(authed(session));
    expect(after.body.gaps.map((g: { field: string }) => g.field)).toContain('avatarUrl');
  });

  it('a purged account takes its photo with it', async () => {
    const session = await signUpAndRegister();
    await request(app).post('/v1/me/avatar').set(authed(session))
      .send({ contentType: 'image/jpeg', data: JPEG.toString('base64') });

    await request(app).post('/v1/me/deletion').set(authed(session)).send({ password: PASSWORD });
    await UserModel.updateOne({ _id: session.userId }, { $set: { 'deletion.purgeAt': new Date(Date.now() - 1000) } });
    await purgeScheduledDeletions();

    expect(await MediaModel.countDocuments({ userId: session.userId })).toBe(0);
    expect((await UserModel.findById(session.userId).lean())!.avatarUrl).toBeNull();
  });
});
