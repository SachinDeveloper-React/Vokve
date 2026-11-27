import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { setGoogleVerifier } from '../src/lib/googleIdentity.js';
import {
  forgetFacebookKeys,
  setFacebookFetch,
  setFacebookVerifier,
  verifyFacebookAccessToken,
  verifyFacebookLimitedToken,
  type FacebookIdentity,
} from '../src/lib/facebookIdentity.js';
import { purgeAccount } from '../src/modules/account/service.js';
import { UserModel } from '../src/modules/identity/models.js';
import { app, authed, baseHeaders, signUpAndRegister } from './helpers.js';
import { seed } from '../src/seed/seed.js';

/**
 * Signing in with Facebook (RULES O18).
 *
 * The route tests replace the verifier; the first block runs the real one
 * against a fake Graph API, because what it asks Facebook — and what it
 * makes of each answer — is the part that decides who gets in.
 */

const APP_ID = '1351878143619705';
const SECRET = 'test-app-secret-0123456789abcdef';

const facebook = (over: Partial<FacebookIdentity> = {}): FacebookIdentity => ({
  facebookId: '10230000000000001',
  email: 'rana.fb@example.com',
  name: 'Rana Jay',
  ...over,
});

const facebookSignIn = (body: Record<string, unknown> = {}) =>
  request(app).post('/v1/auth/facebook').set(baseHeaders).send({ accessToken: 'EAAtoken', ...body });

/** A Facebook-made account with a registered phone, for the signed-in routes. */
async function facebookAccount() {
  const created = await facebookSignIn();
  expect(created.status).toBe(200);
  const register = await request(app).post('/v1/devices/register').set(baseHeaders)
    .set('authorization', `Bearer ${created.body.tokens.accessToken}`)
    .set('x-vokve-refresh-token', created.body.tokens.refreshToken)
    .send({ installId: `install-fb-${Date.now()}`, vendorId: 'vendor-fb', platform: 'android',
      profile: { brand: 'Google', model: 'Pixel 8', osVersion: '14', isEmulator: false, app: { version: '1.0.0', build: '1', bundleId: 'com.vokve' } } });
  expect(register.status).toBe(200);
  return {
    userId: created.body.user.id as string,
    headers: { ...baseHeaders, authorization: `Bearer ${created.body.tokens.accessToken}`, 'x-vokve-device-id': register.body.deviceId },
  };
}

beforeEach(async () => {
  await seed();
  env.FACEBOOK_APP_ID = APP_ID;
  env.FACEBOOK_APP_SECRET = SECRET;
  setFacebookVerifier(async () => facebook());
});

afterEach(() => {
  setFacebookVerifier(null);
  setFacebookFetch(null);
  env.FACEBOOK_APP_ID = undefined;
  env.FACEBOOK_APP_SECRET = undefined;
});

