import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { DeviceModel } from '../src/modules/devices/models.js';
import { DeviceHealthModel } from '../src/modules/telemetry/models.js';
import { sweepFleetAlerts } from '../src/modules/telemetry/alerts.job.js';
import * as alerts from '../src/lib/alerts.js';
import { app, authed, signUpAndRegister } from './helpers.js';

/**
 * Knowing that the app is broken before a member says so (RULES P17).
 *
 * Two halves of one answer. The receipt is the phone saying a push landed,
 * which is the only thing that separates "nothing arrived, so only the
 * member can fix this" from "it arrived and we did nothing with it, so this
 * is our bug" — until it existed, support gave the same answer to both. The
 * sweep is the server reading the same signals across every install and
 * waking somebody, because the panel could always show a broken release and
 * never make anybody look at it.
 *
 * The thresholds are checked from both sides on purpose: an alarm that does
 * not fire is a week of lost steps, and an alarm that fires on four installs
 * is one people learn to ignore, which is the worse of the two.
 */

const ack = (session: Awaited<ReturnType<typeof signUpAndRegister>>, body: Record<string, unknown>) =>
  request(app).post('/v1/me/push-ack').set(authed(session)).send(body);

describe('a phone saying a push arrived', () => {
  it('records the receipt and times it against the send', async () => {
    const session = await signUpAndRegister();

    // The server pushed this install a minute ago. That stamp is the only
    // send it has timed, so it is what delivery is measured from — never a
    // `sentAt` the phone claims, because a phone whose clock is wrong is
    // exactly the phone this is trying to explain.
    const sentAt = new Date(Date.now() - 60_000);
    await DeviceModel.updateOne({ _id: session.deviceId }, { $set: { 'stepSync.nudgedAt': sentAt } });

    const response = await ack(session, {
      messageId: 'm-1',
      type: 'activity_sync',
      receivedAt: new Date().toISOString(),
      state: 'background',
      outcome: 'sent',
    });

    expect(response.status).toBe(202);
    expect(response.body.deliveryMs).toBeGreaterThanOrEqual(59_000);
    expect(response.body.deliveryMs).toBeLessThan(120_000);

    const device = await DeviceModel.findById(session.deviceId).lean();
    expect(device?.push?.lastAckType).toBe('activity_sync');
    expect(device?.push?.lastAckState).toBe('background');
    expect(device?.push?.lastAckAt).toBeTruthy();
  });

  it('does not time an ack against a push from another day', async () => {
    const session = await signUpAndRegister();
    await DeviceModel.updateOne(
      { _id: session.deviceId },
      { $set: { 'stepSync.nudgedAt': new Date(Date.now() - 36 * 3_600_000) } },
    );

    const response = await ack(session, {
      type: 'activity_sync',
      receivedAt: new Date().toISOString(),
      state: 'foreground',
    });

    // Yesterday's send is not what this receipt is for, and reporting a
    // day-long delivery would make the figure worthless.
    expect(response.status).toBe(202);
    expect(response.body.deliveryMs).toBeNull();
  });

  it('a token that answers is a token that works', async () => {
    const session = await signUpAndRegister();
    await DeviceModel.updateOne(
      { _id: session.deviceId },
      { $set: { 'push.invalidAt': new Date() } },
    );

    await ack(session, { receivedAt: new Date().toISOString(), state: 'foreground' });

    const device = await DeviceModel.findById(session.deviceId).lean();
    expect(device?.push?.invalidAt ?? null).toBeNull();
  });

  it('refuses a receipt that is not a receipt', async () => {
    const session = await signUpAndRegister();
    const response = await ack(session, { receivedAt: 'yesterday', state: 'nowhere' });
    expect(response.status).toBe(422);
  });
});

describe('the hourly read of whether the app works for everybody', () => {
  it('says nothing about a fleet too small to mean anything', async () => {
    const session = await signUpAndRegister();
    const raise = vi.spyOn(alerts, 'raiseAlert').mockResolvedValue(true);

    // One dead tracker out of one install is a hundred per cent, and means
    // nothing. An alarm that cries at noise is worse than no alarm.
    await DeviceHealthModel.create({
      _id: `${session.userId}:${session.deviceId}`,
      userId: session.userId,
      deviceId: session.deviceId,
      tracking: { looksDead: true },
      at: new Date(),
      receivedAt: new Date(),
    });

    const sweep = await sweepFleetAlerts();

    expect(raise).not.toHaveBeenCalled();
    expect(sweep.raised).toBe(0);
    expect(sweep.skipped).toBeGreaterThan(0);
    raise.mockRestore();
  });

  it('wakes somebody when step services are being killed across the fleet', async () => {
    const session = await signUpAndRegister();
    const raise = vi.spyOn(alerts, 'raiseAlert').mockResolvedValue(true);

    // Thirty installs reported; twenty say the counter should be running
    // and is not. That is what a member means by "my steps stopped".
    const now = new Date();
    await DeviceHealthModel.insertMany(
      Array.from({ length: 30 }, (_, index) => ({
        _id: `${session.userId}:dev-${index}`,
        userId: session.userId,
        deviceId: `dev-${index}`,
        tracking: { looksDead: index < 20 },
        at: now,
        receivedAt: now,
      })),
    );

    await sweepFleetAlerts();

    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'telemetry.dead_trackers', severity: 'critical' }),
    );
    raise.mockRestore();
  });

  it('notices a push channel that is accepted and never delivered', async () => {
    const session = await signUpAndRegister();
    const raise = vi.spyOn(alerts, 'raiseAlert').mockResolvedValue(true);

    // Forty installs were pushed in the last hour and none of them ever
    // said so. A certificate that has expired fails exactly this way —
    // every send accepted, nothing delivered — and nothing else notices.
    const nudgedAt = new Date(Date.now() - 3_600_000);
    await DeviceModel.insertMany(
      Array.from({ length: 40 }, (_, index) => ({
        _id: `pushed-${index}`,
        userId: session.userId,
        installId: `install-${index}`,
        platform: 'android',
        push: { token: `tok-${index}`, lastAckAt: null },
        stepSync: { nudgedAt },
      })),
    );

    await sweepFleetAlerts();

    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'telemetry.undelivered_push' }),
    );
    raise.mockRestore();
  });
});
