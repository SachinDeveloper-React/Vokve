import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { localDayOf } from '../src/lib/dates.js';
import { HydrationEntryModel } from '../src/modules/hydration/models.js';
import { UserSettingsModel } from '../src/modules/identity/models.js';
import { getHydrationDay, getHydrationHistory } from '../src/modules/hydration/service.js';
import { app, authed, signUpAndRegister, type Session } from './helpers.js';

/**
 * Keeping a day's water believable (RULES Y1b), and reading past days back
 * (RULES Y4).
 *
 * The thing being defended is not tidiness. Every figure the app shows about
 * water — the average, the goal-hit rate, the best run — is built on this
 * log, so one day of 15 L poisons a month of them; and drinking far past
 * what kidneys can clear is a real harm, not a data problem. So the ceiling
 * is the server's, the rate note is the server's, and both are checked here
 * rather than trusted to a client that is not the only way in.
 */

const ZONE = 'Asia/Kolkata';
const today = () => localDayOf(new Date(), ZONE);

function drink(session: Session, body: Record<string, unknown>, key = String(body.id)) {
  return request(app)
    .post('/v1/hydration/entries')
    .set({ ...authed(session), 'idempotency-key': `drink-${key}` })
    .send(body);
}

/** Puts water on a past day directly, bypassing the log's own rules. */
async function past(session: Session, day: string, ml: number, n = 1) {
  await HydrationEntryModel.create({
    _id: `${session.userId}:${day}-${n}`,
    userId: session.userId,
    clientId: `${day}-${n}`,
    ml,
    at: new Date(`${day}T06:00:00Z`),
    localDay: day,
  });
}

describe('hydration: a day has a ceiling (RULES Y1b)', () => {
  it('takes a big but believable day, and refuses the one past the ceiling', async () => {
    const session = await signUpAndRegister();

    // 10 L is the ceiling: three litres at a time, and the fourth is refused.
    for (const n of [1, 2, 3]) {
      expect((await drink(session, { id: `big-${n}`, ml: 3_000 })).status).toBe(200);
    }
    const ninth = await drink(session, { id: 'big-4', ml: 900 });
    expect(ninth.status).toBe(200);
    expect(ninth.body.consumedMl).toBe(9_900);

    const over = await drink(session, { id: 'over', ml: 500 });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('HYDRATION_DAILY_LIMIT');
    // The refusal says what is left, so the app can say something true
    // rather than "invalid".
    expect(over.body.error.details).toMatchObject({ maxDailyMl: 10_000, remainingMl: 100 });
    expect(over.body.error.message).toContain('100 ml');
  });

  it('refuses the drink without logging any of it', async () => {
    const session = await signUpAndRegister();
    await drink(session, { id: 'a', ml: 3_000 });
    await drink(session, { id: 'b', ml: 3_000 });
    await drink(session, { id: 'c', ml: 3_000 });
    await drink(session, { id: 'd', ml: 1_000 });

    expect((await drink(session, { id: 'e', ml: 2_000 })).status).toBe(422);

    // Not partially applied: the day the drinks landed on is exactly what it
    // was. Read by that day rather than by "today", which a run crossing
    // local midnight would move out from under the assertion.
    const landed = (await drink(session, { id: 'd', ml: 1_000 }, 'd-again')).body.date;
    const day = await getHydrationDay(session.userId, landed);
    expect(day.consumedMl).toBe(10_000);
    expect(day.entries).toHaveLength(4);
  });

  it('a retry of a drink that already landed is not refused for its own litres', async () => {
    const session = await signUpAndRegister();
    await drink(session, { id: 'a', ml: 3_000 });
    await drink(session, { id: 'b', ml: 3_000 });
    await drink(session, { id: 'c', ml: 3_000 });
    const last = await drink(session, { id: 'd', ml: 1_000 });
    expect(last.body.consumedMl).toBe(10_000);

    // The same glass again, under a new request key: the day is already at
    // the ceiling, and counting this drink twice would refuse its own retry.
    const again = await drink(session, { id: 'd', ml: 1_000 }, 'd-retry');
    expect(again.status).toBe(200);
    expect(again.body.consumedMl).toBe(10_000);
  });

  it('the ceiling is above the largest goal a member may set', async () => {
    const session = await signUpAndRegister();
    await UserSettingsModel.updateOne(
      { _id: session.userId },
      { $set: { dailyWaterGoalMl: 8_000 } },
      { upsert: true },
    );

    // Somebody who set an 8 L goal has to be able to reach it.
    for (const n of [1, 2]) {
      expect((await drink(session, { id: `g-${n}`, ml: 3_000 })).status).toBe(200);
    }
    const third = await drink(session, { id: 'g-3', ml: 2_000 });
    expect(third.status).toBe(200);
    expect(third.body.consumedMl).toBe(8_000);
    expect(third.body.consumedMl).toBeGreaterThanOrEqual(third.body.goalMl);
  });
});

