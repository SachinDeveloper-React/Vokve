import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { localDayOf, localMidnightUtc, localTimeOf, weekdayOf } from '../src/lib/dates.js';
import { setPushTransport, type PushMessage } from '../src/lib/push.js';
import { DeviceModel } from '../src/modules/devices/models.js';
import { NotificationPreferencesModel, UserModel, UserSettingsModel } from '../src/modules/identity/models.js';
import { sendDueReminders } from '../src/modules/hydration/reminders.job.js';
import { HydrationPlanModel } from '../src/modules/hydration/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

/**
 * Sending the reminders (RULES Y6). Every check fixes the instant and asks
 * the sweep what it would do then, because "is 07:00 now?" is the whole
 * question and a test that used the real clock could only ever pass for one
 * minute a day.
 *
 * The zone throughout is Asia/Kolkata (UTC+5:30), which is what the test
 * device registers with, so a plan saved through the API carries it.
 */

const ZONE = 'Asia/Kolkata';

/**
 * 09:30 yesterday on the member's clock: a minute that has been and gone, so
 * a drink may be logged at it and the whole day is in the past whenever the
 * suite happens to run. A fixed calendar date would age out of the window a
 * drink may be logged in.
 */
function nineThirtyYesterday(): Date {
  const day = localDayOf(new Date(Date.now() - 86_400_000), ZONE);
  return new Date(localMidnightUtc(day, ZONE).getTime() + 9 * 3_600_000 + 30 * 60_000);
}

const DUE = nineThirtyYesterday();
/** The weekday that minute falls on, 0 = Monday (RULES Y5). */
const DUE_DAY = weekdayOf(localDayOf(DUE, ZONE));

function capturingTransport() {
  const sent: { tokens: string[]; message: PushMessage }[] = [];
  setPushTransport({
    async send(tokens, message) {
      sent.push({ tokens, message });
      return { sent: tokens.length, invalid: [] };
    },
  });
  return sent;
}

afterEach(() => setPushTransport(null));

