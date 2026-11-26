import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { setAppleVerifier, type AppleIdentity } from '../src/lib/appleIdentity.js';
import { setGoogleVerifier, type GoogleIdentity } from '../src/lib/googleIdentity.js';
import { verifyAccessToken } from '../src/lib/tokens.js';
import { UserModel } from '../src/modules/identity/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { AuditLogModel } from '../src/modules/platform/models.js';
import { app, authed, baseHeaders, signUpAndRegister } from './helpers.js';
import { seed } from '../src/seed/seed.js';

/**
 * Connecting Google and Apple to an account that already exists (RULES O15).
 *
 * The case it is for: a member who signed up with an email and password
 * presses "Sign in with Apple" on a new phone and hides their address.
 * Apple's relay address matches nothing, so before this they got a second,
 * empty account. Now a new client asks first, and either path — a new
 * account, or "I already have one" — ends with one account per person.
 */

const NONCE = 'raw-nonce-0123456789abcdef';
const RELAY = 'x7k2p9@privaterelay.appleid.com';

const apple = (over: Partial<AppleIdentity> = {}): AppleIdentity => ({
  appleId: '001234.apple-sub.0001',
  email: RELAY,
  isPrivateEmail: true,
  ...over,
});
const google = (over: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  googleId: 'google-sub-1',
  email: 'rana@gmail.com',
  emailVerified: true,
  name: 'Rana Jay',
  picture: null,
  ...over,
});

const appleSignIn = (body: Record<string, unknown> = {}) =>
  request(app).post('/v1/auth/apple').set(baseHeaders).send({ idToken: 'tok', nonce: NONCE, ...body });

beforeEach(async () => {
  await seed();
  env.APPLE_CLIENT_IDS = 'com.vokve.fitness';
  env.GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
  setAppleVerifier(async () => apple());
  setGoogleVerifier(async () => google());
});

afterEach(() => {
  setAppleVerifier(null);
  setGoogleVerifier(null);
  env.APPLE_CLIENT_IDS = undefined;
  env.GOOGLE_WEB_CLIENT_ID = undefined;
});

/** Signs in with Apple in `ask` mode and returns the link token it hands back. */
async function askApple(): Promise<string> {
  const response = await appleSignIn({ ifNew: 'ask' });
  expect(response.status).toBe(409);
  return response.body.error.details.linkToken;
}

describe('a new client asks before making a second account', () => {
  it('answers IDENTITY_NOT_LINKED with a link token, and creates nothing', async () => {
    const before = await UserModel.countDocuments();
    const response = await appleSignIn({ ifNew: 'ask', fullName: { givenName: 'Rana', familyName: 'Jay' } });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IDENTITY_NOT_LINKED');
    expect(response.body.error.details).toMatchObject({ provider: 'apple', email: RELAY, expiresInSeconds: 900 });
    expect(typeof response.body.error.details.linkToken).toBe('string');
    expect(await UserModel.countDocuments()).toBe(before);
  });

  it('still signs a known identity straight in', async () => {
    const first = await appleSignIn();
    const again = await appleSignIn({ ifNew: 'ask' });

    expect(again.status).toBe(200);
    expect(again.body.user.id).toBe(first.body.user.id);
  });

  it('still links by a matching verified email without asking', async () => {
    const session = await signUpAndRegister();
    setAppleVerifier(async () => apple({ email: session.email, isPrivateEmail: false }));

    const response = await appleSignIn({ ifNew: 'ask' });

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(session.userId);
  });

  it('asks for Google too', async () => {
    const response = await request(app).post('/v1/auth/google').set(baseHeaders).send({ idToken: 'g', ifNew: 'ask' });

    expect(response.status).toBe(409);
    expect(response.body.error.details).toMatchObject({ provider: 'google', email: 'rana@gmail.com' });
  });

  it('keeps making the account for a build that does not ask', async () => {
    const response = await appleSignIn();

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(RELAY);
  });

  it('a link token is never a session', async () => {
    expect(verifyAccessToken(await askApple())).toBeNull();
  });
});

