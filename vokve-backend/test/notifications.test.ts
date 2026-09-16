import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { setPushTransport, type PushMessage } from '../src/lib/push.js';
import { DeviceModel } from '../src/modules/devices/models.js';
import { CoinBalanceModel } from '../src/modules/economy/models.js';
import { credit } from '../src/modules/economy/service.js';
import { expireIdleWallets, warnExpiringWallets } from '../src/modules/economy/wallet.service.js';
import { NotificationPreferencesModel, UserModel } from '../src/modules/identity/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { flushDeferredPushes, notify, quietHoursDelayMs } from '../src/modules/notifications/service.js';
import { app, authed, signUpAndRegister } from './helpers.js';

const DAY = '2026-09-14';
const DAYS = 86_400_000;

/** A push provider that remembers what it was asked to send. */
function capturingTransport() {
  const sent: { tokens: string[]; message: PushMessage }[] = [];
  setPushTransport({
    async send(tokens, message) {
      sent.push({ tokens, message });
      return { sent: tokens.length, invalid: tokens.filter(t => t.startsWith('dead-')) };
    },
  });
  return sent;
}

afterEach(() => setPushTransport(null));

describe('notifications: feed, consent, quiet hours', () => {
  it('quiet hours wrap midnight and are measured on the clock face', () => {
    const window = { enabled: true, start: '22:00', end: '07:00' };
    // 23:30 IST → 7.5 h of waiting; 12:00 IST → none; window off → none.
    expect(quietHoursDelayMs(new Date('2026-09-14T18:00:00Z'), 'Asia/Kolkata', window)).toBe(7.5 * 60 * 60_000);
    expect(quietHoursDelayMs(new Date('2026-09-14T06:30:00Z'), 'Asia/Kolkata', window)).toBe(0);
    expect(quietHoursDelayMs(new Date('2026-09-14T18:00:00Z'), 'Asia/Kolkata', { ...window, enabled: false })).toBe(0);
  });

  it('writes the feed row, pushes to every live device, and never writes the same event twice', async () => {
    const session = await signUpAndRegister();
    const sent = capturingTransport();
    // Daytime in the user's zone, so quiet hours do not apply.
    await UserModel.updateOne({ _id: session.userId }, { $set: { timezone: 'UTC' } });
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { 'push.token': 'tok-1' } });
    const noon = new Date('2026-09-14T12:00:00Z');

    const first = await notify({ userId: session.userId, topic: 'coins', title: 'T', message: 'M', dedupeKey: 'evt-1', now: noon });
    expect(first).toMatchObject({ status: 'created', push: 'sent' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ tokens: ['tok-1'], message: { title: 'T', body: 'M', data: { topic: 'coins', notificationId: first.id } } });

    const again = await notify({ userId: session.userId, topic: 'coins', title: 'T', message: 'M', dedupeKey: 'evt-1', now: noon });
    expect(again).toMatchObject({ status: 'duplicate', push: 'skipped' });
    expect(await NotificationModel.countDocuments({ userId: session.userId })).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('a switched-off category still gets its feed row but no push', async () => {
    const session = await signUpAndRegister();
    const sent = capturingTransport();
    await UserModel.updateOne({ _id: session.userId }, { $set: { timezone: 'UTC' } });
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { 'push.token': 'tok-1' } });
    await NotificationPreferencesModel.updateOne({ _id: session.userId }, { $set: { 'categories.coins': false } }, { upsert: true });

    const result = await notify({ userId: session.userId, topic: 'coins', title: 'T', message: 'M', now: new Date('2026-09-14T12:00:00Z') });
    expect(result.push).toBe('category_off');
    expect(sent).toHaveLength(0);
    const feed = await request(app).get('/v1/notifications').set(authed(session));
    expect(feed.body.data).toHaveLength(1);
  });

  it('quiet hours hold the push until the window ends, and the hourly flush sends it', async () => {
    const session = await signUpAndRegister();
    const sent = capturingTransport();
    await UserModel.updateOne({ _id: session.userId }, { $set: { timezone: 'Asia/Kolkata' } });
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { 'push.token': 'tok-1' } });

    const lateNight = new Date('2026-09-14T18:00:00Z'); // 23:30 IST
    const result = await notify({ userId: session.userId, topic: 'streak', title: 'Streak at risk', message: 'M', now: lateNight });
    expect(result.push).toBe('deferred');
    expect(sent).toHaveLength(0);
    const row = await NotificationModel.findById(result.id).lean();
    expect(row?.pushDeferredUntil?.toISOString()).toBe('2026-09-15T01:30:00.000Z'); // 07:00 IST

    // Too early: nothing goes. At the window's end: it goes, once.
    expect(await flushDeferredPushes(new Date('2026-09-14T23:00:00Z'))).toBe(0);
    expect(await flushDeferredPushes(new Date('2026-09-15T01:30:00Z'))).toBe(1);
    expect(await flushDeferredPushes(new Date('2026-09-15T02:00:00Z'))).toBe(0);
    expect(sent).toHaveLength(1);

    // Exempt messages ignore the window.
    const otp = await notify({ userId: session.userId, topic: 'system', title: 'New sign-in', message: 'M', now: lateNight, exemptFromQuietHours: true });
    expect(otp.push).toBe('sent');
  });

  it('a token the provider rejects is retired, and no provider means feed-only', async () => {
    const session = await signUpAndRegister();
    const sent = capturingTransport();
    await UserModel.updateOne({ _id: session.userId }, { $set: { timezone: 'UTC' } });
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { 'push.token': 'dead-1' } });
    const noon = new Date('2026-09-14T12:00:00Z');

    await notify({ userId: session.userId, topic: 'coins', title: 'T', message: 'M', now: noon });
    expect(sent).toHaveLength(1);
    expect((await DeviceModel.findById(session.deviceId).lean())?.push?.invalidAt).toBeInstanceOf(Date);

    // Retired: the next message finds no live device.
    expect((await notify({ userId: session.userId, topic: 'coins', title: 'T2', message: 'M', now: noon })).push).toBe('no_device');

    setPushTransport(null);
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { 'push.token': 'tok-2', 'push.invalidAt': null } });
    expect((await notify({ userId: session.userId, topic: 'coins', title: 'T3', message: 'M', now: noon })).push).toBe('no_provider');
    expect(await NotificationModel.countDocuments({ userId: session.userId })).toBe(3);
  });

  it('lists newest first with a category filter and cursor, counts per chip, and marks read', async () => {
    const session = await signUpAndRegister();
    const now = new Date('2026-09-14T12:00:00Z');
    for (const [i, topic] of (['steps', 'coins', 'workout', 'system', 'challenge'] as const).entries()) {
      await notify({ userId: session.userId, topic, title: `N${i}`, message: 'M', now: new Date(now.getTime() + i * 1000) });
    }

    const counts = await request(app).get('/v1/notifications/counts').set(authed(session));
    expect(counts.body).toEqual({ all: 5, activity: 2, reward: 2, system: 1, unread: 5 });

    const first = await request(app).get('/v1/notifications').query({ limit: 2 }).set(authed(session));
    expect(first.body.data.map((n: { title: string }) => n.title)).toEqual(['N4', 'N3']);
    expect(first.body.data[0]).toMatchObject({ topic: 'challenge', read: false });
    const second = await request(app).get('/v1/notifications').query({ limit: 2, cursor: first.body.nextCursor }).set(authed(session));
    expect(second.body.data.map((n: { title: string }) => n.title)).toEqual(['N2', 'N1']);

    const rewards = await request(app).get('/v1/notifications').query({ category: 'reward' }).set(authed(session));
    expect(rewards.body.data.map((n: { title: string }) => n.title)).toEqual(['N4', 'N1']);
    expect(rewards.body.nextCursor).toBeNull();

    const bad = await request(app).get('/v1/notifications').query({ category: 'promo' }).set(authed(session));
    expect(bad.status).toBe(422);

    const one = await request(app).post(`/v1/notifications/${first.body.data[0].id}/read`).set(authed(session));
    expect(one.body).toEqual({ ok: true });
    expect((await request(app).get('/v1/notifications/counts').set(authed(session))).body.unread).toBe(4);

    const all = await request(app).post('/v1/notifications/read-all').set(authed(session));
    expect(all.body).toEqual({ ok: true, updated: 4 });
    expect((await request(app).get('/v1/notifications/counts').set(authed(session))).body.unread).toBe(0);
    // Idempotent: reading again changes nothing and still answers ok.
    expect((await request(app).post('/v1/notifications/read-all').set(authed(session))).body.updated).toBe(0);

    // Another user's row is not mine to read.
    const other = await signUpAndRegister();
    await request(app).post(`/v1/notifications/${first.body.data[1].id}/read`).set(authed(other));
    expect((await NotificationModel.findById(first.body.data[1].id).lean())?.read).toBe(true); // read-all above did it, not the other user
  });
});

