import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ActivityDailyModel } from '../src/modules/activity/models.js';
import { WishlistModel } from '../src/modules/commerce/models.js';
import { checkWishlistGoals, listOf, sweepWishlistGoals } from '../src/modules/commerce/wishlistGoals.service.js';
import { AppReleaseModel, DeviceModel } from '../src/modules/devices/models.js';
import { credit } from '../src/modules/economy/service.js';
import { NotificationPreferencesModel, UserModel } from '../src/modules/identity/models.js';
import { renderTemplate } from '../src/modules/notifications/automations.catalog.js';
import { NotificationAutomationModel, NotificationCampaignModel } from '../src/modules/notifications/automations.models.js';
import { campaignDueOn, pickTemplate, runAutomations } from '../src/modules/notifications/automations.service.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { invalidateConfig } from '../src/config/remote.js';
import { addDays } from '../src/lib/dates.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Today (UTC calendar) at `hour`:`minute` on an Indian clock, and its local date. */
function istAt(hour: number, minute = 5, dayOffset = 0): { now: Date; day: string } {
  const date = addDays(new Date().toISOString().slice(0, 10), dayOffset);
  const now = new Date(Date.parse(`${date}T00:00:00Z`) + hour * 3_600_000 + minute * 60_000 - IST_OFFSET_MS);
  return { now, day: date };
}

/** The most recent Monday at `hour` on an Indian clock, on or before today. */
function mondayAt(hour: number): { now: Date; day: string } {
  for (let back = 0; back < 7; back += 1) {
    const candidate = istAt(hour, 5, -back);
    if (new Date(`${candidate.day}T00:00:00Z`).getUTCDay() === 1) return candidate;
  }
  throw new Error('unreachable');
}

async function member(name = 'Asha Verma'): Promise<Session> {
  const session = await signUpAndRegister();
  await UserModel.updateOne({ _id: session.userId }, { $set: { name, timezone: 'Asia/Kolkata' } });
  return session;
}

const rowsOf = (userId: string, origin?: string) =>
  NotificationModel.find({ userId, ...(origin ? { origin } : { origin: { $type: 'string' } }) }).sort({ createdAt: 1 }).lean();

/** Only one automation switched on, so a test reads its own messages and nothing else. */
async function only(key: string, overrides: Record<string, unknown> = {}) {
  const keys = ['morning_motivation', 'afternoon_check', 'goal_reached', 'weekly_summary', 'win_back', 'app_update', 'health_tip', 'wishlist_goal'];
  for (const other of keys) {
    await NotificationAutomationModel.updateOne({ _id: other }, { $set: { enabled: other === key, ...(other === key ? overrides : {}) } }, { upsert: true });
  }
}

/** A day as the rollup leaves it, touched at `touchedAt` (the goal check reads only fresh ones). */
async function day(userId: string, localDay: string, steps: number, touchedAt = new Date()) {
  await ActivityDailyModel.updateOne(
    { _id: `${userId}:${localDay}` },
    { $set: { userId, localDay, steps, verifiedSteps: steps, verified: true, updatedAt: touchedAt } },
    { upsert: true, timestamps: false },
  );
}

describe('the words (RULES M11)', () => {
  it('fills names, groups numbers, and leaves out a bracket whose value is empty or zero', () => {
    expect(renderTemplate('Good morning[, {firstName}] ☀️', { firstName: 'Asha' })).toBe('Good morning, Asha ☀️');
    expect(renderTemplate('Good morning[, {firstName}] ☀️', { firstName: '' })).toBe('Good morning ☀️');
    expect(renderTemplate('{steps} of {goal}', { steps: 4500, goal: 10_000 })).toBe('4,500 of 10,000');
    expect(renderTemplate('It has been {days} days.[ Your {coins} coins are waiting.] Open VOKVE.', { days: 3, coins: 0 }))
      .toBe('It has been 3 days. Open VOKVE.');
  });

  it('rotates a member through the lines, a day at a time, and members start in different places', () => {
    const lines = ['a', 'b', 'c'].map(id => ({ id, slot: 'default', title: id, message: id, active: true }));
    const today = pickTemplate(lines, 'default', 'usr_1', '2026-11-23')!.id;
    const tomorrow = pickTemplate(lines, 'default', 'usr_1', '2026-11-24')!.id;
    expect(tomorrow).not.toBe(today);
    const starts = new Set(['usr_1', 'usr_2', 'usr_3', 'usr_4', 'usr_5', 'usr_6'].map(id => pickTemplate(lines, 'default', id, '2026-11-23')!.id));
    expect(starts.size).toBeGreaterThan(1);
    expect(pickTemplate(lines.map(line => ({ ...line, active: false })), 'default', 'usr_1', '2026-11-23')).toBeNull();
  });
});