describe('"Create a new account"', () => {
  it('makes the account from the link token, with the name Apple gave once', async () => {
    const response = await appleSignIn({ ifNew: 'ask', fullName: { givenName: 'Rana', familyName: 'Jay' } });
    const linkToken = response.body.error.details.linkToken;

    const created = await request(app).post('/v1/auth/identity/create').set(baseHeaders).send({ linkToken });

    expect(created.status).toBe(200);
    expect(created.body.user).toMatchObject({ email: RELAY, name: 'Rana Jay' });
    const stored = await UserModel.findById(created.body.user.id).lean();
    expect(stored?.appleId).toBe('001234.apple-sub.0001');
  });

  it('signs in to the account instead when one appeared in between', async () => {
    const linkToken = await askApple();
    const first = await request(app).post('/v1/auth/identity/create').set(baseHeaders).send({ linkToken });
    const second = await request(app).post('/v1/auth/identity/create').set(baseHeaders).send({ linkToken });

    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(await UserModel.countDocuments({ appleId: '001234.apple-sub.0001' })).toBe(1);
  });

  it('refuses an expired or forged token', async () => {
    const expired = jwt.sign({ kind: 'identity_link', p: 'apple', pid: 'x' }, env.JWT_SECRET, { algorithm: 'HS256', issuer: 'vokve', expiresIn: -10 });
    const forged = jwt.sign({ kind: 'identity_link', p: 'apple', pid: 'x' }, 'not-our-secret-not-our-secret', { algorithm: 'HS256', issuer: 'vokve' });

    for (const linkToken of [expired, forged]) {
      const response = await request(app).post('/v1/auth/identity/create').set(baseHeaders).send({ linkToken });
      expect(response.status).toBe(410);
      expect(response.body.error.code).toBe('IDENTITY_LINK_EXPIRED');
    }
  });

  it('refuses a session token passed off as a link token', async () => {
    const session = await signUpAndRegister();
    const response = await request(app).post('/v1/auth/identity/create').set(baseHeaders).send({ linkToken: session.accessToken });

    expect(response.status).toBe(410);
  });
});

describe('"I already have an account"', () => {
  it('connects the identity to the account the member then signs in to', async () => {
    const linkToken = await askApple();
    const session = await signUpAndRegister();

    const linked = await request(app).post('/v1/me/sign-in-methods/link').set(authed(session)).send({ linkToken });

    expect(linked.status).toBe(200);
    expect(linked.body.providers).toContainEqual({ provider: 'apple', linked: true, canDisconnect: true });
    // And from now on Apple signs in to that account, relay address and all.
    const again = await appleSignIn({ ifNew: 'ask' });
    expect(again.status).toBe(200);
    expect(again.body.user.id).toBe(session.userId);
    expect(await UserModel.countDocuments({ email: RELAY })).toBe(0);
    expect(await AuditLogModel.countDocuments({ action: 'user.identity_linked', subjectId: session.userId })).toBe(1);
    expect(await NotificationModel.countDocuments({ userId: session.userId, title: 'Apple sign-in connected' })).toBe(1);
  });
});

