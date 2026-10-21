import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { addDays, localDayOf } from '../src/lib/dates.js';
import { ActivityDailyModel, DeviceDayModel } from '../src/modules/activity/models.js';
import { app, signUpAndRegister, type Session } from './helpers.js';

/**
 * One day minute by minute, and which phone each minute was taken from
 * (D-53). The rule is the scoring's; this is about being able to see it —
 * the read an operator needs when a member's phone says 11,000 and their
 * day says 8,000.
 */

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };
const ZONE = 'Asia/Kolkata';
const today = () => localDayOf(new Date(), ZONE);
const at = (day: string, time: string) => Date.parse(`${day}T${time}:00+05:30`);
/** `[epoch minute, timed, untimed]`, as a device-day stores them. */
const minutes = (day: string, time: string, count: number, perMinute: number): [number, number, number][] =>
  Array.from({ length: count }, (_, i) => [Math.floor(at(day, time) / 60_000) + i, perMinute, 0]);

/**
 * A whole day's evidence as `summarise` would have left it, from nothing but
 * its minutes. Full rather than minimal because rejecting a phone re-scores
 * the day, and the scoring reads every one of these fields — a fixture with
 * only `minuteSteps` in it answered the read and then failed the write.
 */
function evidenceFor(localDay: string, minuteSteps: [number, number, number][]) {
  const steps = minuteSteps.reduce((sum, [, timed, untimed]) => sum + timed + untimed, 0);
  const timed = minuteSteps.reduce((sum, [, t]) => sum + t, 0);
  const hourly = Array.from({ length: 24 }, () => 0);
  for (const [minute, t, u] of minuteSteps) {
    hourly[Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' }).format(
        new Date(minute * 60_000),
      ),
    ) % 24] += t + u;
  }
  return {
    libraryVersion: '2.7.1',
    sensor: 'step_counter',
    timezone: ZONE,
    utcOffsetMinutes: 330,
    signedAt: at(localDay, '23:00'),
    wallClockMs: at(localDay, '23:00'),
    deviceSteps: steps,
    recoveredSteps: 0,
    suspectSteps: 0,
    coverageStartAt: 0,
    resolved: { steps, usedExternal: false, packageName: null, kind: 'self', manualStepsExcluded: 0, distanceSource: 'derived' },
    sourcesStatus: 'read',
    sources: [],
    minutes: {
      status: 'enabled' as const,
      count: minuteSteps.length,
      timedSteps: timed,
      untimedSteps: steps - timed,
      chargingSteps: 0,
      vehicleSteps: 0,
      activeMinutes: minuteSteps.length,
      nightSteps: 0,
      peakMinuteSteps: Math.max(0, ...minuteSteps.map(([, t, u]) => t + u)),
    },
    hourly,
    minuteSteps,
    motion: { status: 'enabled' as const, windows: minuteSteps.length, stepWindows: minuteSteps.length, walk: minuteSteps.length, shake: 0, still: 0, other: 0 },
    checks: { enabled: true, mode: 'flag', strong: [], weak: [], clockJumps: 0, configChanges: 0, resets: 0 },
    hints: { emulator: false, testKeysBuild: false, suBinary: false, adbEnabled: false, developerOptions: false, appDebuggable: false },
    health: { recoveryCount: 0, aggressiveOem: false, batteryOptimizationEnabled: false },
    records: { status: 'read', count: 0, truncated: false },
    device: { manufacturer: 'Google', model: 'Pixel 8', sdkInt: 34 },
  };
}

/**
 * A device-day written straight in. The timeline reads stored evidence, so
 * putting two phones' minutes there is the whole fixture — no attestation,
 * no signing, and the overlap is exactly the one being asked about.
 */
async function deviceDay(
  session: Session,
  deviceId: string,
  localDay: string,
  minuteSteps: [number, number, number][],
  sources: Record<string, unknown>[] = [],
) {
  await DeviceDayModel.create({
    _id: `${deviceId}:${localDay}`,
    userId: session.userId,
    deviceId,
    localDay,
    uploadId: `upl-${deviceId}`,
    signedAt: new Date(),
    evidence: { ...evidenceFor(localDay, minuteSteps), sources },
    proof: { key: { attested: true, failure: null, verifiedBootState: 'verified', deviceLocked: true } },
  });
}

