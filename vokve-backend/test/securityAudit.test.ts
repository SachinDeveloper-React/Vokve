import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { localDayOf } from '../src/lib/dates.js';
import { hashToken } from '../src/lib/tokens.js';
import { DeviceModel } from '../src/modules/devices/models.js';
import { revokeDevice } from '../src/modules/devices/service.js';
import { setFacebookVerifier } from '../src/lib/facebookIdentity.js';
import { setFirebasePhoneVerifier, setFirebaseUserForgetter } from '../src/lib/firebasePhone.js';
import { setGoogleVerifier } from '../src/lib/googleIdentity.js';
import { RefreshTokenModel, UserModel } from '../src/modules/identity/models.js';
import { AuditLogModel } from '../src/modules/platform/models.js';
import { CoinLedgerModel } from '../src/modules/economy/models.js';
import { refreshLeaderboardScore } from '../src/modules/leaderboard/service.js';
import { LeaderboardScoreModel } from '../src/modules/leaderboard/models.js';
import { StreakDayModel } from '../src/modules/streak/models.js';
import { WorkoutModel } from '../src/modules/training/models.js';
import { app, authed, baseHeaders, signUpAndRegister, type Session } from './helpers.js';

/**
 * The hacker audit of 2026-11-27 (security-reports/, git-ignored): each
 * block reproduces one finding's proof of concept and shows it closed.
 */

const ZONE = 'Asia/Kolkata';
const HOUR = 3_600_000;

