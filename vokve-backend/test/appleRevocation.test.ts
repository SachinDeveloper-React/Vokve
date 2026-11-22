import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { setAppleVerifier, type AppleIdentity } from '../src/lib/appleIdentity.js';
import { AppleCodeRefused, appleClientSecret, setAppleTokenTransport } from '../src/lib/appleTokens.js';
import { setGoogleVerifier, type GoogleIdentity } from '../src/lib/googleIdentity.js';
import { UserModel } from '../src/modules/identity/models.js';
import { AuditLogModel } from '../src/modules/platform/models.js';
import { app, authed, baseHeaders, signUpAndRegister } from './helpers.js';
import { seed } from '../src/seed/seed.js';

/**
 * Revoking Apple, and proving it is the member before a deletion (RULES O16).
 *
 * App Store Review Guideline 5.1.1(v): deleting an account that signed in
 * with Apple must revoke the member's Apple authorisation. The server keeps
 * no Apple token, so the deletion asks for a fresh Apple sign-in and
 * revokes what its authorisation code yields. And an account with no
 * password could not be deleted at all before this — the proof is now the
 * account's own way in.
 */

const NONCE = 'raw-nonce-0123456789abcdef';
const APPLE_SUB = '001234.apple-sub.0001';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const P8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const apple = (over: Partial<AppleIdentity> = {}): AppleIdentity => ({
  appleId: APPLE_SUB,
  email: 'x7k2p9@privaterelay.appleid.com',
  isPrivateEmail: true,
  audience: 'com.vokve.fitness',
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
const appleProof = { idToken: 'fresh-token', nonce: NONCE, authorizationCode: 'code-1' };

let exchanged: Record<string, string>[] = [];
let revoked: Record<string, string>[] = [];

function configureKey() {
  env.APPLE_TEAM_ID = 'TEAM123456';
  env.APPLE_KEY_ID = 'KEY1234567';
  env.APPLE_PRIVATE_KEY = P8.replace(/\n/g, '\\n');
}

beforeEach(async () => {
  await seed();
  env.APPLE_CLIENT_IDS = 'com.vokve.fitness,com.vokve.fitness.service';
  env.GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
  env.APPLE_REDIRECT_URI = 'https://vokve-d50ff.firebaseapp.com/__/auth/handler';
  configureKey();
  exchanged = [];
  revoked = [];
  setAppleVerifier(async () => apple());
  setGoogleVerifier(async () => google());
  setAppleTokenTransport({
    async exchange(form) {
      exchanged.push(form);
      return { refreshToken: 'apple-refresh-1', accessToken: 'apple-access-1' };
    },
    async revoke(form) {
      revoked.push(form);
    },
  });
});

afterEach(() => {
  setAppleVerifier(null);
  setGoogleVerifier(null);
  setAppleTokenTransport(null);
  env.APPLE_CLIENT_IDS = undefined;
  env.GOOGLE_WEB_CLIENT_ID = undefined;
  env.APPLE_REDIRECT_URI = undefined;
  env.APPLE_TEAM_ID = undefined;
  env.APPLE_KEY_ID = undefined;
  env.APPLE_PRIVATE_KEY = undefined;
});

/** An account made by signing in with Apple, with a registered device. */
async function appleAccount(platform: 'ios' | 'android' = 'ios') {
  const headers = { ...baseHeaders, 'x-vokve-platform': platform };
  const created = await request(app).post('/v1/auth/apple').set(headers).send({ idToken: 'tok', nonce: NONCE });
  const register = await request(app).post('/v1/devices/register').set(headers)
    .set('authorization', `Bearer ${created.body.tokens.accessToken}`)
    .set('x-vokve-refresh-token', created.body.tokens.refreshToken)
    .send({ installId: `install-apple-${Date.now()}-${Math.random()}`, vendorId: 'vendor-apple', platform,
      profile: { brand: 'Apple', model: 'iPhone 17', osVersion: '26', isEmulator: false, app: { version: '1.0.0', build: '1', bundleId: 'com.vokve.fitness' } } });
  return {
    userId: created.body.user.id as string,
    headers: { ...headers, authorization: `Bearer ${created.body.tokens.accessToken}`, 'x-vokve-device-id': register.body.deviceId },
  };
}

describe('the client secret Apple’s token endpoints take', () => {
  it('is an ES256 JWT from our team, for the client the code was issued to', () => {
    const secret = appleClientSecret('com.vokve.fitness', Date.UTC(2026, 10, 17));
    const decoded = jwt.verify(secret, publicKey, { algorithms: ['ES256'], ignoreExpiration: true, complete: true });

    expect(decoded.header).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
    expect(decoded.payload).toMatchObject({
      iss: 'TEAM123456',
      sub: 'com.vokve.fitness',
      aud: 'https://appleid.apple.com',
    });
    const { iat, exp } = decoded.payload as { iat: number; exp: number };
    expect(exp - iat).toBeLessThanOrEqual(15_777_000); // Apple's six-month ceiling
  });
});

describe('deleting an account that signs in with Apple', () => {
  it('asks for Apple, not a password it does not have', async () => {
    const account = await appleAccount();

    const deletion = await request(app).get('/v1/me/deletion').set(account.headers);
    expect(deletion.body.confirmWith).toBe('apple');

    const withoutApple = await request(app).post('/v1/me/deletion').set(account.headers).send({ reason: 'bye' });
    expect(withoutApple.status).toBe(422);
    expect(withoutApple.body.error).toMatchObject({ code: 'CONFIRMATION_REQUIRED', details: { confirmWith: 'apple' } });
  });

  it('schedules it and revokes the Apple authorisation the confirmation yields', async () => {
    const account = await appleAccount();

    const response = await request(app).post('/v1/me/deletion').set(account.headers).send({ apple: appleProof, reason: 'bye' });

    expect(response.status).toBe(200);
    expect(response.body.scheduledAt).toEqual(expect.any(String));
    expect(exchanged).toEqual([
      expect.objectContaining({ client_id: 'com.vokve.fitness', code: 'code-1', grant_type: 'authorization_code' }),
    ]);
    // A native iOS code carries no return URL.
    expect(exchanged[0]).not.toHaveProperty('redirect_uri');
    expect(revoked).toEqual([
      expect.objectContaining({ client_id: 'com.vokve.fitness', token: 'apple-refresh-1', token_type_hint: 'refresh_token' }),
    ]);
    const audit = await AuditLogModel.findOne({ action: 'user.deletion_scheduled', subjectId: account.userId }).lean();
    expect(audit?.after).toMatchObject({ confirmedWith: 'apple', appleRevocation: 'revoked' });
  });

  it('exchanges an Android web-flow code with its Services ID and return URL', async () => {
    const account = await appleAccount('android');
    setAppleVerifier(async () => apple({ audience: 'com.vokve.fitness.service' }));

    await request(app).post('/v1/me/deletion').set(account.headers).send({ apple: appleProof });

    expect(exchanged[0]).toMatchObject({
      client_id: 'com.vokve.fitness.service',
      redirect_uri: 'https://vokve-d50ff.firebaseapp.com/__/auth/handler',
    });
  });

  it('refuses somebody else’s Apple ID', async () => {
    const account = await appleAccount();
    setAppleVerifier(async () => apple({ appleId: '009999.someone-else' }));

    const response = await request(app).post('/v1/me/deletion').set(account.headers).send({ apple: appleProof });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('APPLE_ID_MISMATCH');
    expect(exchanged).toHaveLength(0);
  });

  it('asks again when Apple refuses the code, and schedules nothing', async () => {
    const account = await appleAccount();
    setAppleTokenTransport({
      exchange: () => Promise.reject(new AppleCodeRefused('invalid_grant')),
      revoke: async () => {},
    });

    const response = await request(app).post('/v1/me/deletion').set(account.headers).send({ apple: appleProof });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('APPLE_CONFIRMATION_EXPIRED');
    expect((await request(app).get('/v1/me/deletion').set(account.headers)).body.scheduledAt).toBeNull();
  });

  it('goes ahead when Apple itself is down, and tells ops', async () => {
    const account = await appleAccount();
    setAppleTokenTransport({
      exchange: () => Promise.reject(new Error('Apple token endpoint answered 503')),
      revoke: async () => {},
    });

    const response = await request(app).post('/v1/me/deletion').set(account.headers).send({ apple: appleProof });

    expect(response.status).toBe(200);
    const audit = await AuditLogModel.findOne({ action: 'user.deletion_scheduled', subjectId: account.userId }).lean();
    expect(audit?.after).toMatchObject({ appleRevocation: 'failed' });
  });

  it('still lets the member leave when the server has no Apple key, and says so', async () => {
    env.APPLE_TEAM_ID = undefined;
    const account = await appleAccount();

    const response = await request(app).post('/v1/me/deletion').set(account.headers).send({ apple: appleProof });

    expect(response.status).toBe(200);
    expect(exchanged).toHaveLength(0);
    const audit = await AuditLogModel.findOne({ action: 'user.deletion_scheduled', subjectId: account.userId }).lean();
    expect(audit?.after).toMatchObject({ appleRevocation: 'not_configured' });
  });
});

describe('the proof every other account gives', () => {
  it('a password account is asked for its password, as before', async () => {
    const session = await signUpAndRegister();

    expect((await request(app).get('/v1/me/deletion').set(authed(session))).body.confirmWith).toBe('password');
    const response = await request(app).post('/v1/me/deletion').set(authed(session)).send({ password: 'walk1000steps' });
    expect(response.status).toBe(200);
    expect(revoked).toHaveLength(0);
  });

  it('a password account with Apple connected confirms with Apple, so Apple can be revoked', async () => {
    const session = await signUpAndRegister();
    await request(app).post('/v1/me/sign-in-methods/apple').set(authed(session)).send({ idToken: 'tok', nonce: NONCE });

    expect((await request(app).get('/v1/me/deletion').set(authed(session))).body.confirmWith).toBe('apple');
    const byPassword = await request(app).post('/v1/me/deletion').set(authed(session)).send({ password: 'walk1000steps' });
    expect(byPassword.body.error.code).toBe('CONFIRMATION_REQUIRED');

    const byApple = await request(app).post('/v1/me/deletion').set(authed(session)).send({ apple: appleProof });
    expect(byApple.status).toBe(200);
    expect(revoked).toHaveLength(1);
  });

  it('a Google-only account confirms with Google, and only its own', async () => {
    const created = await request(app).post('/v1/auth/google').set(baseHeaders).send({ idToken: 'g' });
    const register = await request(app).post('/v1/devices/register').set(baseHeaders)
      .set('authorization', `Bearer ${created.body.tokens.accessToken}`)
      .set('x-vokve-refresh-token', created.body.tokens.refreshToken)
      .send({ installId: `install-google-${Date.now()}`, vendorId: 'vendor-google', platform: 'android',
        profile: { brand: 'Google', model: 'Pixel 8', osVersion: '14', isEmulator: false, app: { version: '1.0.0', build: '1', bundleId: 'com.vokve' } } });
    const headers = { ...baseHeaders, authorization: `Bearer ${created.body.tokens.accessToken}`, 'x-vokve-device-id': register.body.deviceId };

    expect((await request(app).get('/v1/me/deletion').set(headers)).body.confirmWith).toBe('google');

    setGoogleVerifier(async () => google({ googleId: 'someone-else' }));
    expect((await request(app).post('/v1/me/deletion').set(headers).send({ google: { idToken: 'g2' } })).status).toBe(403);

    setGoogleVerifier(async () => google());
    expect((await request(app).post('/v1/me/deletion').set(headers).send({ google: { idToken: 'g2' } })).status).toBe(200);
  });
});

describe('disconnecting Apple in Security', () => {
  it('needs a fresh Apple sign-in, and revokes with it', async () => {
    const session = await signUpAndRegister();
    await request(app).post('/v1/me/sign-in-methods/apple').set(authed(session)).send({ idToken: 'tok', nonce: NONCE });

    const bare = await request(app).delete('/v1/me/sign-in-methods/apple').set(authed(session));
    expect(bare.status).toBe(422);
    expect(bare.body.error.code).toBe('CONFIRMATION_REQUIRED');

    const confirmed = await request(app).delete('/v1/me/sign-in-methods/apple').set(authed(session)).send({ apple: appleProof });
    expect(confirmed.status).toBe(200);
    expect(revoked).toHaveLength(1);
    expect((await UserModel.findById(session.userId).lean())?.appleId).toBeUndefined();
  });
});
