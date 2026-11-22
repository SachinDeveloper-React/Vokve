import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import {
  setAppleNotificationVerifier,
  setAppleVerifier,
  type AppleIdentity,
  type AppleServerEvent,
} from '../src/lib/appleIdentity.js';
import { ApiError } from '../src/lib/errors.js';
import { UserModel } from '../src/modules/identity/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { AuditLogModel } from '../src/modules/platform/models.js';
import { app, authed, baseHeaders, signUpAndRegister } from './helpers.js';
import { seed } from '../src/seed/seed.js';

/**
 * What Apple tells the server without the member opening the app (RULES O17).
 *
 * The endpoint takes Apple's signed payload with none of the app's headers;
 * the verifier is replaced here (its real checks are in
 * `appleIdentity.test.ts`), and what is checked is what each event does to
 * the account: consent withdrawn ends exactly the sessions Apple began, a
 * deleted Apple ID comes off the account, and Hide My Email forwarding is
 * marked off and on — only for the address the account still uses.
 */

const NONCE = 'raw-nonce-0123456789abcdef';
const APPLE_SUB = '001234.apple-sub.0001';
const RELAY = 'x7k2p9@privaterelay.appleid.com';

const apple = (over: Partial<AppleIdentity> = {}): AppleIdentity => ({
  appleId: APPLE_SUB,
  email: RELAY,
  isPrivateEmail: true,
  audience: 'com.vokve.fitness',
  ...over,
});

let nextEvent: AppleServerEvent | null = null;
const post = (event: AppleServerEvent | null) => {
  nextEvent = event;
  // No X-Vokve-* headers: Apple sends none.
  return request(app).post('/v1/auth/apple/notifications').send({ payload: 'signed-by-apple' });
};
const event = (type: AppleServerEvent['type'], over: Partial<AppleServerEvent> = {}): AppleServerEvent => ({
  type,
  appleId: APPLE_SUB,
  email: null,
  at: new Date('2026-11-17T10:00:00Z'),
  ...over,
});

beforeEach(async () => {
  await seed();
  env.APPLE_CLIENT_IDS = 'com.vokve.fitness';
  nextEvent = null;
  setAppleVerifier(async () => apple());
  setAppleNotificationVerifier(async () => nextEvent);
});

afterEach(() => {
  setAppleVerifier(null);
  setAppleNotificationVerifier(null);
  env.APPLE_CLIENT_IDS = undefined;
});

/** Signs in with Apple on a fresh phone; returns what that phone holds. */
async function appleSession() {
  const signedIn = await request(app).post('/v1/auth/apple').set(baseHeaders).send({ idToken: 'tok', nonce: NONCE });
  const register = await request(app).post('/v1/devices/register').set(baseHeaders)
    .set('authorization', `Bearer ${signedIn.body.tokens.accessToken}`)
    .set('x-vokve-refresh-token', signedIn.body.tokens.refreshToken)
    .send({ installId: `install-${Date.now()}-${Math.random()}`, vendorId: 'vendor-apple', platform: 'ios',
      profile: { brand: 'Apple', model: 'iPhone 17', osVersion: '26', isEmulator: false, app: { version: '1.0.0', build: '1', bundleId: 'com.vokve.fitness' } } });
  return {
    userId: signedIn.body.user.id as string,
    refreshToken: signedIn.body.tokens.refreshToken as string,
    deviceId: register.body.deviceId as string,
    headers: { ...baseHeaders, authorization: `Bearer ${signedIn.body.tokens.accessToken}`, 'x-vokve-device-id': register.body.deviceId },
  };
}

const refresh = (refreshToken: string, deviceId?: string) =>
  request(app).post('/v1/auth/refresh').set({ ...baseHeaders, ...(deviceId ? { 'x-vokve-device-id': deviceId } : {}) }).send({ refreshToken });