describe('the automations, at the member’s own hour (RULES M11)', () => {
  it('says good morning at 8 on their clock, once, and not at 9', async () => {
    const asha = await member();
    await only('morning_motivation');

    await runAutomations(istAt(9).now);
    expect(await rowsOf(asha.userId)).toHaveLength(0);

    const { now } = istAt(8);
    await runAutomations(now);
    await runAutomations(now);
    const rows = await rowsOf(asha.userId, 'auto:morning_motivation');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ topic: 'steps' });
    expect(`${rows[0].title} ${rows[0].message}`).not.toMatch(/[{}[\]]/);

    // And the feed hands it to the app.
    const feed = await request(app).get('/v1/notifications').set(authed(asha));
    expect(feed.body.data.find((row: { id: string }) => row.id === rows[0]._id)).toMatchObject({ topic: 'steps', link: null });
  });

  it('leaves out a member who switched motivation off — no push and no row — and one whose phone has gone quiet', async () => {
    const off = await member('Ravi');
    const away = await member('Meera');
    await only('morning_motivation');
    const put = await request(app).put('/v1/me/notification-preferences').set(authed(off)).send({ categories: { motivation: false } });
    expect(put.status).toBe(200);
    expect(put.body.categories.motivation).toBe(false);
    await DeviceModel.updateMany({ userId: away.userId }, { $set: { lastSeenAt: new Date(Date.now() - 40 * 86_400_000) } });

    await runAutomations(istAt(8).now);
    expect(await rowsOf(off.userId)).toHaveLength(0);
    expect(await rowsOf(away.userId)).toHaveLength(0);
  });

  it('checks in at 4 only on a member under half their goal, and never on one with nothing synced', async () => {
    const behind = await member();
    const ahead = await member();
    const silent = await member();
    await only('afternoon_check');
    const { now, day: today } = istAt(16);
    await day(behind.userId, today, 3_100);
    await day(ahead.userId, today, 6_200);

    await runAutomations(now);
    const [row] = await rowsOf(behind.userId, 'auto:afternoon_check');
    expect(`${row.title} ${row.message}`).toMatch(/6,900|31%|3,100/);
    expect(await rowsOf(ahead.userId)).toHaveLength(0);
    expect(await rowsOf(silent.userId)).toHaveLength(0);
  });

  it('celebrates today’s goal within the hour, once, and opens the steps screen', async () => {
    const asha = await member();
    await only('goal_reached');
    const { now, day: today } = istAt(15);
    await day(asha.userId, today, 10_250, new Date(now.getTime() - 10 * 60_000));
    await runAutomations(now);
    await runAutomations(new Date(now.getTime() + 3_600_000));
    const rows = await rowsOf(asha.userId, 'auto:goal_reached');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ link: 'steps' });
    expect(rows[0].message).toContain('10,000');
  });

  it('sums up last week on Monday morning, and says nothing to a member who did not walk', async () => {
    const walker = await member();
    const still = await member();
    await only('weekly_summary');
    const { now, day: monday } = mondayAt(9);
    await day(walker.userId, addDays(monday, -7), 12_000);
    await day(walker.userId, addDays(monday, -3), 4_000);
    await runAutomations(now);
    const [row] = await rowsOf(walker.userId, 'auto:weekly_summary');
    expect(row.message).toContain('16,000 steps');
    expect(row.message).toContain('1 of 7 goal days');
    expect(row.message).toContain('Monday with 12,000 steps');
    expect(await rowsOf(still.userId)).toHaveLength(0);
  });

  it('wins back a member on exactly the third day of silence, once', async () => {
    const asha = await member();
    await only('win_back');
    const { now } = istAt(18);
    await DeviceModel.updateMany({ userId: asha.userId }, { $set: { lastSeenAt: new Date(now.getTime() - 3.2 * 86_400_000) } });
    await runAutomations(now);
    await runAutomations(now);
    const rows = await rowsOf(asha.userId, 'auto:win_back');
    expect(rows).toHaveLength(1);
    // Keyed to the absence and its stage, whichever line it rotated to.
    expect(rows[0].dedupeKey).toMatch(/^auto:win_back:\d{4}-\d{2}-\d{2}:3$/);

    await DeviceModel.updateMany({ userId: asha.userId }, { $set: { lastSeenAt: new Date(now.getTime() - 5.2 * 86_400_000) } });
    await runAutomations(now);
    expect(await rowsOf(asha.userId, 'auto:win_back')).toHaveLength(1);
  });

  it('tells a member on an old build about the new one, once per release, and opens the update', async () => {
    const asha = await member();
    await only('app_update');
    await DeviceModel.updateMany({ userId: asha.userId }, { $set: { platform: 'android', 'app.version': '1.0.0' } });
    await AppReleaseModel.create({ platform: 'android', version: '1.4.0', build: '40', status: 'current', notes: 'Wishlist goals on Home.' });
    const { now } = istAt(12);
    await runAutomations(now);
    await runAutomations(new Date(now.getTime() + 86_400_000));
    const rows = await rowsOf(asha.userId, 'auto:app_update');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ link: 'update', topic: 'system' });
    expect(rows[0].message).toContain('1.4.0');
    expect(rows[0].message).toContain('Wishlist goals on Home.');
  });

  it('holds a member to the day’s cap, but never their own news', async () => {
    const asha = await member();
    await AppConfigModel.updateOne({ _id: 'automations' }, { $set: { value: { maxPerDay: 1 } } }, { upsert: true });
    invalidateConfig();
    await only('morning_motivation');
    await NotificationAutomationModel.updateOne({ _id: 'goal_reached' }, { $set: { enabled: true } });
    await NotificationCampaignModel.create({
      _id: 'cmp_cap', name: 'Also at 8', category: 'motivation', title: 'Also', message: 'At eight', schedule: { kind: 'daily', hour: 8 },
    });
    const { now, day: today } = istAt(8);
    await day(asha.userId, today, 10_500, new Date(now.getTime() - 10 * 60_000));

    await runAutomations(now);
    const origins = (await rowsOf(asha.userId)).map(row => row.origin).sort();
    // The goal is news and is not counted; of the two daily ones, only the
    // first to run fits a cap of one.
    expect(origins).toEqual(['auto:goal_reached', 'auto:morning_motivation']);
  });

  it('stops everything with the master switch', async () => {
    const asha = await member();
    await only('morning_motivation');
    await AppConfigModel.updateOne({ _id: 'automations' }, { $set: { value: { enabled: false } } }, { upsert: true });
    invalidateConfig();
    const run = await runAutomations(istAt(8).now);
    expect(run.enabled).toBe(false);
    expect(await rowsOf(asha.userId)).toHaveLength(0);
  });
});