describe('hydration: the health note (RULES Y1b)', () => {
  /**
   * Read through the service with the instant fixed, rather than through
   * HTTP with the real clock.
   *
   * The notes are about "the last hour", so a test that said "a minute ago"
   * would be asking the wall clock two different questions as it ran — and
   * a run that crossed local midnight would put the drinks on one day and
   * read the answer from the next, which is exactly how this first failed.
   * The day and the instant are given here, so the only thing that can move
   * is the code.
   */
  const DAY = '2026-09-10';
  /** Noon on that day in the member's zone. */
  const NOON = new Date('2026-09-10T06:30:00Z');

  /** A drink `minutesBefore` noon, written straight to the log. */
  const at = async (session: Session, ml: number, minutesBefore: number) => {
    const when = new Date(NOON.getTime() - minutesBefore * 60_000);
    await HydrationEntryModel.create({
      _id: `${session.userId}:${ml}-${minutesBefore}`,
      userId: session.userId,
      clientId: `${ml}-${minutesBefore}`,
      ml,
      at: when,
      localDay: DAY,
    });
  };

  it('says nothing about an ordinary day', async () => {
    const session = await signUpAndRegister();
    await at(session, 250, 240);
    await at(session, 500, 180);

    expect((await getHydrationDay(session.userId, DAY, NOON)).caution).toBeNull();
  });

  it('warns about the rate, which is the part with medicine behind it', async () => {
    const session = await signUpAndRegister();
    // Two litres inside the hour: past the 1.5 L the guard allows, and well
    // past the litre healthy kidneys clear.
    await at(session, 1_000, 40);
    await at(session, 1_000, 5);

    const day = await getHydrationDay(session.userId, DAY, NOON);
    expect(day.caution).toMatchObject({ kind: 'rate' });
    expect(day.caution?.message).toContain('2.0 L');
  });

  it('says nothing about an ordinary gym hour, which is why the guard is at 1.5 L', async () => {
    const session = await signUpAndRegister();
    // Two 750 ml glasses back to back: a normal workout, and the commonest
    // thing the quick-add row produces. A warning here would be noise.
    await at(session, 750, 25);
    await at(session, 750, 5);

    expect((await getHydrationDay(session.userId, DAY, NOON)).caution).toBeNull();
  });

  it('stops warning about the rate once the hour has passed', async () => {
    const session = await signUpAndRegister();
    await at(session, 1_000, 200);
    await at(session, 1_000, 180);

    // Still two litres, but hours ago: a note now would be about nothing.
    expect((await getHydrationDay(session.userId, DAY, NOON)).caution).toBeNull();
  });

  it('warns about a very high day, spread out though it is', async () => {
    const session = await signUpAndRegister();
    // 6.5 L over the day, none of it fast.
    for (let n = 0; n < 13; n += 1) {
      await at(session, 500, 90 + n * 30);
    }

    const day = await getHydrationDay(session.userId, DAY, NOON);
    expect(day.caution).toMatchObject({ kind: 'high' });
    expect(day.caution?.message).toContain('6.5 L');
  });

  it('prefers the rate note over the total, so one fact is given at a time', async () => {
    const session = await signUpAndRegister();
    // A high day, and the last of it drunk fast.
    for (let n = 0; n < 11; n += 1) {
      await at(session, 500, 90 + n * 30);
    }
    await at(session, 2_000, 5);

    // A member drinking too fast should be told that, not about the total.
    const day = await getHydrationDay(session.userId, DAY, NOON);
    expect(day.caution?.kind).toBe('rate');
  });
});