/** A Health Connect source as a device-day keeps it, with its own hours. */
function watchSource(options: { steps: number; hour: number; packageName?: string; appName?: string }) {
  const hourlySteps = Array.from({ length: 24 }, (_, hour) => (hour === options.hour ? options.steps : 0));
  return {
    packageName: options.packageName ?? 'com.sec.android.app.shealth',
    appName: options.appName ?? 'Samsung Health',
    kind: 'watch',
    steps: options.steps,
    distance: 0,
    manualSteps: 0,
    unknownMethodSteps: 0,
    isWearable: true,
    trustedWearable: true,
    isPlatform: false,
    distanceSource: null,
    hourlySteps,
  };
}

/**
 * The day's verdict as the rollup leaves it: which phone it took, and which
 * Health Connect source answered on that phone.
 */
async function scoredBy(
  session: Session,
  deviceId: string,
  localDay: string,
  options: {
    steps: number;
    phoneSteps: number;
    winner?: Record<string, unknown>;
    /** Sources the day saw and did not believe — shown, never paid (A14). */
    refused?: Record<string, unknown>[];
  },
) {
  await ActivityDailyModel.updateOne(
    { _id: `${session.userId}:${localDay}` },
    {
      $setOnInsert: { _id: `${session.userId}:${localDay}`, userId: session.userId, localDay },
      $set: {
        steps: options.steps,
        verifiedSteps: options.steps,
        verified: true,
        source: options.winner ? 'health_connect' : 'device',
        scoredAt: new Date(),
        breakdown: {
          bestDeviceId: deviceId,
          union: { phones: options.phoneSteps, verified: options.phoneSteps, added: false },
          devices: [{
            deviceId,
            phone: { counted: options.phoneSteps, recovered: 0, flagged: 0, clean: options.phoneSteps },
            candidate: options.steps,
            source: options.winner ? 'health_connect' : 'device',
            winner: options.winner?.packageName ?? null,
            shown: { steps: options.steps, packageName: options.winner?.packageName ?? null },
            verified: true,
            verifiedSteps: options.steps,
            displaySteps: options.steps,
            plausibility: 90,
            layers: {},
            hard: [],
            sources: [
              ...(options.winner
                ? [{ ...options.winner, countable: options.winner.steps, ratioToPhone: null, standing: 'allowed', status: 'used' }]
                : []),
              ...(options.refused ?? []).map(source => ({
                ...source,
                countable: source.steps,
                ratioToPhone: null,
                standing: 'unknown',
                status: 'unverified',
              })),
            ],
            sourcesStatus: 'read',
            signedAt: Date.now(),
            proof: { key: null, play: null },
          }],
        },
      },
    },
    { upsert: true },
  );
}