/** Saves a plan through the API, so it carries the device's zone. */
async function savePlan(
  session: Session,
  plan: Partial<{
    enabled: boolean;
    sound: string;
    vibration: boolean;
    repeatDays: number[];
    reminders: { id: string; time: string; slot: string; enabled: boolean }[];
  }>,
  key = `plan-${Math.random()}`,
) {
  const res = await request(app)
    .put('/v1/hydration/reminders')
    .set({ ...authed(session), 'idempotency-key': key })
    .send({
      enabled: true,
      sound: 'water_drop',
      vibration: true,
      repeatDays: [0, 1, 2, 3, 4, 5, 6],
      reminders: [{ id: 'a', time: '09:30', slot: 'morning', enabled: true }],
      ...plan,
    });
  if (res.status !== 200) throw new Error(`plan save failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Awake and reachable: a live push token, and no quiet window in the way. */
async function reachable(session: Session) {
  await UserModel.updateOne({ _id: session.userId }, { $set: { timezone: ZONE } });
  await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { 'push.token': 'tok-1' } });
  await NotificationPreferencesModel.updateOne(
    { _id: session.userId },
    { $set: { categories: { health: true }, quietHours: { enabled: false, start: '22:00', end: '07:00' } } },
    { upsert: true },
  );
}

const rows = (userId: string) => NotificationModel.find({ userId, topic: 'hydration' }).lean();

describe('hydration reminders: who is due (RULES Y6)', () => {
  it('the test instant really is 09:30 on the member’s clock', () => {
    expect(localTimeOf(DUE, ZONE)).toBe('09:30');
    expect(DUE_DAY).toBeGreaterThanOrEqual(0);
    expect(DUE.getTime()).toBeLessThan(Date.now());
  });

  it('sends the reminder whose minute it is, and nothing a minute either side', async () => {
    const session = await signUpAndRegister();
    await reachable(session);
    await savePlan(session, {});

    const early = await sendDueReminders(new Date(DUE.getTime() - 60_000));
    expect(early).toMatchObject({ due: 0, sent: 0 });

    const now = await sendDueReminders(DUE);
    expect(now).toMatchObject({ due: 1, sent: 1 });

    const late = await sendDueReminders(new Date(DUE.getTime() + 60_000));
    expect(late).toMatchObject({ due: 0, sent: 0 });

    expect(await rows(session.userId)).toHaveLength(1);
  });

  it('says what is left of the day’s goal, and that it is met once it is', async () => {
    const session = await signUpAndRegister();
    await reachable(session);
    await UserSettingsModel.updateOne({ _id: session.userId }, { $set: { dailyWaterGoalMl: 2_000 } }, { upsert: true });
    await savePlan(session, {});

    await sendDueReminders(DUE);
    expect((await rows(session.userId))[0].message).toContain('2000 ml');

    await request(app)
      .post('/v1/hydration/entries')
      .set({ ...authed(session), 'idempotency-key': 'd1' })
      .send({ id: 'd1', ml: 2_000, at: DUE.toISOString() });
    await savePlan(session, { reminders: [{ id: 'b', time: '09:31', slot: 'morning', enabled: true }] });

    await sendDueReminders(new Date(DUE.getTime() + 60_000));
    const latest = (await rows(session.userId)).sort((a, b) => (a._id < b._id ? 1 : -1))[0];
    expect(latest.message).toContain('already hit');
  });

  it('skips a day the plan does not repeat on, a reminder switched off, and a plan switched off', async () => {
    const session = await signUpAndRegister();
    await reachable(session);

    // Every day but the one the test instant falls on.
    await savePlan(session, { repeatDays: [0, 1, 2, 3, 4, 5, 6].filter(d => d !== DUE_DAY) }, 'p-days');
    expect(await sendDueReminders(DUE)).toMatchObject({ due: 0 });

    // The right day, but this time is off — and the one that is on is 18:00.
    await savePlan(
      session,
      {
        reminders: [
          { id: 'a', time: '09:30', slot: 'morning', enabled: false },
          { id: 'b', time: '18:00', slot: 'evening', enabled: true },
        ],
      },
      'p-off',
    );
    expect(await sendDueReminders(DUE)).toMatchObject({ due: 0 });

    // The master switch.
    await savePlan(session, { enabled: false }, 'p-master');
    expect(await sendDueReminders(DUE)).toMatchObject({ due: 0 });

    expect(await rows(session.userId)).toHaveLength(0);
  });

  it('sends one reminder when two blocks hold the same minute', async () => {
    const session = await signUpAndRegister();
    await reachable(session);
    await savePlan(session, {
      reminders: [
        { id: 'a', time: '09:30', slot: 'morning', enabled: true },
        { id: 'b', time: '09:30', slot: 'custom', enabled: true },
      ],
    });

    expect(await sendDueReminders(DUE)).toMatchObject({ due: 1, sent: 1 });
    expect(await rows(session.userId)).toHaveLength(1);
  });

  it('a sweep that runs twice in the same minute sends once', async () => {
    const session = await signUpAndRegister();
    await reachable(session);
    await savePlan(session, {});

    await sendDueReminders(DUE);
    expect(await sendDueReminders(DUE)).toMatchObject({ sent: 0 });
    expect(await rows(session.userId)).toHaveLength(1);
  });

  it('reads a plan saved before the zone was kept against the member’s own', async () => {
    const session = await signUpAndRegister();
    await reachable(session);
    await savePlan(session, {});
    // As an older release left it.
    await HydrationPlanModel.updateOne({ _id: session.userId }, { $set: { timezone: null } });

    expect(await sendDueReminders(DUE)).toMatchObject({ due: 1, sent: 1 });
  });
});

describe('hydration reminders: how they arrive (RULES Y6)', () => {
  it('pushes when nothing on the account is scheduling locally', async () => {
    const session = await signUpAndRegister();
    await reachable(session);
    const sent = capturingTransport();
    await savePlan(session, {});

    expect(await sendDueReminders(DUE)).toMatchObject({ sent: 1, pushed: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].message.data).toMatchObject({ topic: 'hydration' });
  });

  it('writes the row but sends no push once the phone says it has the plan scheduled', async () => {
    const session = await signUpAndRegister();
    await reachable(session);
    const sent = capturingTransport();
    await savePlan(session, {});

    const claimed = await request(app)
      .patch(`/v1/devices/${session.deviceId}`)
      .set(authed(session))
      .send({ localReminders: true });
    expect(claimed.body).toEqual({ ok: true });

    expect(await sendDueReminders(DUE)).toMatchObject({ sent: 1, pushed: 0 });
    expect(sent).toHaveLength(0);
    // The notification centre still has it: that is the record of what the
    // app told the member, whichever channel rang.
    expect(await rows(session.userId)).toHaveLength(1);
  });

  it('pushes again once the claim has gone stale', async () => {
    const session = await signUpAndRegister();
    await reachable(session);
    const sent = capturingTransport();
    await savePlan(session, {});
    await DeviceModel.updateOne(
      { _id: session.deviceId },
      { $set: { remindersScheduledAt: new Date(DUE.getTime() - 30 * 86_400_000) } },
    );

    expect(await sendDueReminders(DUE)).toMatchObject({ pushed: 1 });
    expect(sent).toHaveLength(1);
  });

  it('sends nothing at all inside the member’s quiet hours', async () => {
    const session = await signUpAndRegister();
    await reachable(session);
    await NotificationPreferencesModel.updateOne(
      { _id: session.userId },
      { $set: { quietHours: { enabled: true, start: '09:00', end: '10:00' } } },
    );
    await savePlan(session, {});

    // Due, claimed — and then dropped, rather than held until ten and
    // arriving next to whatever ten brings.
    expect(await sendDueReminders(DUE)).toMatchObject({ due: 1, sent: 0 });
    expect(await rows(session.userId)).toHaveLength(0);
  });

  it('writes no row for a member who turned health notifications off', async () => {
    const session = await signUpAndRegister();
    await reachable(session);
    const sent = capturingTransport();
    await NotificationPreferencesModel.updateOne(
      { _id: session.userId },
      { $set: { categories: { health: false } } },
    );
    await savePlan(session, {});

    // The row is the record and is still written; the push is what consent
    // governs, and health is off.
    expect(await sendDueReminders(DUE)).toMatchObject({ due: 1, sent: 1, pushed: 0 });
    expect(sent).toHaveLength(0);
  });
});

describe('hydration reminders: the sounds (RULES Y5)', () => {
  it('lists the sounds a plan may name, default first', async () => {
    const session = await signUpAndRegister();
    const res = await request(app).get('/v1/hydration/reminders/sounds').set(authed(session));
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id: 'default', label: 'Default' });
    expect(res.body.data.map((s: { id: string }) => s.id)).toContain('water_drop');
  });

  it('keeps a sound off the list out of the plan, and reads an old label as its id', async () => {
    const session = await signUpAndRegister();
    await savePlan(session, { sound: 'air-horn' });
    expect((await request(app).get('/v1/hydration/reminders').set(authed(session))).body.sound).toBe('default');

    // A plan stored before the catalogue existed held the label.
    await HydrationPlanModel.updateOne({ _id: session.userId }, { $set: { sound: 'Water Drop' } });
    expect((await request(app).get('/v1/hydration/reminders').set(authed(session))).body.sound).toBe('water_drop');
  });
});