function workout(id: string, startedAt: Date, minutes = 20) {
  return {
    id, title: 'Push Day', startedAt: startedAt.toISOString(), completedAt: new Date(startedAt.getTime() + minutes * 60_000).toISOString(),
    exercises: [{ id: 'we-1', exercise: { id: 'bench', name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell', isTimed: false, imageUrl: null },
      sets: [{ id: 's1', reps: 8, weightKg: 60, rpe: null, durationSeconds: null, completed: true }], restSeconds: 90, notes: null }],
    totalVolumeKg: 0, caloriesBurned: 0,
  };
}

const save = (session: Session, body: unknown) => request(app).post('/v1/workouts').set(authed(session)).send(body as object);
const reward = (res: request.Response) => JSON.parse(res.headers['x-vokve-reward'] ?? 'null');
const balance = async (session: Session) => (await request(app).get('/v1/wallet').set(authed(session))).body.balance as number;

describe('C-1: a workout dated on a day the member chose', () => {
  it('pays nothing for a workout from last month or next year — each used to land on a fresh daily cap', async () => {
    const session = await signUpAndRegister();
    const dates = [-30, -60, -365, 30, 365].map(days => new Date(Date.now() + days * 24 * HOUR));
    for (const [i, at] of dates.entries()) {
      const res = await save(session, workout(`old-${i}`, at));
      expect(res.status).toBe(200); // saved, as W4 says implausible ones are
      expect(reward(res)).toBeNull();
    }
    expect(await balance(session)).toBe(0);
    const rows = await WorkoutModel.find({ userId: session.userId }).lean();
    expect(rows).toHaveLength(5);
    expect(rows.every(row => row.plausible === false)).toBe(true);
    expect(await CoinLedgerModel.countDocuments({ userId: session.userId })).toBe(0);
    // Nor do they earn a streak day.
    expect(await StreakDayModel.countDocuments({ userId: session.userId })).toBe(0);
  });

  it('still pays a session finished an hour ago, and one synced the next day', async () => {
    const session = await signUpAndRegister();
    const today = await save(session, workout('today', new Date(Date.now() - HOUR)));
    expect(reward(today)).toMatchObject({ status: 'credited', granted: 100 });
    const yesterday = await save(session, workout('yesterday', new Date(Date.now() - 30 * HOUR)));
    expect(reward(yesterday)).toMatchObject({ status: expect.stringMatching(/credited|cap_reached/) });
  });

  it('does not re-judge a workout as old when the phone sends it again later', async () => {
    const session = await signUpAndRegister();
    const body = workout('resent', new Date(Date.now() - HOUR));
    expect(reward(await save(session, body))).toMatchObject({ status: 'credited' });
    // The server first heard of it three days ago, as far as the row says.
    // Straight to the collection: mongoose keeps `createdAt` immutable.
    await WorkoutModel.collection.updateOne({ _id: 'resent' } as never, { $set: { createdAt: new Date(Date.now() - 3 * 24 * HOUR) } });
    const again = await save(session, { ...body, startedAt: new Date(Date.now() - 3 * 24 * HOUR - HOUR).toISOString(), completedAt: new Date(Date.now() - 3 * 24 * HOUR).toISOString() });
    expect(again.status).toBe(200);
    expect((await WorkoutModel.findById('resent').lean())?.plausible).toBe(true);
  });

  it('refuses a session longer than one sitting, and a start that is not a date', async () => {
    const session = await signUpAndRegister();
    const long = await save(session, workout('marathon', new Date(Date.now() - 10 * HOUR), 9 * 60));
    expect(reward(long)).toBeNull();
    const garbage = await save(session, { ...workout('garbage', new Date()), startedAt: 'not a date' });
    expect(garbage.status).toBe(422);
    expect(garbage.body.error.details).toHaveProperty('startedAt');
  });

  it('counts at most two workouts a day on the leaderboard however many are saved', async () => {
    const session = await signUpAndRegister();
    for (let i = 0; i < 6; i += 1) {
      await save(session, workout(`burst-${i}`, new Date(Date.now() - (i + 1) * 15 * 60_000)));
    }
    expect(await WorkoutModel.countDocuments({ userId: session.userId, plausible: true })).toBe(6);
    const today = localDayOf(new Date(), ZONE);
    await refreshLeaderboardScore(session.userId, today);
    const row = await LeaderboardScoreModel.findOne({ userId: session.userId }).lean();
    // Six saved within the last 90 minutes can straddle midnight: two days at most, two each.
    expect(row?.workouts).toBeLessThanOrEqual(4);
    expect(row?.workouts).toBeGreaterThanOrEqual(2);
  });
});

describe('M-1: a phone number typed onto somebody else\'s account', () => {
  afterEach(() => {
    setFirebasePhoneVerifier(null);
    setFirebaseUserForgetter(null);
  });

  async function signUpWith(email: string, phone: string) {
    const form = await request(app).post('/v1/auth/sign-up').set(baseHeaders)
      .send({ email, phone, password: 'walk1000steps', dateOfBirth: '1994-03-21', gender: 'female' });
    return form;
  }

  it('no longer stops the number\'s owner signing up with it — the squatter lets go', async () => {
    const squatter = await signUpAndRegister();
    const victimPhone = squatter.phone; // typed, never proved
    const form = await signUpWith(`owner-${Date.now()}@example.com`, victimPhone);
    expect(form.status).toBe(200);
    const done = await request(app).post('/v1/auth/verify-otp').set(baseHeaders)
      .send({ verificationId: form.body.verificationId, code: form.body.devCode });
    expect(done.status).toBe(200);
    expect((await UserModel.findById(done.body.user.id).lean())?.phone).toBe(victimPhone);
    expect((await UserModel.findById(squatter.userId).lean())?.phone).toBeUndefined();
    expect(await AuditLogModel.exists({ action: 'user.phone_released', subjectId: squatter.userId })).toBeTruthy();
  });

  it('lets the owner prove the number with Firebase and take it', async () => {
    const squatter = await signUpAndRegister();
    const owner = await signUpAndRegister();
    setFirebasePhoneVerifier(async () => ({ phone: squatter.phone, firebaseUid: 'fb-owner' }));
    setFirebaseUserForgetter(async () => {});
    const verified = await request(app).post('/v1/me/phone/verify').set(authed(owner))
      .send({ idToken: 'firebase-token', password: 'walk1000steps' });
    expect(verified.status).toBe(200);
    expect(verified.body.phone).toBe(squatter.phone);
    expect((await UserModel.findById(squatter.userId).lean())?.phone).toBeUndefined();
  });

  it('still refuses a number somebody has verified', async () => {
    const holder = await signUpAndRegister();
    await UserModel.updateOne({ _id: holder.userId }, { $set: { phoneVerifiedAt: new Date() } });
    const form = await signUpWith(`late-${Date.now()}@example.com`, holder.phone);
    expect(form.status).toBe(422);
    expect(form.body.error.details['phone.number']).toMatch(/already registered/);
  });
});

describe('L-1: a refresh token away from its device (RULES DV7)', () => {
  const refresh = (refreshToken: string, deviceId?: string) =>
    request(app).post('/v1/auth/refresh').set({ ...baseHeaders, ...(deviceId ? { 'x-vokve-device-id': deviceId } : {}) }).send({ refreshToken });

  it('is refused — and burnt — when the refresh leaves the device out', async () => {
    const session = await signUpAndRegister();
    const bare = await refresh(session.refreshToken);
    expect(bare.status).toBe(401);
    // Treated as theft: the token is gone for its own phone too.
    expect((await refresh(session.refreshToken, session.deviceId)).status).toBe(401);
    expect(await AuditLogModel.exists({ action: 'session.device_mismatch', subjectId: session.userId })).toBeTruthy();
  });

  it('is answered on its own device', async () => {
    const session = await signUpAndRegister();
    expect((await refresh(session.refreshToken, session.deviceId)).status).toBe(200);
  });

  it('cannot be moved onto somebody else\'s device by registering with it', async () => {
    const victim = await signUpAndRegister();
    const attacker = await signUpAndRegister();
    await request(app).post('/v1/devices/register').set(baseHeaders)
      .set('authorization', `Bearer ${attacker.accessToken}`)
      .set('x-vokve-refresh-token', victim.refreshToken)
      .send({ installId: `install-steal-${Date.now()}`, platform: 'android',
        profile: { brand: 'Google', model: 'Pixel 8', osVersion: '14', isEmulator: false, app: { version: '1.0.0', build: '1', bundleId: 'com.vokve' } } });
    const row = await RefreshTokenModel.findOne({ tokenHash: hashToken(victim.refreshToken) }).lean();
    expect(row?.deviceId).toBe(victim.deviceId);
  });

  it('a removed phone is not brought back by a session from before the removal — a new sign-in is', async () => {
    const session = await signUpAndRegister();
    const device = await DeviceModel.findById(session.deviceId).lean();
    await revokeDevice(session.userId, session.deviceId);
    const body = { installId: device!.installId, platform: 'android',
      profile: { brand: 'Google', model: 'Pixel 8', osVersion: '14', isEmulator: false, app: { version: '1.0.0', build: '1', bundleId: 'com.vokve' } } };

    const before = jwt.sign({ sub: session.userId, tier: 'normal', iat: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: 900, issuer: 'vokve' });
    const stale = await request(app).post('/v1/devices/register').set(baseHeaders).set('authorization', `Bearer ${before}`).send(body);
    expect(stale.status).toBe(401);
    expect((await DeviceModel.findById(session.deviceId).lean())?.revokedAt).not.toBeNull();

    const signIn = await request(app).post('/v1/auth/sign-in').set(baseHeaders).send({ email: session.email, password: 'walk1000steps' });
    const fresh = await request(app).post('/v1/devices/register').set(baseHeaders).set('authorization', `Bearer ${signIn.body.tokens.accessToken}`).send(body);
    expect(fresh.status).toBe(200);
    expect((await DeviceModel.findById(session.deviceId).lean())?.revokedAt).toBeNull();
  });
});

describe('H-1: an account made with an address nobody proved', () => {
  const VICTIM = 'owner.h1@example.com';
  const register = (accessToken: string, refreshToken: string) =>
    request(app).post('/v1/devices/register').set(baseHeaders)
      .set('authorization', `Bearer ${accessToken}`).set('x-vokve-refresh-token', refreshToken)
      .send({ installId: `install-h1-${Date.now()}-${Math.random()}`, platform: 'android',
        profile: { brand: 'Google', model: 'Pixel 8', osVersion: '14', isEmulator: false, app: { version: '1.0.0', build: '1', bundleId: 'com.vokve' } } });

  afterEach(() => {
    setFacebookVerifier(null);
    setGoogleVerifier(null);
    env.FACEBOOK_APP_ID = undefined;
    env.FACEBOOK_APP_SECRET = undefined;
    env.GOOGLE_WEB_CLIENT_ID = undefined;
  });

  /** The attacker: a Facebook account that reports the victim's address. */
  async function preHijack(email = VICTIM) {
    env.FACEBOOK_APP_ID = '1351878143619705';
    env.FACEBOOK_APP_SECRET = 'test-app-secret-0123456789abcdef';
    setFacebookVerifier(async () => ({ facebookId: `fb-attacker-${email}`, email, name: 'Not The Owner' }));
    const made = await request(app).post('/v1/auth/facebook').set(baseHeaders).send({ accessToken: 'EAAattacker' });
    expect(made.status).toBe(200);
    expect((await UserModel.findById(made.body.user.id).lean())?.emailVerifiedAt).toBeNull();
    const device = await register(made.body.tokens.accessToken, made.body.tokens.refreshToken);
    expect(device.status).toBe(200);
    return { userId: made.body.user.id as string, refreshToken: made.body.tokens.refreshToken as string, deviceId: device.body.deviceId as string };
  }

  it('signing in with Google takes the account and leaves its maker no way back in', async () => {
    const attacker = await preHijack();
    env.GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
    setGoogleVerifier(async () => ({ googleId: 'google-owner-h1', email: VICTIM, emailVerified: true, name: 'Owner', picture: null }));

    const owner = await request(app).post('/v1/auth/google').set(baseHeaders).send({ idToken: 'g' });
    expect(owner.status).toBe(200);
    expect(owner.body.user.id).toBe(attacker.userId); // the address's account, now the owner's

    const row = await UserModel.findById(attacker.userId).lean();
    expect(row).toMatchObject({ googleId: 'google-owner-h1', emailVerifiedAt: expect.any(Date) });
    expect(row?.facebookId).toBeUndefined();
    // The maker's session and phone are gone.
    expect((await request(app).post('/v1/auth/refresh').set({ ...baseHeaders, 'x-vokve-device-id': attacker.deviceId }).send({ refreshToken: attacker.refreshToken })).status).toBe(401);
    expect((await DeviceModel.findById(attacker.deviceId).lean())?.revokedAt).not.toBeNull();
    // And Facebook no longer opens it.
    const back = await request(app).post('/v1/auth/facebook').set(baseHeaders).send({ accessToken: 'EAAattacker' });
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(await AuditLogModel.exists({ action: 'user.unproven_account_claimed', subjectId: attacker.userId })).toBeTruthy();
  });

  it('a reset code from the inbox does the same', async () => {
    const email = 'owner.reset@example.com';
    const attacker = await preHijack(email);
    const asked = await request(app).post('/v1/auth/forgot-password').set(baseHeaders).send({ identifier: email });
    const reset = await request(app).post('/v1/auth/reset-password').set(baseHeaders)
      .send({ verificationId: asked.body.verificationId, code: asked.body.devCode, password: 'mine1234owner' });
    expect(reset.status).toBe(200);
    const row = await UserModel.findById(attacker.userId).lean();
    expect(row?.facebookId).toBeUndefined();
    expect(row?.emailVerifiedAt).toEqual(expect.any(Date));
    // The owner can now sign in with the password — an account with no proved contact could not.
    expect((await request(app).post('/v1/auth/sign-in').set(baseHeaders).send({ email, password: 'mine1234owner' })).status).toBe(200);
  });

  it('leaves an account whose address was already proved exactly as it was', async () => {
    const session = await signUpAndRegister();
    env.GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
    setGoogleVerifier(async () => ({ googleId: 'google-verified-h1', email: session.email, emailVerified: true, name: null, picture: null }));
    const signIn = await request(app).post('/v1/auth/google').set(baseHeaders).send({ idToken: 'g' });
    expect(signIn.body.user.id).toBe(session.userId);
    const row = await UserModel.findById(session.userId).lean();
    expect(row?.passwordHash.startsWith('$2')).toBe(true);
    expect(row?.phone).toBe(session.phone);
    expect((await request(app).post('/v1/auth/refresh').set({ ...baseHeaders, 'x-vokve-device-id': session.deviceId }).send({ refreshToken: session.refreshToken })).status).toBe(200);
  });
});

describe('M-3: changing how an account signs in on a session token alone', () => {
  const GOOGLE = { googleId: 'google-m3', email: 'someone.else@example.com', emailVerified: true, name: null, picture: null };
  let googleChecks = 0;

  afterEach(() => {
    setGoogleVerifier(null);
    env.GOOGLE_WEB_CLIENT_ID = undefined;
  });
  function useGoogle() {
    googleChecks = 0;
    env.GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
    setGoogleVerifier(async () => {
      googleChecks += 1;
      return GOOGLE;
    });
  }

  /** The same session, as a token whose sign-in was an hour ago. */
  const stale = (session: Session) => ({
    ...authed(session),
    authorization: `Bearer ${jwt.sign(
      { sub: session.userId, tier: 'normal', auth: Math.floor(Date.now() / 1000) - 3600 },
      env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: 900, issuer: 'vokve' },
    )}`,
  });
  const connectGoogle = (headers: Record<string, string>) =>
    request(app).post('/v1/me/sign-in-methods/google').set(headers).send({ idToken: 'g' });

  it('refuses to connect a provider on a session signed in long ago, before looking at the provider\'s token', async () => {
    useGoogle();
    const session = await signUpAndRegister();
    const res = await connectGoogle(stale(session));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STEP_UP_REQUIRED');
    expect(googleChecks).toBe(0); // the provider's token is untouched: the phone can send it again
    expect((await UserModel.findById(session.userId).lean())?.googleId).toBeUndefined();
  });

  it('connects with a step-up code, once', async () => {
    useGoogle();
    const session = await signUpAndRegister();
    const asked = await request(app).post('/v1/auth/step-up').set(stale(session));
    expect(asked.status).toBe(200);
    const passed = await request(app).post('/v1/auth/verify-otp').set(baseHeaders)
      .send({ verificationId: asked.body.verificationId, code: asked.body.devCode });
    const stepUp = passed.body.stepUpToken as string;
    expect(stepUp).toEqual(expect.any(String));

    const res = await connectGoogle({ ...stale(session), 'x-vokve-step-up': stepUp });
    expect(res.status).toBe(200);
    expect((await UserModel.findById(session.userId).lean())?.googleId).toBe('google-m3');
    // Spent: the same code does not open a second change.
    const again = await request(app).delete('/v1/me/sign-in-methods/google').set({ ...stale(session), 'x-vokve-step-up': stepUp });
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe('STEP_UP_INVALID');
  });

  it('lets a session signed in a moment ago connect without a code — "I already have an account" still works', async () => {
    useGoogle();
    const session = await signUpAndRegister();
    expect((await connectGoogle(authed(session))).status).toBe(200);
  });

  it('a refresh keeps the time the session was proved: keeping a token alive is not signing in', async () => {
    useGoogle();
    const session = await signUpAndRegister();
    await RefreshTokenModel.updateOne({ tokenHash: hashToken(session.refreshToken) }, { $set: { authAt: new Date(Date.now() - 3600_000) } });
    const refreshed = await request(app).post('/v1/auth/refresh').set({ ...baseHeaders, 'x-vokve-device-id': session.deviceId }).send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(200);
    const res = await connectGoogle({ ...authed(session), authorization: `Bearer ${refreshed.body.accessToken}` });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STEP_UP_REQUIRED');
  });

  it('refuses to take Google or Facebook off on a stale session too', async () => {
    useGoogle();
    const session = await signUpAndRegister();
    expect((await connectGoogle(authed(session))).status).toBe(200);
    const off = await request(app).delete('/v1/me/sign-in-methods/google').set(stale(session));
    expect(off.status).toBe(403);
    expect((await UserModel.findById(session.userId).lean())?.googleId).toBe('google-m3');
  });
});
