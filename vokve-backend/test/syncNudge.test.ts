import { afterEach, describe, expect, it } from 'vitest';
import { invalidateConfig } from '../src/config/remote.js';
import { setPushTransport, type PushMessage } from '../src/lib/push.js';
import { nudgeStaleSyncs } from '../src/modules/activity/nudge.job.js';
import { DeviceModel } from '../src/modules/devices/models.js';
import { UserModel } from '../src/modules/identity/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { signUpAndRegister, type Session } from './helpers.js';

const HOURS = 3_600_000;
const DAYS = 86_400_000;
/** Midday UTC, so the member's quiet hours never hold the visible reminder. */
const NOON = new Date('2026-09-14T12:00:00Z');

function capturingTransport() {
  const sent: { tokens: string[]; message: PushMessage }[] = [];
  setPushTransport({
    async send(tokens, message) {
      sent.push({ tokens, message });
      // A `dead-` token is one the provider will not take, and does not
      // count as sent — which is how FCM answers for a retired token.
      const dead = tokens.filter(t => t.startsWith('dead-'));
      return { sent: tokens.length - dead.length, invalid: dead };
    },
  });
  return sent;
}

/** A signed-in install that can be pushed, last heard from `hoursAgo` ago. */
async function counting(session: Session, token: string, hoursAgo: number | null) {
  await UserModel.updateOne({ _id: session.userId }, { $set: { timezone: 'UTC' } });
  await DeviceModel.updateOne(
    { _id: session.deviceId },
    {
      $set: {
        'push.token': token,
        'push.invalidAt': null,
        firstSeenAt: new Date(NOON.getTime() - 2 * DAYS),
        stepSync: { uploadedAt: hoursAgo === null ? null : new Date(NOON.getTime() - hoursAgo * HOURS), nudgedAt: null, remindedAt: null },
      },
    },
  );
}

afterEach(() => setPushTransport(null));

