import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { setFirebasePhoneVerifier, setFirebaseUserForgetter } from '../src/lib/firebasePhone.js';
import { setGoogleVerifier } from '../src/lib/googleIdentity.js';
import { UserModel } from '../src/modules/identity/models.js';
import { AuditLogModel } from '../src/modules/platform/models.js';
import { app, authed, baseHeaders, signUpAndRegister } from './helpers.js';
import { seed } from '../src/seed/seed.js';

/**
 * Adding, proving and changing the phone number through Firebase (RULES O14).
 *
 * The Firebase verifier is replaced: what is checked is what the server
 * does with a proved number — whose account it may go on, and when the
 * password is asked for — not that firebase-admin can check a signature.
 */

const NUMBER = '+919812345678';
let proved = NUMBER;
const forgotten: string[] = [];

/** A Google member with no phone, signed in on a registered device. */
async function googleMember() {
  await seed();
  env.GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
  setGoogleVerifier(async () => ({
    googleId: 'google-sub-phone',
    email: 'walker@example.com',
    emailVerified: true,
    name: 'Walker',
    picture: null,
  }));
  const signIn = await request(app).post('/v1/auth/google').set(baseHeaders).send({ idToken: 'g' });
  const register = await request(app)
    .post('/v1/devices/register')
    .set(baseHeaders)
    .set('authorization', `Bearer ${signIn.body.tokens.accessToken}`)
    .set('x-vokve-refresh-token', signIn.body.tokens.refreshToken)
    .send({
      installId: `install-google-${Date.now()}`, vendorId: 'vendor-google', platform: 'android',
      profile: { brand: 'Google', model: 'Pixel 8', osVersion: '14', isEmulator: false, app: { version: '1.0.0', build: '1', bundleId: 'com.vokve' } },
    });
  return {
    userId: signIn.body.user.id as string,
    headers: { ...baseHeaders, authorization: `Bearer ${signIn.body.tokens.accessToken}`, 'x-vokve-device-id': register.body.deviceId },
  };
}

const check = (headers: Record<string, string>, body: Record<string, unknown>) =>
  request(app).post('/v1/me/phone/check').set(headers).send(body);
const verify = (headers: Record<string, string>, body: Record<string, unknown> = {}) =>
  request(app).post('/v1/me/phone/verify').set(headers).send({ idToken: 'firebase-token', ...body });

beforeEach(() => {
  proved = NUMBER;
  forgotten.length = 0;
  setFirebasePhoneVerifier(async () => ({ phone: proved, firebaseUid: 'fb-uid-1' }));
  setFirebaseUserForgetter(async uid => {
    forgotten.push(uid);
  });
});

afterEach(() => {
  setFirebasePhoneVerifier(null);
  setFirebaseUserForgetter(null);
  setGoogleVerifier(null);
  env.GOOGLE_WEB_CLIENT_ID = undefined;
});

describe('a Google or Apple member with no number', () => {
  it('adds one without a password, verified, and Firebase forgets its copy', async () => {
    const member = await googleMember();

    expect((await check(member.headers, { phone: NUMBER })).status).toBe(200);
    const response = await verify(member.headers);

    expect(response.status).toBe(200);
    expect(response.body.phone).toBe(NUMBER);
    expect(response.body.phoneVerifiedAt).toBeTruthy();
    expect(forgotten).toEqual(['fb-uid-1']);
    expect(await AuditLogModel.countDocuments({ action: 'user.phone_verified', subjectId: member.userId })).toBe(1);
  });

  it('cannot change a verified number without a password, and is told how to get one', async () => {
    const member = await googleMember();
    await verify(member.headers);

    proved = '+919800000001';
    const response = await check(member.headers, { phone: proved });

    expect(response.status).toBe(422);
    expect(response.body.error.details.password).toMatch(/Forgot password/);
    expect((await verify(member.headers)).status).toBe(422);
    expect((await UserModel.findById(member.userId).lean())?.phone).toBe(NUMBER);
  });

  it('answers a repeated confirmation with the account rather than an error', async () => {
    const member = await googleMember();
    await verify(member.headers);

    const again = await verify(member.headers);
    expect(again.status).toBe(200);
    expect(again.body.phone).toBe(NUMBER);
  });
});

describe('a password member', () => {
  it('proves the number given at sign-up without the password', async () => {
    const session = await signUpAndRegister();
    proved = session.phone;

    expect((await check(authed(session), { phone: session.phone })).status).toBe(200);
    const response = await verify(authed(session));

    expect(response.status).toBe(200);
    expect(response.body.phoneVerifiedAt).toBeTruthy();
  });

  it('needs the password to swap in a different number, and the right one', async () => {
    const session = await signUpAndRegister();

    const without = await check(authed(session), { phone: NUMBER });
    expect(without.status).toBe(422);
    expect(without.body.error.details.password).toBe('Enter your password to change your number.');

    const wrong = await check(authed(session), { phone: NUMBER, password: 'not-it-123' });
    expect(wrong.body.error.details.password).toBe('That is not your password.');

    expect((await check(authed(session), { phone: NUMBER, password: 'walk1000steps' })).status).toBe(200);
    const response = await verify(authed(session), { password: 'walk1000steps' });
    expect(response.status).toBe(200);
    expect(response.body.phone).toBe(NUMBER);
  });
});

describe('what it refuses', () => {
  it('a number that is another account’s, before any SMS is sent', async () => {
    const other = await signUpAndRegister();
    const member = await googleMember();
    proved = other.phone;

    const response = await check(member.headers, { phone: other.phone });
    expect(response.status).toBe(422);
    expect(response.body.error.details.phone).toBe('That number is already registered to another account.');
    // And again at the end, which is the answer that counts.
    expect((await verify(member.headers)).status).toBe(422);
    // Firebase forgets its copy even when the number is refused.
    expect(forgotten).toEqual(['fb-uid-1']);
  });

  it('a token Firebase will not vouch for', async () => {
    const member = await googleMember();
    setFirebasePhoneVerifier(async () => {
      throw Object.assign(new Error('bad'), { status: 401, code: 'PHONE_TOKEN_INVALID' });
    });

    expect((await verify(member.headers)).status).toBeGreaterThanOrEqual(400);
    expect((await UserModel.findById(member.userId).lean())?.phone).toBeUndefined();
  });

  it('a body that names the number instead of proving it', async () => {
    const member = await googleMember();
    const response = await request(app)
      .post('/v1/me/phone/verify')
      .set(member.headers)
      .send({ idToken: 'firebase-token', phone: '+919899999999' });
    expect(response.status).toBe(422);
  });

  it('a number in the wrong shape at the check', async () => {
    const member = await googleMember();
    expect((await check(member.headers, { phone: '98123' })).status).toBe(422);
  });
});