describe('scheduled messages (RULES M11)', () => {
  it('knows when one is due on a member’s clock', () => {
    const clock = { zone: 'Asia/Kolkata', hour: 10, day: '2026-11-23', weekday: 0 };
    expect(campaignDueOn({ schedule: { kind: 'daily', hour: 10 } }, clock)).toBe(true);
    expect(campaignDueOn({ schedule: { kind: 'daily', hour: 11 } }, clock)).toBe(false);
    expect(campaignDueOn({ schedule: { kind: 'once', date: '2026-11-23', hour: 10 } }, clock)).toBe(true);
    expect(campaignDueOn({ schedule: { kind: 'once', date: '2026-11-24', hour: 10 } }, clock)).toBe(false);
    expect(campaignDueOn({ schedule: { kind: 'weekly', weekdays: [0, 2], hour: 10 } }, clock)).toBe(true);
    expect(campaignDueOn({ schedule: { kind: 'weekly', weekdays: [1], hour: 10 } }, clock)).toBe(false);
    expect(campaignDueOn({ schedule: { kind: 'daily', hour: 10 }, endsOn: '2026-11-22' }, clock)).toBe(false);
  });

  it('is written in the panel, refused with a name it cannot fill, and sent at the member’s hour once a day', async () => {
    const asha = await member();
    await only('none');
    const bad = await request(app).post('/v1/admin/campaigns').set(ADMIN).send({
      name: 'Diwali offer', category: 'offer', title: 'Hi {fristName}', message: 'Double coins this week.',
      schedule: { kind: 'daily', hour: 10 },
    });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain('fristName');

    const made = await request(app).post('/v1/admin/campaigns').set(ADMIN).send({
      name: 'Diwali offer', category: 'offer', title: 'Happy Diwali[, {firstName}] 🪔', message: 'Every reward in the shop is 10% off this week.',
      link: 'shop', schedule: { kind: 'daily', hour: 10 },
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ state: 'scheduled', link: 'shop' });

    const { now } = istAt(10);
    await runAutomations(now);
    await runAutomations(now);
    const rows = await rowsOf(asha.userId, `campaign:${made.body.id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Happy Diwali, Asha 🪔', topic: 'reward', link: 'shop' });

    // An offer asks the offers switch.
    await NotificationPreferencesModel.updateOne({ _id: asha.userId }, { $set: { 'categories.offers': false } }, { upsert: true });
    await runAutomations(new Date(now.getTime() + 86_400_000));
    expect(await rowsOf(asha.userId, `campaign:${made.body.id}`)).toHaveLength(1);

    const listed = await request(app).get('/v1/admin/automations').set(ADMIN);
    expect(listed.body.campaigns[0]).toMatchObject({ id: made.body.id, last30Days: { sent: 1 } });

    const gone = await request(app).delete(`/v1/admin/campaigns/${made.body.id}`).set(ADMIN).send({});
    expect(gone.status).toBe(200);
    expect(await NotificationCampaignModel.countDocuments()).toBe(0);
  });
});

describe('the panel (RULES M11)', () => {
  it('lists every automation with its words and figures, and refuses words it cannot fill', async () => {
    const listed = await request(app).get('/v1/admin/automations').set(ADMIN);
    expect(listed.status).toBe(200);
    expect(listed.body.settings).toMatchObject({ enabled: true, maxPerDay: 3, activeWithinDays: 30 });
    expect(listed.body.automations.map((row: { key: string }) => row.key)).toContain('wishlist_goal');

    const unknown = await request(app).put('/v1/admin/automations/morning_motivation').set(ADMIN).send({
      templates: [{ id: 'm1', title: 'Hi {name}', message: 'Go' }],
    });
    expect(unknown.status).toBe(422);
    const unpaired = await request(app).put('/v1/admin/automations/morning_motivation').set(ADMIN).send({
      templates: [{ id: 'm1', title: 'Hi[, {firstName}', message: 'Go' }],
    });
    expect(unpaired.status).toBe(422);
    const silent = await request(app).put('/v1/admin/automations/morning_motivation').set(ADMIN).send({
      templates: [{ id: 'm1', title: 'Hi', message: 'Go', active: false }],
    });
    expect(silent.status).toBe(422);
    expect(JSON.stringify(silent.body)).toContain('live line');

    const saved = await request(app).put('/v1/admin/automations/morning_motivation').set(ADMIN).send({
      hour: 7, weekdays: [0, 1, 2, 3, 4], templates: [{ id: 'm1', title: 'Uth jao[, {firstName}]!', message: 'Aaj ka goal {goal} steps.' }],
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ hour: 7, weekdays: [0, 1, 2, 3, 4], customised: true });

    const asha = await member();
    const preview = await request(app).post('/v1/admin/automations/morning_motivation/preview').set(ADMIN).send({ userId: asha.userId });
    expect(preview.body).toMatchObject({ title: 'Uth jao, Asha!', message: 'Aaj ka goal 10,000 steps.', sent: null });
    const sent = await request(app).post('/v1/admin/automations/morning_motivation/preview').set(ADMIN).send({ userId: asha.userId, send: true });
    expect(sent.body.sent).toMatchObject({ status: 'created' });
    // A test is not an automated message: no origin, so it neither counts nor uses up the cap.
    expect(await NotificationModel.countDocuments({ userId: asha.userId, origin: null, dedupeKey: /^test:morning_motivation:/ })).toBe(1);

    const reset = await request(app).delete('/v1/admin/automations/morning_motivation').set(ADMIN);
    expect(reset.body).toMatchObject({ hour: 8, customised: false });

    const settings = await request(app).put('/v1/admin/automations/settings').set(ADMIN).send({ maxPerDay: 11 });
    expect(settings.status).toBe(422);
    const ok = await request(app).put('/v1/admin/automations/settings').set(ADMIN).send({ maxPerDay: 2 });
    expect(ok.body).toMatchObject({ maxPerDay: 2 });
  });

  it('reports the motivation switch as on for members who never touched it, and names who sends on it', async () => {
    const asha = await member();
    await NotificationPreferencesModel.updateOne({ _id: asha.userId }, { $unset: { 'categories.motivation': '' } }, { upsert: true });
    const consent = await request(app).get('/v1/admin/notifications/consent').set(ADMIN);
    const motivation = consent.body.switches.find((row: { key: string }) => row.key === 'motivation');
    expect(motivation).toMatchObject({ defaultOn: true, off: 0 });
    expect(motivation.on).toBeGreaterThan(0);
    expect(motivation.automations).toContain('morning_motivation');
    const mine = await request(app).get('/v1/me/notification-preferences').set(authed(asha));
    expect(mine.body.categories.motivation).toBe(true);
  });
});

describe('a saved reward now affordable (RULES M12)', () => {
  async function saver(coins: number) {
    const session = await member();
    if (coins > 0) {
      await credit({ userId: session.userId, source: 'refund', referenceType: 'test', referenceId: 'fund', amount: coins, title: 'Test funds', localDay: '2026-09-14', exemptFromCap: true });
    }
    return session;
  }
  const save = (session: Session, itemId: string) => request(app).put(`/v1/wishlist/${itemId}`).set(authed(session));
  const top = (session: Session, amount: number, ref: string) =>
    credit({ userId: session.userId, source: 'refund', referenceType: 'test', referenceId: ref, amount, title: 'Top up', localDay: '2026-09-14', exemptFromCap: true });
  const told = (session: Session) => rowsOf(session.userId, 'auto:wishlist_goal');

  it('tells the member the moment a credit reaches a saved item’s goal, once, and opens the product', async () => {
    // Wrist wraps: 1,396 coins and 196 to ship.
    const asha = await saver(1_000);
    expect((await save(asha, 'wrist-wraps')).status).toBe(200);
    await top(asha, 400, 'a');
    expect(await told(asha)).toHaveLength(0);
    await top(asha, 200, 'b');
    const rows = await told(asha);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'You can redeem Wrist Wraps now 🎉', topic: 'reward', link: 'product:wrist-wraps' });
    expect(rows[0].message).toContain('1,600 coins');

    await top(asha, 50, 'c');
    expect(await told(asha)).toHaveLength(1);
  });

  it('says nothing about something saved already affordable, or an item whose coins are only a discount', async () => {
    const asha = await saver(5_000);
    await save(asha, 'wrist-wraps');
    await save(asha, 'cap');
    await top(asha, 10, 'a');
    expect(await told(asha)).toHaveLength(0);
  });

  it('tells about several at once in one message', async () => {
    const asha = await saver(100);
    await save(asha, 'socks');
    await save(asha, 'jump-rope');
    await save(asha, 'wrist-wraps');
    await top(asha, 2_000, 'a');
    const rows = await told(asha);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: '3 rewards are ready for you 🎉', link: 'wishlist' });
    expect(listOf(['A', 'B', 'C', 'D'])).toBe('A, B and 2 more');
  });

  it('re-arms once the wallet drops below, and tells again only after the cooldown', async () => {
    const asha = await saver(1_000);
    await save(asha, 'wrist-wraps');
    await top(asha, 700, 'a');
    expect(await told(asha)).toHaveLength(1);

    // Spent down (as if on an order), then the sweep re-arms it.
    await UserModel.db.collection('coin_balances').updateOne({ _id: asha.userId as never }, { $set: { balanceMc: 500_000 } });
    await sweepWishlistGoals();
    expect((await WishlistModel.findById(`${asha.userId}:wrist-wraps`).lean())?.goalArmed).toBe(true);

    await top(asha, 1_200, 'b');
    expect(await told(asha)).toHaveLength(1); // inside the cooldown
    await WishlistModel.updateOne({ _id: `${asha.userId}:wrist-wraps` }, { $set: { goalArmed: true, goalAlertedAt: new Date(Date.now() - 8 * 86_400_000) } });
    await checkWishlistGoals(asha.userId);
    expect(await told(asha)).toHaveLength(2);
  });

  it('switched off, it disarms without a word, so switching it on later tells nobody about old news', async () => {
    const asha = await saver(1_000);
    await save(asha, 'wrist-wraps');
    await NotificationAutomationModel.updateOne({ _id: 'wishlist_goal' }, { $set: { enabled: false } }, { upsert: true });
    await top(asha, 700, 'a');
    expect(await told(asha)).toHaveLength(0);
    expect((await WishlistModel.findById(`${asha.userId}:wrist-wraps`).lean())?.goalArmed).toBe(false);
    await NotificationAutomationModel.deleteOne({ _id: 'wishlist_goal' });
    await sweepWishlistGoals();
    expect(await told(asha)).toHaveLength(0);
  });

  it('a row saved before the alert existed is set on the first check, not announced', async () => {
    const asha = await saver(5_000);
    await WishlistModel.create({ _id: `${asha.userId}:wrist-wraps`, userId: asha.userId, itemId: 'wrist-wraps', addedAt: new Date() });
    await WishlistModel.updateOne({ _id: `${asha.userId}:wrist-wraps` }, { $unset: { goalArmed: '' } });
    await checkWishlistGoals(asha.userId);
    expect(await told(asha)).toHaveLength(0);
    expect((await WishlistModel.findById(`${asha.userId}:wrist-wraps`).lean())?.goalArmed).toBe(false);
  });
});