describe('coin expiry reminders (RULES E10)', () => {
  it('warns at each threshold once per idle stretch, and says so on the day of the sweep', async () => {
    const session = await signUpAndRegister();
    await credit({ userId: session.userId, source: 'workout', referenceType: 'workout', referenceId: 'w1', amount: 100, title: 'Push Day', localDay: DAY });
    const lastCredit = new Date('2026-06-01T10:00:00Z');
    await CoinBalanceModel.updateOne({ _id: session.userId }, { $set: { lastCreditAt: lastCredit } });
    const at = (daysIdle: number) => new Date(lastCredit.getTime() + daysIdle * DAYS + 60_000);

    // Day 76 idle = 14 left → warned. Same day again → repeated, not a second row.
    expect(await warnExpiringWallets(at(76))).toEqual({ warned: 1, repeated: 0 });
    expect(await warnExpiringWallets(at(76))).toEqual({ warned: 0, repeated: 1 });
    // Day 80: not a threshold → nothing.
    expect(await warnExpiringWallets(at(80))).toEqual({ warned: 0, repeated: 0 });
    // Day 87 = 3 left → the second warning.
    expect(await warnExpiringWallets(at(87))).toEqual({ warned: 1, repeated: 0 });

    const feed = await request(app).get('/v1/notifications').set(authed(session));
    expect(feed.body.data.map((n: { title: string }) => n.title)).toEqual(['Your coins expire in 3 days', 'Your coins expire in 14 days']);
    expect(feed.body.data[1].message).toContain('100 coins');
    expect(feed.body.data[1]).toMatchObject({ topic: 'coins', read: false });

    // Day 90: the sweep empties the wallet and says so.
    expect((await expireIdleWallets(at(90))).expired).toBe(1);
    const after = await request(app).get('/v1/notifications').set(authed(session));
    expect(after.body.data[0]).toMatchObject({ title: 'Your coins have expired', topic: 'coins' });
    expect(after.body.data[0].message).toContain('100 coins lapsed after 90 days');
    expect(after.body.data).toHaveLength(3);
  });

  it('earning in between resets the stretch, so the warnings start over from the new credit', async () => {
    const session = await signUpAndRegister();
    await credit({ userId: session.userId, source: 'workout', referenceType: 'workout', referenceId: 'w1', amount: 100, title: 'Push Day', localDay: DAY });
    const first = new Date('2026-06-01T10:00:00Z');
    await CoinBalanceModel.updateOne({ _id: session.userId }, { $set: { lastCreditAt: first } });
    expect((await warnExpiringWallets(new Date(first.getTime() + 76 * DAYS + 60_000))).warned).toBe(1);

    // A fresh credit: the old window is gone, and its warnings with it.
    const second = new Date('2026-09-01T10:00:00Z');
    await CoinBalanceModel.updateOne({ _id: session.userId }, { $set: { lastCreditAt: second } });
    expect((await warnExpiringWallets(new Date(second.getTime() + 10 * DAYS))).warned).toBe(0);
    expect(await warnExpiringWallets(new Date(second.getTime() + 76 * DAYS + 60_000))).toEqual({ warned: 1, repeated: 0 });
    expect(await NotificationModel.countDocuments({ userId: session.userId })).toBe(2);
  });
});