describe('one member’s day, minute by minute (D-53)', () => {
  it('says which phone each minute was taken from, and what the others lost', async () => {
    const day = addDays(today(), -1);
    const session = await signUpAndRegister();
    // Phone A walks 09:00–09:09 at 100/min, phone B the same ten minutes at
    // 80/min — one walk, two phones in the pocket — and then B alone walks
    // 18:00–18:04 at 50/min while A sits at home.
    await deviceDay(session, 'dev_a', day, minutes(day, '09:00', 10, 100));
    await deviceDay(session, 'dev_b', day, [...minutes(day, '09:00', 10, 80), ...minutes(day, '18:00', 5, 50)]);

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}`).set(ADMIN);
    expect(res.status).toBe(200);

    // The shared walk counts once at the higher figure, and the evening walk
    // adds on top: 1,000 + 250.
    expect(res.body.totals.steps).toBe(1250);
    // B's eighty a minute for ten minutes is what A's hundred displaced.
    expect(res.body.totals.rejectedSteps).toBe(800);
    expect(res.body.totals.minutes).toBe(15);
    expect(res.body.totals.overlapMinutes).toBe(10);

    const morning = res.body.rows.find((row: { parts: { hour: number } }) => row.parts.hour === 9);
    expect(morning.pickedDeviceId).toBe('dev_a');
    expect(morning.overlap).toBe(true);
    expect(morning.steps).toBe(100);
    expect(morning.rejectedSteps).toBe(80);

    const evening = res.body.rows.find((row: { parts: { hour: number } }) => row.parts.hour === 18);
    expect(evening.pickedDeviceId).toBe('dev_b');
    expect(evening.overlap).toBe(false);
    expect(evening.rejectedSteps).toBe(0);

    // Per phone: what it counted, what the day took, what it lost.
    const a = res.body.devices.find((d: { deviceId: string }) => d.deviceId === 'dev_a');
    const b = res.body.devices.find((d: { deviceId: string }) => d.deviceId === 'dev_b');
    expect(a).toMatchObject({ deviceSteps: 1000, countedSteps: 1000, rejectedSteps: 0, minutesKept: true });
    expect(b).toMatchObject({ deviceSteps: 1050, countedSteps: 250, rejectedSteps: 800 });
  });

  it('carries the wall clock of the member’s own zone on every row', async () => {
    const day = addDays(today(), -1);
    const session = await signUpAndRegister();
    await deviceDay(session, 'dev_a', day, minutes(day, '14:32', 1, 60));

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}`).set(ADMIN);
    const [row] = res.body.rows;

    expect(res.body.timezone).toBe(ZONE);
    expect(row.at).toBe(`${day}T14:32:00+05:30`);
    expect(row.parts).toMatchObject({
      year: Number(day.slice(0, 4)),
      month: Number(day.slice(5, 7)),
      day: Number(day.slice(8, 10)),
      hour: 14,
      minute: 32,
      second: 0,
    });
    expect(typeof row.parts.weekday).toBe('string');
    expect(row.epochMs).toBe(at(day, '14:32'));
  });

  it('can be asked for the overlapping minutes alone', async () => {
    const day = addDays(today(), -1);
    const session = await signUpAndRegister();
    await deviceDay(session, 'dev_a', day, [...minutes(day, '09:00', 3, 100), ...minutes(day, '11:00', 4, 70)]);
    await deviceDay(session, 'dev_b', day, minutes(day, '09:00', 3, 60));

    const all = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}`).set(ADMIN);
    expect(all.body.rows).toHaveLength(7);

    const overlaps = await request(app)
      .get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}&overlapsOnly=true`)
      .set(ADMIN);
    expect(overlaps.body.rows).toHaveLength(3);
    expect(overlaps.body.rows.every((row: { overlap: boolean }) => row.overlap)).toBe(true);
    // The totals stay the day's, not the filtered view's.
    expect(overlaps.body.totals.steps).toBe(580);
  });

  it('says so rather than answering zero when a phone kept no minutes', async () => {
    const day = addDays(today(), -1);
    const session = await signUpAndRegister();
    await DeviceDayModel.create({
      _id: `dev_old:${day}`,
      userId: session.userId,
      deviceId: 'dev_old',
      localDay: day,
      uploadId: 'upl-old',
      signedAt: new Date(),
      evidence: { deviceSteps: 4000, minutes: { status: 'disabled' } },
      proof: {},
    });

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}`).set(ADMIN);

    expect(res.body.withoutMinutes).toEqual(['dev_old']);
    expect(res.body.rows).toEqual([]);
    expect(res.body.devices[0]).toMatchObject({ deviceId: 'dev_old', deviceSteps: 4000, minutesKept: false });
  });

  /**
   * A real day is a few hundred minute rows and nobody reads a few hundred
   * rows. A run is the stretch: contiguous minutes that agree on the phone
   * they went to and on whether anybody else was claiming them.
   */
  it('folds the minutes into stretches of walking, and will not join across a gap', async () => {
    const day = addDays(today(), -1);
    const session = await signUpAndRegister();
    // Ten minutes both phones saw, a gap, then five only B walked.
    await deviceDay(session, 'dev_a', day, minutes(day, '09:00', 10, 100));
    await deviceDay(session, 'dev_b', day, [...minutes(day, '09:00', 10, 80), ...minutes(day, '18:00', 5, 50)]);

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}`).set(ADMIN);
    const runs = res.body.runs as {
      from: string; to: string; minutes: number; steps: number; rejectedSteps: number;
      pickedDeviceId: string; overlap: boolean; deviceIds: string[];
    }[];

    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      from: `${day}T09:00:00+05:30`,
      to: `${day}T09:09:00+05:30`,
      minutes: 10,
      steps: 1000,
      rejectedSteps: 800,
      pickedDeviceId: 'dev_a',
      overlap: true,
    });
    expect(runs[0].deviceIds.sort()).toEqual(['dev_a', 'dev_b']);
    // The nine-hour gap is a second run, not a longer first one.
    expect(runs[1]).toMatchObject({ minutes: 5, steps: 250, pickedDeviceId: 'dev_b', overlap: false });
  });

  it('breaks a run where the phone it is taken from changes', async () => {
    const day = addDays(today(), -1);
    const session = await signUpAndRegister();
    // Back to back, but B out-counts A for the middle three minutes.
    await deviceDay(session, 'dev_a', day, minutes(day, '09:00', 9, 100));
    await deviceDay(session, 'dev_b', day, minutes(day, '09:03', 3, 400));

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}`).set(ADMIN);
    const runs = res.body.runs as { minutes: number; pickedDeviceId: string }[];

    expect(runs.map(run => [run.pickedDeviceId, run.minutes])).toEqual([
      ['dev_a', 3],
      ['dev_b', 3],
      ['dev_a', 3],
    ]);
  });

  /**
   * The per-minute pick settles a walk two phones both saw. A phone that was
   * in somebody else's pocket is not that case, and an operator has to say
   * so (D-88).
   */
  describe('an operator picking which phone a day counts (D-88)', () => {
    const reject = (session: Session, day: string, body: Record<string, unknown>) =>
      request(app)
        .put(`/v1/admin/users/${session.userId}/days/${day}/devices/rejected`)
        .set(ADMIN)
        .send(body);

    it('takes the rejected phone out of the day and re-scores it without them', async () => {
      const day = addDays(today(), -1);
      const session = await signUpAndRegister();
      await deviceDay(session, 'dev_a', day, minutes(day, '09:00', 10, 100));
      await deviceDay(session, 'dev_b', day, minutes(day, '18:00', 5, 50));

      const res = await reject(session, day, { reject: ['dev_b'], note: 'Lent to a friend' });
      expect(res.status).toBe(200);
      expect(res.body.devices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ deviceId: 'dev_a', rejected: false }),
          expect.objectContaining({ deviceId: 'dev_b', rejected: true, note: 'Lent to a friend' }),
        ]),
      );

      // Its minutes are gone from the timeline, and it is named with the reason.
      const after = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}`).set(ADMIN);
      expect(after.body.totals.steps).toBe(1000);
      expect(after.body.totals.rejectedDevices).toBe(1);
      expect(after.body.rows.every((row: { pickedDeviceId: string }) => row.pickedDeviceId === 'dev_a')).toBe(true);
      const b = after.body.devices.find((d: { deviceId: string }) => d.deviceId === 'dev_b');
      expect(b).toMatchObject({ rejected: true, rejectedNote: 'Lent to a friend', rejectedBy: expect.any(String) });
    });

    it('is never one-way: the same call without the id gives the day back', async () => {
      const day = addDays(today(), -1);
      const session = await signUpAndRegister();
      await deviceDay(session, 'dev_a', day, minutes(day, '09:00', 10, 100));
      await deviceDay(session, 'dev_b', day, minutes(day, '18:00', 5, 50));

      await reject(session, day, { reject: ['dev_b'] });
      const lifted = await reject(session, day, { reject: [] });

      expect(lifted.status).toBe(200);
      expect(lifted.body.devices.every((d: { rejected: boolean }) => !d.rejected)).toBe(true);
      const after = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}`).set(ADMIN);
      expect(after.body.totals.steps).toBe(1250);
      expect(after.body.totals.rejectedDevices).toBe(0);
    });

    it('will not let the last phone of a day be taken away', async () => {
      const day = addDays(today(), -1);
      const session = await signUpAndRegister();
      await deviceDay(session, 'dev_a', day, minutes(day, '09:00', 10, 100));
      await deviceDay(session, 'dev_b', day, minutes(day, '18:00', 5, 50));

      const both = await reject(session, day, { reject: ['dev_a', 'dev_b'] });
      expect(both.status).toBe(422);
      expect(both.body.error.code).toBe('LAST_DEVICE_ON_DAY');

      // And nothing was written on the way to being refused.
      const after = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}`).set(ADMIN);
      expect(after.body.totals.rejectedDevices).toBe(0);
    });

    it('refuses a phone that never sent the day, and a day nobody sent', async () => {
      const day = addDays(today(), -1);
      const session = await signUpAndRegister();
      await deviceDay(session, 'dev_a', day, minutes(day, '09:00', 10, 100));

      const wrong = await reject(session, day, { reject: ['dev_nope'] });
      expect(wrong.status).toBe(422);
      expect(wrong.body.error.code).toBe('DEVICE_NOT_ON_DAY');

      const empty = await reject(session, addDays(today(), -5), { reject: [] });
      expect(empty.status).toBe(404);
    });
  });

  it('is an admin read, and refuses an unknown member', async () => {
    const session = await signUpAndRegister();
    const unauthorised = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${today()}`);
    expect(unauthorised.status).toBe(401);

    const missing = await request(app).get(`/v1/admin/users/usr_nobody/steps/timeline?date=${today()}`).set(ADMIN);
    expect(missing.status).toBe(404);
  });
});

describe('the same day, source by source (D-51)', () => {
  it('names the source the day was taken from, and gives each source its own hours', async () => {
    const day = addDays(today(), -1);
    const session = await signUpAndRegister();
    // The phone counted 600 in the morning; the watch wrote 2,000 in the
    // evening and the scoring took the watch.
    const watch = watchSource({ steps: 2000, hour: 19 });
    await deviceDay(session, 'dev_a', day, minutes(day, '09:00', 6, 100), [watch]);
    await scoredBy(session, 'dev_a', day, { steps: 2000, phoneSteps: 600, winner: watch });

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}`).set(ADMIN);
    expect(res.status).toBe(200);

    expect(res.body.scored).toMatchObject({ steps: 2000, source: 'health_connect', phonesAdded: false });
    expect(res.body.scored.answeredBy).toMatchObject({ appName: 'Samsung Health', answered: true, steps: 2000 });

    // The answering source first; the phone's counter is a source too, and
    // its hours are the minutes the timeline itself decided.
    expect(res.body.sources.map((source: { key: string }) => source.key)).toEqual([
      'com.sec.android.app.shealth',
      'phone',
    ]);
    const phone = res.body.sources.find((source: { key: string }) => source.key === 'phone');
    expect(phone).toMatchObject({ appName: 'Phone step counter', steps: 600, answered: false });
    expect(phone.hourly[9]).toBe(600);
    expect(res.body.sources[0].hourly[19]).toBe(2000);

    // Hour by hour, the two sources stay apart: the walk the phone timed at
    // nine, the watch's own evening, and nothing invented in between.
    const nine = res.body.sourceHours[9];
    expect(nine).toMatchObject({ steps: 600 });
    expect(nine.bySource).toEqual([{ key: 'phone', appName: 'Phone step counter', answered: false, steps: 600 }]);
    expect(res.body.sourceHours[19].bySource).toEqual([
      { key: 'com.sec.android.app.shealth', appName: 'Samsung Health', answered: true, steps: 2000 },
    ]);
    expect(res.body.sourceHours[3].bySource).toEqual([]);

    // And per phone: which source answered on it, and every app it saw.
    const device = res.body.devices[0];
    expect(device).toMatchObject({ source: 'health_connect', winnerApp: 'com.sec.android.app.shealth', sourcesStatus: 'read' });
    expect(device.sources[0]).toMatchObject({ appName: 'Samsung Health', steps: 2000, status: 'used' });
  });

  it('carries a source whose tracker computed no hours rather than placing it at midnight', async () => {
    const day = addDays(today(), -1);
    const session = await signUpAndRegister();
    const booster = {
      ...watchSource({ steps: 3000, hour: 0, packageName: 'com.fake.steps', appName: 'Step Booster' }),
      hourlySteps: null,
    };
    await deviceDay(session, 'dev_a', day, minutes(day, '09:00', 6, 100), [booster]);
    await scoredBy(session, 'dev_a', day, { steps: 600, phoneSteps: 600, refused: [booster] });

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}`).set(ADMIN);
    // The phone answered for the day; the app wrote 3,000 and was placed nowhere.
    expect(res.body.sources.find((source: { key: string }) => source.key === 'phone')).toMatchObject({
      answered: true,
      hourly: expect.any(Array),
    });
    const refused = res.body.sources.find((source: { key: string }) => source.key === 'com.fake.steps');
    expect(refused).toMatchObject({ appName: 'Step Booster', steps: 3000, hourly: null });
    // `null` hours are not zero hours: it is in no hour of the day at all.
    expect(res.body.sourceHours.flatMap((hour: { bySource: { key: string }[] }) => hour.bySource.map(s => s.key)))
      .not.toContain('com.fake.steps');
  });

  it('answers a day nothing has scored with the phones’ own minutes', async () => {
    const day = addDays(today(), -1);
    const session = await signUpAndRegister();
    await deviceDay(session, 'dev_a', day, minutes(day, '07:00', 4, 250));

    const res = await request(app).get(`/v1/admin/users/${session.userId}/steps/timeline?date=${day}`).set(ADMIN);
    expect(res.body.scored).toBeNull();
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0]).toMatchObject({ key: 'phone', steps: 1000, answered: true });
    expect(res.body.sourceHours[7].bySource[0]).toMatchObject({ key: 'phone', steps: 1000 });
  });
});