describe('the upload floor: installs that count but do not report (RULES A28)', () => {
  it('sends one silent data push per stale install, and then holds off for the cooldown', async () => {
    const session = await signUpAndRegister();
    await counting(session, 'tok-1', 30);
    const sent = capturingTransport();

    expect(await nudgeStaleSyncs(NOON)).toMatchObject({ pushed: 1, reminded: 0 });
    // Data only: no title and no body, or Android would draw it itself and
    // the app's background handler would never see it.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ tokens: ['tok-1'], message: { silent: true, data: { type: 'activity_sync' } } });
    expect(sent[0].message.title).toBeUndefined();

    const device = await DeviceModel.findById(session.deviceId, { stepSync: 1 }).lean();
    expect(device?.stepSync?.nudgedAt?.getTime()).toBe(NOON.getTime());

    // An hourly tick is not an hourly push.
    expect(await nudgeStaleSyncs(new Date(NOON.getTime() + HOURS))).toMatchObject({ pushed: 0 });
    expect(sent).toHaveLength(1);

    // Past the cooldown, it asks again.
    expect(await nudgeStaleSyncs(new Date(NOON.getTime() + 9 * HOURS))).toMatchObject({ pushed: 1 });
    expect(sent).toHaveLength(2);
  });

  it('leaves alone an install that has reported, one that has signed out, and one with no token', async () => {
    const fresh = await signUpAndRegister();
    await counting(fresh, 'tok-fresh', 2);

    const signedOut = await signUpAndRegister();
    await counting(signedOut, 'tok-out', 40);
    await DeviceModel.updateOne(
      { _id: signedOut.deviceId },
      { $set: { 'counting.0.to': new Date(NOON.getTime() - 20 * HOURS) } },
    );

    const noToken = await signUpAndRegister();
    await counting(noToken, 'tok-none', 40);
    await DeviceModel.updateOne({ _id: noToken.deviceId }, { $unset: { 'push.token': '' } });

    const sent = capturingTransport();
    expect(await nudgeStaleSyncs(NOON)).toMatchObject({ pushed: 0, reminded: 0 });
    expect(sent).toHaveLength(0);
  });

  it('after two days of silence the member is told too — once, however many phones are quiet', async () => {
    const first = await signUpAndRegister();
    await counting(first, 'tok-a', 100);
    // A second install of the same account, just as quiet.
    const second = await signUpAndRegister();
    await DeviceModel.updateOne({ _id: second.deviceId }, { $set: { userId: first.userId } });
    await DeviceModel.updateOne(
      { _id: second.deviceId },
      {
        $set: {
          'push.token': 'tok-b',
          'push.invalidAt': null,
          firstSeenAt: new Date(NOON.getTime() - 5 * DAYS),
          stepSync: { uploadedAt: new Date(NOON.getTime() - 100 * HOURS), nudgedAt: null, remindedAt: null },
        },
      },
    );

    const sent = capturingTransport();
    const result = await nudgeStaleSyncs(NOON);

    // Each install is asked — each has its own days to send — but the
    // message is about the account, so it goes once.
    expect(result).toMatchObject({ pushed: 2, reminded: 1 });
    const silent = sent.filter(s => s.message.silent);
    expect(silent.map(s => s.tokens[0]).sort()).toEqual(['tok-a', 'tok-b']);

    // The reminder itself is an ordinary push, one message to both phones.
    const spoken = sent.filter(s => !s.message.silent);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].tokens.sort()).toEqual(['tok-a', 'tok-b']);
    expect(spoken[0].message.title).toBe('Your steps are not reaching us');

    const rows = await NotificationModel.find({ userId: first.userId, topic: 'steps' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toContain('4 days');

    // And not again tomorrow-but-one: the reminder is daily at most.
    await DeviceModel.updateMany({ userId: first.userId }, { $set: { 'stepSync.nudgedAt': null } });
    expect(await nudgeStaleSyncs(new Date(NOON.getTime() + 12 * HOURS))).toMatchObject({ reminded: 0 });
  });

  it('gives up on an install that has been silent longer than the job chases', async () => {
    const session = await signUpAndRegister();
    await counting(session, 'tok-gone', 40 * 24);
    const sent = capturingTransport();

    expect(await nudgeStaleSyncs(NOON)).toMatchObject({ pushed: 0 });
    expect(sent).toHaveLength(0);
  });

  it('switched off, it does nothing at all', async () => {
    const session = await signUpAndRegister();
    await counting(session, 'tok-off', 40);
    await AppConfigModel.updateOne({ _id: 'activity' }, { $set: { value: { syncNudge: { enabled: false } } } }, { upsert: true });
    invalidateConfig();

    const sent = capturingTransport();
    expect(await nudgeStaleSyncs(NOON)).toMatchObject({ pushed: 0, reminded: 0 });
    expect(sent).toHaveLength(0);
  });

  it('does nothing on a server with no push provider wired, and spends no cooldown doing it', async () => {
    const session = await signUpAndRegister();
    await counting(session, 'tok-nowhere', 30);
    setPushTransport(null);

    expect(await nudgeStaleSyncs(NOON)).toMatchObject({ pushed: 0, failed: 0 });
    const device = await DeviceModel.findById(session.deviceId, { stepSync: 1 }).lean();
    expect(device?.stepSync?.nudgedAt ?? null).toBeNull();
  });

  it('retires a token the provider says is dead, rather than pushing it every cooldown', async () => {
    const session = await signUpAndRegister();
    await counting(session, 'dead-tok', 30);
    const sent = capturingTransport();

    expect(await nudgeStaleSyncs(NOON)).toMatchObject({ pushed: 0, failed: 1 });
    expect(sent).toHaveLength(1);
    const device = await DeviceModel.findById(session.deviceId, { push: 1 }).lean();
    expect(device?.push?.invalidAt).toBeTruthy();
  });
});