describe('the endpoint', () => {
  it('answers Apple, which sends none of the app’s headers', async () => {
    await appleSession();
    const response = await post(event('consent-revoked'));
    expect(response.status).toBe(200);
  });

  it('refuses a payload whose signature does not check out', async () => {
    setAppleNotificationVerifier(async () => {
      throw new ApiError(401, 'APPLE_NOTIFICATION_INVALID', 'That notification could not be verified.');
    });
    const response = await request(app).post('/v1/auth/apple/notifications').send({ payload: 'forged' });
    expect(response.status).toBe(401);
  });

  it('refuses a body with no payload', async () => {
    const response = await request(app).post('/v1/auth/apple/notifications').send({});
    expect(response.status).toBe(422);
  });

  it('takes Apple’s word for a member it does not know, and does nothing', async () => {
    const response = await post(event('consent-revoked', { appleId: '009999.stranger' }));
    expect(response.status).toBe(200);
  });

  it('ignores a type it does not know rather than refusing it', async () => {
    const response = await post(null);
    expect(response.status).toBe(200);
  });
});

describe('consent-revoked', () => {
  it('ends the sessions Apple began, and only those', async () => {
    // A password member who also connected Apple, signed in both ways.
    const byPassword = await signUpAndRegister();
    await request(app).post('/v1/me/sign-in-methods/apple').set(authed(byPassword)).send({ idToken: 'tok', nonce: NONCE });
    const byApple = await appleSession();
    expect(byApple.userId).toBe(byPassword.userId);
    // A rotation in between carries how the session began.
    const rotated = await refresh(byApple.refreshToken, byApple.deviceId);
    expect(rotated.status).toBe(200);

    await post(event('consent-revoked'));

    expect((await refresh(rotated.body.refreshToken, byApple.deviceId)).status).toBe(401);
    expect((await refresh(byPassword.refreshToken, byPassword.deviceId)).status).toBe(200);
    // The Apple ID stays connected: consent comes back at the next Apple sign-in.
    expect((await UserModel.findById(byPassword.userId).lean())?.appleId).toBe(APPLE_SUB);
    expect(await NotificationModel.countDocuments({ userId: byPassword.userId, title: 'Signed out of Sign in with Apple' })).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'user.apple_consent_revoked', subjectId: byPassword.userId })).toBe(1);
  });
});

describe('account-delete', () => {
  it('takes the dead Apple ID off the account and ends its sessions', async () => {
    const session = await appleSession();

    await post(event('account-delete'));

    expect((await UserModel.findById(session.userId).lean())?.appleId).toBeUndefined();
    expect((await refresh(session.refreshToken, session.deviceId)).status).toBe(401);
    const note = await NotificationModel.findOne({ userId: session.userId, title: 'Your Apple ID no longer signs in' }).lean();
    // An Apple-only account whose relay address died with the Apple ID: support is the way back.
    expect(note?.message).toContain('Contact support');
  });
});

describe('Hide My Email forwarding', () => {
  it('is marked off and on for the relay address the account uses', async () => {
    const session = await appleSession();

    await post(event('email-disabled', { email: RELAY }));
    expect((await request(app).get('/v1/me').set(session.headers)).body.emailForwardingOff).toBe(true);

    await post(event('email-enabled', { email: RELAY }));
    expect((await request(app).get('/v1/me').set(session.headers)).body.emailForwardingOff).toBe(false);
  });

  it('leaves alone an account that has moved to another address', async () => {
    const session = await appleSession();
    await UserModel.updateOne({ _id: session.userId }, { $set: { email: 'rana@example.com' } });

    await post(event('email-disabled', { email: RELAY }));

    expect((await UserModel.findById(session.userId).lean())?.emailForwardingOffAt).toBeNull();
  });

  it('a member with no password can move to an address they read by confirming with Apple', async () => {
    const session = await appleSession();
    await post(event('email-disabled', { email: RELAY }));

    const methods = await request(app).get('/v1/me/sign-in-methods').set(session.headers);
    expect(methods.body.confirmChangesWith).toBe('apple');

    const change = await request(app).post('/v1/me/email').set(session.headers)
      .send({ email: 'rana@example.com', apple: { idToken: 'fresh', nonce: NONCE, authorizationCode: 'code-1' } });
    expect(change.status).toBe(200);
    expect(change.body.verificationId).toEqual(expect.any(String));
  });
});