describe('hydration: the history (RULES Y4)', () => {
  it('lists every day newest first, and a day nobody logged is not a day of zero', async () => {
    const session = await signUpAndRegister();
    const day = today();
    await past(session, '2026-09-10', 2_600);
    await past(session, '2026-09-12', 1_000);

    const history = await request(app)
      .get('/v1/hydration/history')
      .query({ from: '2026-09-10', to: '2026-09-12' })
      .set(authed(session));

    expect(history.status).toBe(200);
    expect(history.body.days.map((d: { date: string }) => d.date)).toEqual([
      '2026-09-12', '2026-09-11', '2026-09-10',
    ]);
    // The 11th: present, zero, and marked as having no drinks at all.
    expect(history.body.days[1]).toMatchObject({ consumedMl: 0, entries: 0, goalMet: false });
    expect(history.body.days[2]).toMatchObject({ consumedMl: 2_600, entries: 1, goalMet: true });
    expect(day).toEqual(expect.any(String));
  });

  it('averages over the days that had water, not over the span', async () => {
    const session = await signUpAndRegister();
    await past(session, '2026-09-10', 3_000);
    await past(session, '2026-09-12', 1_000);

    const history = await request(app)
      .get('/v1/hydration/history')
      .query({ from: '2026-09-10', to: '2026-09-16' })
      .set(authed(session));

    // Two days logged out of seven: the average is 2,000, not 571. A week
    // with two entries must not look like a week of drinking nothing.
    expect(history.body.summary).toMatchObject({
      dailyAverageMl: 2_000,
      totalMl: 4_000,
      daysLogged: 2,
      daysInRange: 7,
      goalHitRatePercent: 50,
      bestDay: { date: '2026-09-10', consumedMl: 3_000 },
    });
  });

  it('counts the longest run at the goal inside the span', async () => {
    const session = await signUpAndRegister();
    for (const day of ['2026-09-10', '2026-09-11', '2026-09-12']) {
      await past(session, day, 2_600);
    }
    // A gap, then a shorter run.
    await past(session, '2026-09-14', 2_600);

    const history = await request(app)
      .get('/v1/hydration/history')
      .query({ from: '2026-09-10', to: '2026-09-14' })
      .set(authed(session));

    expect(history.body.summary.bestStreakDays).toBe(3);
  });

  it('answers an empty span without pretending it has figures', async () => {
    const session = await signUpAndRegister();

    const history = await getHydrationHistory(session.userId, '2026-09-10', '2026-09-16');

    expect(history.summary).toMatchObject({
      dailyAverageMl: 0,
      daysLogged: 0,
      goalHitRatePercent: 0,
      bestStreakDays: 0,
      bestDay: null,
    });
    expect(history.days).toHaveLength(7);
  });

  it('refuses a backwards or oversized span', async () => {
    const session = await signUpAndRegister();
    const ask = (from: string, to: string) =>
      request(app).get('/v1/hydration/history').query({ from, to }).set(authed(session));

    expect((await ask('2026-09-12', '2026-09-10')).status).toBe(422);
    expect((await ask('2024-01-01', '2026-09-10')).status).toBe(422);
  });

  it('opens one past day on its own drinks', async () => {
    const session = await signUpAndRegister();
    await past(session, '2026-09-10', 600, 1);
    await past(session, '2026-09-10', 400, 2);

    const day = await request(app)
      .get('/v1/hydration/day')
      .query({ date: '2026-09-10' })
      .set(authed(session));

    expect(day.status).toBe(200);
    expect(day.body).toMatchObject({ date: '2026-09-10', consumedMl: 1_000 });
    expect(day.body.entries).toHaveLength(2);
  });

  it('a day of another member’s is not found in this one’s history', async () => {
    const session = await signUpAndRegister();
    const other = await signUpAndRegister();
    await past(other, '2026-09-10', 2_000);

    const day = await request(app)
      .get('/v1/hydration/day')
      .query({ date: '2026-09-10' })
      .set(authed(session));

    expect(day.body.consumedMl).toBe(0);
  });
});