describe('the verifier', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  /** A Graph API that answers `debug_token` and `/me` as told, and records what it was asked. */
  function graph(debug: () => Response, me: () => Response = () => json(200, { id: '10230000000000001', name: 'Rana Jay', email: 'Rana.FB@Example.com' })) {
    const asked: URL[] = [];
    setFacebookFetch((async (input: string | URL | Request) => {
      const url = new URL(String(input));
      asked.push(url);
      return url.pathname === '/debug_token' ? debug() : me();
    }) as typeof fetch);
    return asked;
  }
  const valid = () => json(200, { data: { app_id: APP_ID, type: 'USER', is_valid: true, user_id: '10230000000000001', scopes: ['email', 'public_profile'] } });

  beforeEach(() => setFacebookVerifier(null));

  it('asks Facebook whose token it is, then who they are, with a proof only the server can make', async () => {
    const asked = graph(valid);

    await expect(verifyFacebookAccessToken('EAAmember')).resolves.toEqual({
      facebookId: '10230000000000001',
      email: 'rana.fb@example.com',
      name: 'Rana Jay',
    });

    expect(asked[0].searchParams.get('input_token')).toBe('EAAmember');
    expect(asked[0].searchParams.get('access_token')).toBe(`${APP_ID}|${SECRET}`);
    expect(asked[1].pathname).toBe('/me');
    expect(asked[1].searchParams.get('access_token')).toBe('EAAmember');
    expect(asked[1].searchParams.get('appsecret_proof')).toBe(crypto.createHmac('sha256', SECRET).update('EAAmember').digest('hex'));
  });

  it('refuses a token issued to some other app', async () => {
    graph(() => json(200, { data: { app_id: '999', type: 'USER', is_valid: true, user_id: '10230000000000001' } }));
    await expect(verifyFacebookAccessToken('EAAother')).rejects.toMatchObject({ status: 401, code: 'FACEBOOK_TOKEN_INVALID' });
  });

  it('refuses an expired token', async () => {
    graph(() => json(200, { data: { app_id: APP_ID, type: 'USER', is_valid: false, error: { code: 190 } } }));
    await expect(verifyFacebookAccessToken('EAAold')).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a token Facebook cannot read (its misleading #100)', async () => {
    graph(() => json(400, { error: { code: 100, type: 'OAuthException', message: 'You must provide an app access token' } }));
    await expect(verifyFacebookAccessToken('garbage')).rejects.toMatchObject({ status: 401 });
  });

  it('refuses when /me names somebody other than the token', async () => {
    graph(valid, () => json(200, { id: '10230000000000999', name: 'Someone' }));
    await expect(verifyFacebookAccessToken('EAAmember')).rejects.toMatchObject({ status: 401 });
  });

  it('is a 503, not a refusal, when our own app secret is wrong', async () => {
    graph(() => json(400, { error: { code: 190, type: 'OAuthException', message: 'Invalid OAuth access token signature.' } }));
    await expect(verifyFacebookAccessToken('EAAmember')).rejects.toMatchObject({ status: 503, code: 'FACEBOOK_SIGN_IN_UNAVAILABLE' });
  });

  it('is a 503 when Facebook does not answer', async () => {
    setFacebookFetch((async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
    await expect(verifyFacebookAccessToken('EAAmember')).rejects.toMatchObject({ status: 503, code: 'FACEBOOK_UNREACHABLE' });
  });

  it('is a 503 on a server that has not been given the app keys', async () => {
    env.FACEBOOK_APP_SECRET = undefined;
    await expect(verifyFacebookAccessToken('EAAmember')).rejects.toMatchObject({ status: 503, code: 'FACEBOOK_SIGN_IN_UNAVAILABLE' });
  });

  it('gives no email when the member did not share one', async () => {
    graph(valid, () => json(200, { id: '10230000000000001', name: 'Rana Jay' }));
    await expect(verifyFacebookAccessToken('EAAmember')).resolves.toMatchObject({ email: null });
  });
});

describe('the iPhone verifier (Limited Login)', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const KID = 'test-kid-1';
  const NONCE = 'a1b2c3d4-0000-4000-8000-limitednonce';

  /** A Limited Login token as Facebook would sign it; `over` bends one thing. */
  const token = (over: Record<string, unknown> = {}, options: { kid?: string; key?: crypto.KeyObject } = {}) =>
    jwt.sign(
      { sub: '10230000000000001', name: 'Rana Jay', email: 'Rana.FB@Example.com', nonce: NONCE, exp: Math.floor(Date.now() / 1000) + 3600, ...over },
      (options.key ?? privateKey).export({ type: 'pkcs1', format: 'pem' }),
      { algorithm: 'RS256', keyid: options.kid ?? KID, issuer: 'https://www.facebook.com', audience: APP_ID },
    );

  let keyFetches = 0;
  beforeEach(() => {
    setFacebookVerifier(null);
    forgetFacebookKeys();
    keyFetches = 0;
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
    setFacebookFetch((async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://limited.facebook.com/.well-known/oauth/openid/jwks/');
      keyFetches += 1;
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }) as typeof fetch);
  });

  it('accepts a token Facebook signed for our app and this nonce, with no Graph call', async () => {
    await expect(verifyFacebookLimitedToken(token(), NONCE)).resolves.toEqual({
      facebookId: '10230000000000001',
      email: 'rana.fb@example.com',
      name: 'Rana Jay',
    });
    // The keys are cached: a second login does not fetch them again.
    await verifyFacebookLimitedToken(token({ jti: 'second-login' }), NONCE);
    expect(keyFetches).toBe(1);
  });

  it('takes each token once — the nonce is the phone\'s own, so it cannot stop a replay (audit 2026-11-27, I-1)', async () => {
    const once = token({ jti: 'replayed' });
    await expect(verifyFacebookLimitedToken(once, NONCE)).resolves.toMatchObject({ facebookId: '10230000000000001' });
    await expect(verifyFacebookLimitedToken(once, NONCE)).rejects.toMatchObject({ status: 401, code: 'FACEBOOK_TOKEN_INVALID' });
  });

  it('refuses a token for another app', async () => {
    const other = jwt.sign({ sub: '1', nonce: NONCE }, privateKey.export({ type: 'pkcs1', format: 'pem' }), {
      algorithm: 'RS256', keyid: KID, issuer: 'https://www.facebook.com', audience: '999', expiresIn: 3600,
    });
    await expect(verifyFacebookLimitedToken(other, NONCE)).rejects.toMatchObject({ status: 401, code: 'FACEBOOK_TOKEN_INVALID' });
  });

  it('refuses a token from anyone but Facebook', async () => {
    const forged = jwt.sign({ sub: '1', nonce: NONCE }, privateKey.export({ type: 'pkcs1', format: 'pem' }), {
      algorithm: 'RS256', keyid: KID, issuer: 'https://evil.example', audience: APP_ID, expiresIn: 3600,
    });
    await expect(verifyFacebookLimitedToken(forged, NONCE)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a token signed with a key that is not Facebook\'s', async () => {
    const stranger = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(verifyFacebookLimitedToken(token({}, { key: stranger }), NONCE)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a token minted for another login (the nonce)', async () => {
    await expect(verifyFacebookLimitedToken(token(), 'some-other-nonce-0000')).rejects.toMatchObject({ status: 401 });
  });

  it('refuses an expired token', async () => {
    await expect(verifyFacebookLimitedToken(token({ exp: Math.floor(Date.now() / 1000) - 3600 }), NONCE)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a key id Facebook never published', async () => {
    await expect(verifyFacebookLimitedToken(token({}, { kid: 'unknown-kid' }), NONCE)).rejects.toMatchObject({ status: 401 });
  });

  it('signs in from an iPhone, to the same account Android\'s token opens', async () => {
    setFacebookVerifier(async () => facebook());
    const android = await facebookSignIn();
    setFacebookVerifier(null);

    const iphone = await request(app).post('/v1/auth/facebook').set(baseHeaders)
      .send({ authenticationToken: token({ email: 'rana.fb@example.com' }), nonce: NONCE, ifNew: 'ask' });

    expect(iphone.status).toBe(200);
    expect(iphone.body.user.id).toBe(android.body.user.id);
  });

  it('takes one proof or the other, never both or half of one', async () => {
    const both = await request(app).post('/v1/auth/facebook').set(baseHeaders).send({ accessToken: 'EAA', authenticationToken: token(), nonce: NONCE });
    expect(both.status).toBe(422);
    const noNonce = await request(app).post('/v1/auth/facebook').set(baseHeaders).send({ authenticationToken: token() });
    expect(noNonce.status).toBe(422);
    expect(noNonce.body.error.details.nonce).toBeDefined();
  });
});

describe('signing in', () => {
  it('makes a new account whose email is not yet proved, and no picture', async () => {
    const response = await facebookSignIn();

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ email: 'rana.fb@example.com', name: 'Rana Jay', emailVerifiedAt: null, avatarUrl: null });
    const stored = await UserModel.findById(response.body.user.id).lean();
    expect(stored?.facebookId).toBe('10230000000000001');
    expect(stored?.passwordHash).toBe('facebook:10230000000000001');
  });

  it('signs a known Facebook account straight back in', async () => {
    const first = await facebookSignIn();
    const again = await facebookSignIn({ ifNew: 'ask' });

    expect(again.status).toBe(200);
    expect(again.body.user.id).toBe(first.body.user.id);
  });

  it('asks before making an account', async () => {
    const before = await UserModel.countDocuments();
    const response = await facebookSignIn({ ifNew: 'ask' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IDENTITY_NOT_LINKED');
    expect(response.body.error.details).toMatchObject({ provider: 'facebook', email: 'rana.fb@example.com', existingAccount: null });
    expect(await UserModel.countDocuments()).toBe(before);
  });

  it('never finds an existing account by the email Facebook reports', async () => {
    const session = await signUpAndRegister();
    setFacebookVerifier(async () => facebook({ email: session.email }));

    const asked = await facebookSignIn({ ifNew: 'ask' });
    expect(asked.status).toBe(409);
    expect(asked.body.error.code).toBe('IDENTITY_NOT_LINKED');
    // But names the account, masked, so the app says "sign in to it once".
    expect(asked.body.error.details.existingAccount).toBe(`u•••@example.com`);
    expect(asked.body.error.details.existingMethods).toEqual(['password']);
    expect(asked.body.error.message).toContain('Sign in to it once');

    // Nor takes the address for a second account.
    const before = await UserModel.countDocuments();
    const created = await request(app).post('/v1/auth/identity/create').set(baseHeaders).send({ linkToken: asked.body.error.details.linkToken });
    expect(created.status).toBe(409);
    expect(created.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(await UserModel.countDocuments()).toBe(before);
    expect((await UserModel.findById(session.userId).lean())?.facebookId).toBeUndefined();
  });

  it('names the way the existing account signs in — "continue with Google"', async () => {
    env.GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
    setGoogleVerifier(async () => ({ googleId: 'google-sub-1', email: 'rana.fb@example.com', emailVerified: true, name: 'Rana Jay', picture: null }));
    try {
      const byGoogle = await request(app).post('/v1/auth/google').set(baseHeaders).send({ idToken: 'g' });
      expect(byGoogle.status).toBe(200);

      const asked = await facebookSignIn({ ifNew: 'ask' });
      expect(asked.status).toBe(409);
      expect(asked.body.error.details).toMatchObject({ existingAccount: 'r•••@example.com', existingMethods: ['google'] });

      // And the password sign-up form says the same, instead of a bare "taken".
      const signUp = await request(app).post('/v1/auth/sign-up').set(baseHeaders)
        .send({ email: 'rana.fb@example.com', phone: '+919812345670', password: 'walk1000steps', dateOfBirth: '1994-03-21', gender: 'female' });
      expect(signUp.status).toBe(422);
      expect(signUp.body.error.details.email).toBe('That email address is already registered with Google. Continue with Google instead.');
    } finally {
      setGoogleVerifier(null);
      env.GOOGLE_WEB_CLIENT_ID = undefined;
    }
  });

  it('cannot make an account without an email', async () => {
    setFacebookVerifier(async () => facebook({ email: null }));
    const response = await facebookSignIn();

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('FACEBOOK_EMAIL_MISSING');
  });

  it('answers 503 on a server without the app keys', async () => {
    setFacebookVerifier(null);
    env.FACEBOOK_APP_ID = undefined;
    const response = await facebookSignIn();

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('FACEBOOK_SIGN_IN_UNAVAILABLE');
  });
});

describe('connecting it to an account that exists', () => {
  it('"I already have an account" connects it after signing in, and Facebook then opens that account', async () => {
    const asked = await facebookSignIn({ ifNew: 'ask' });
    const session = await signUpAndRegister();

    const linked = await request(app).post('/v1/me/sign-in-methods/link').set(authed(session))
      .send({ linkToken: asked.body.error.details.linkToken });
    expect(linked.status).toBe(200);
    expect(linked.body.providers).toContainEqual({ provider: 'facebook', linked: true, canDisconnect: true });

    const again = await facebookSignIn({ ifNew: 'ask' });
    expect(again.status).toBe(200);
    expect(again.body.user.id).toBe(session.userId);
  });

  it('connects from Security with a fresh token, and disconnects without one', async () => {
    const session = await signUpAndRegister();

    const connected = await request(app).post('/v1/me/sign-in-methods/facebook').set(authed(session)).send({ accessToken: 'EAAfresh' });
    expect(connected.status).toBe(200);
    expect((await UserModel.findById(session.userId).lean())?.facebookId).toBe('10230000000000001');

    const gone = await request(app).delete('/v1/me/sign-in-methods/facebook').set(authed(session));
    expect(gone.status).toBe(200);
    expect(gone.body.providers).toContainEqual({ provider: 'facebook', linked: false, canDisconnect: false });
    expect((await UserModel.findById(session.userId).lean())?.facebookId).toBeUndefined();
  });

  it('will not take a Facebook account another member signs in with', async () => {
    await facebookSignIn();
    const session = await signUpAndRegister();

    const response = await request(app).post('/v1/me/sign-in-methods/facebook').set(authed(session)).send({ accessToken: 'EAAfresh' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IDENTITY_IN_USE');
  });

  it('will not disconnect the only way into a Facebook-made account', async () => {
    const account = await facebookAccount();
    const response = await request(app).delete('/v1/me/sign-in-methods/facebook').set(account.headers);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('LAST_SIGN_IN_METHOD');
  });
});

describe('deleting a Facebook-made account', () => {
  it('confirms with Facebook, and only the same Facebook account', async () => {
    const account = await facebookAccount();
    expect((await request(app).get('/v1/me/deletion').set(account.headers)).body.confirmWith).toBe('facebook');

    const bare = await request(app).post('/v1/me/deletion').set(account.headers).send({});
    expect(bare.body.error).toMatchObject({ code: 'CONFIRMATION_REQUIRED', details: { confirmWith: 'facebook' } });

    setFacebookVerifier(async () => facebook({ facebookId: '10230000000000999' }));
    const stranger = await request(app).post('/v1/me/deletion').set(account.headers).send({ facebook: { accessToken: 'EAAother' } });
    expect(stranger.status).toBe(403);
    expect(stranger.body.error.code).toBe('FACEBOOK_ACCOUNT_MISMATCH');

    setFacebookVerifier(async () => facebook());
    const confirmed = await request(app).post('/v1/me/deletion').set(account.headers).send({ facebook: { accessToken: 'EAAfresh' } });
    expect(confirmed.status).toBe(200);
  });

  it('lets go of every provider id when the account is purged, so a return starts afresh', async () => {
    const account = await facebookAccount();
    await UserModel.updateOne({ _id: account.userId }, { $set: { googleId: 'google-sub-purged', appleId: '001234.apple-sub.purged' } });
    await purgeAccount(account.userId);

    const purged = await UserModel.findById(account.userId).lean();
    expect(purged?.facebookId).toBeUndefined();
    expect(purged?.googleId).toBeUndefined();
    expect(purged?.appleId).toBeUndefined();
    const back = await facebookSignIn();
    expect(back.status).toBe(200);
    expect(back.body.user.id).not.toBe(account.userId);
  });
});