describe('Security → Sign-in methods', () => {
  it('lists a password account with nothing connected', async () => {
    const session = await signUpAndRegister();
    const response = await request(app).get('/v1/me/sign-in-methods').set(authed(session));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      password: true,
      confirmChangesWith: 'password',
      providers: [
        { provider: 'google', linked: false, canDisconnect: false },
        { provider: 'apple', linked: false, canDisconnect: false },
        { provider: 'facebook', linked: false, canDisconnect: false },
      ],
    });
  });

  it('connects Apple and Google with fresh provider tokens', async () => {
    const session = await signUpAndRegister();

    const viaApple = await request(app).post('/v1/me/sign-in-methods/apple').set(authed(session)).send({ idToken: 'tok', nonce: NONCE });
    const viaGoogle = await request(app).post('/v1/me/sign-in-methods/google').set(authed(session)).send({ idToken: 'g' });

    expect(viaApple.status).toBe(200);
    expect(viaGoogle.status).toBe(200);
    const stored = await UserModel.findById(session.userId).lean();
    expect(stored).toMatchObject({ appleId: '001234.apple-sub.0001', googleId: 'google-sub-1' });
    // Connecting is idempotent: the same identity again changes nothing.
    const again = await request(app).post('/v1/me/sign-in-methods/apple').set(authed(session)).send({ idToken: 'tok', nonce: NONCE });
    expect(again.status).toBe(200);
  });

  it('refuses an identity another live account already has, and names that account', async () => {
    await appleSignIn(); // the accidental second account, made by an old build
    const session = await signUpAndRegister();

    const response = await request(app).post('/v1/me/sign-in-methods/apple').set(authed(session)).send({ idToken: 'tok', nonce: NONCE });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IDENTITY_IN_USE');
    expect(response.body.error.details.account).toBe('x•••@privaterelay.appleid.com');
  });

  it('signing in with a deleted account\'s Google starts a fresh account, not a 401 forever', async () => {
    const old = await request(app).post('/v1/auth/google').set(baseHeaders).send({ idToken: 'g' });
    await UserModel.updateOne({ _id: old.body.user.id }, { $set: { deletedAt: new Date(), email: `deleted+${old.body.user.id}@vokve.invalid` } });

    const asked = await request(app).post('/v1/auth/google').set(baseHeaders).send({ idToken: 'g', ifNew: 'ask' });
    expect(asked.status).toBe(409);
    expect(asked.body.error.code).toBe('IDENTITY_NOT_LINKED');

    const back = await request(app).post('/v1/auth/google').set(baseHeaders).send({ idToken: 'g' });
    expect(back.status).toBe(200);
    expect(back.body.user.id).not.toBe(old.body.user.id);
    expect((await UserModel.findById(old.body.user.id).lean())?.googleId).toBeUndefined();
  });

  it('takes an identity off a deleted account rather than refusing', async () => {
    const old = await appleSignIn();
    await UserModel.updateOne({ _id: old.body.user.id }, { $set: { deletedAt: new Date() } });
    const session = await signUpAndRegister();

    const response = await request(app).post('/v1/me/sign-in-methods/apple').set(authed(session)).send({ idToken: 'tok', nonce: NONCE });

    expect(response.status).toBe(200);
    expect((await UserModel.findById(old.body.user.id).lean())?.appleId).toBeUndefined();
  });

  it('refuses a second, different Apple ID on one account', async () => {
    const session = await signUpAndRegister();
    await request(app).post('/v1/me/sign-in-methods/apple').set(authed(session)).send({ idToken: 'tok', nonce: NONCE });
    setAppleVerifier(async () => apple({ appleId: '009999.other-sub' }));

    const response = await request(app).post('/v1/me/sign-in-methods/apple').set(authed(session)).send({ idToken: 'tok', nonce: NONCE });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PROVIDER_ALREADY_LINKED');
  });

  it('disconnects a provider when another way in remains', async () => {
    const session = await signUpAndRegister();
    await request(app).post('/v1/me/sign-in-methods/apple').set(authed(session)).send({ idToken: 'tok', nonce: NONCE });

    // Apple is confirmed with Apple before it goes (RULES O16); the revocation
    // itself is `appleRevocation.test.ts`'s business.
    const response = await request(app).delete('/v1/me/sign-in-methods/apple').set(authed(session))
      .send({ apple: { idToken: 'tok', nonce: NONCE, authorizationCode: 'code-1' } });

    expect(response.status).toBe(200);
    expect(response.body.providers).toContainEqual({ provider: 'apple', linked: false, canDisconnect: false });
    expect((await UserModel.findById(session.userId).lean())?.appleId).toBeUndefined();
    expect(await AuditLogModel.countDocuments({ action: 'user.identity_unlinked', subjectId: session.userId })).toBe(1);
  });

  it('will not disconnect the only way into an account', async () => {
    const created = await appleSignIn();
    const register = await request(app).post('/v1/devices/register').set(baseHeaders)
      .set('authorization', `Bearer ${created.body.tokens.accessToken}`)
      .set('x-vokve-refresh-token', created.body.tokens.refreshToken)
      .send({ installId: `install-apple-${Date.now()}`, vendorId: 'vendor-apple', platform: 'android',
        profile: { brand: 'Google', model: 'Pixel 8', osVersion: '14', isEmulator: false, app: { version: '1.0.0', build: '1', bundleId: 'com.vokve' } } });
    const headers = { ...baseHeaders, authorization: `Bearer ${created.body.tokens.accessToken}`, 'x-vokve-device-id': register.body.deviceId };

    const methods = await request(app).get('/v1/me/sign-in-methods').set(headers);
    expect(methods.body).toMatchObject({ password: false, providers: [{ provider: 'google', linked: false }, { provider: 'apple', linked: true, canDisconnect: false }, { provider: 'facebook', linked: false }] });

    const response = await request(app).delete('/v1/me/sign-in-methods/apple').set(headers);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LAST_SIGN_IN_METHOD');
  });

  it('answers 404 for a provider it does not know', async () => {
    const session = await signUpAndRegister();
    const response = await request(app).delete('/v1/me/sign-in-methods/twitter').set(authed(session));
    expect(response.status).toBe(404);
  });
});
