import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { setAppleVerifier, type AppleIdentity } from '../src/lib/appleIdentity.js';
import { setGoogleVerifier } from '../src/lib/googleIdentity.js';
import { UserModel } from '../src/modules/identity/models.js';
import { AuditLogModel } from '../src/modules/platform/models.js';
import { app, baseHeaders, signUpAndRegister } from './helpers.js';
import { seed } from '../src/seed/seed.js';

/**
 * Signing in with Apple (RULES O13).
 *
 * The Google tests' rule — only the token is believed — plus the two
 * things Apple does differently: the name arrives beside the token rather
 * than in it, and the email can be a private relay address or missing.
 * The verifier is replaced; `appleIdentity.test.ts` checks the real one.
 */

const NONCE = 'raw-nonce-0123456789abcdef';

const apple = (over: Partial<AppleIdentity> = {}): AppleIdentity => ({
  appleId: '001234.apple-sub.0001',
  email: 'rana@example.com',
  isPrivateEmail: false,
  ...over,
});

const signInWith = (body: Record<string, unknown>) =>
  request(app).post('/v1/auth/apple').set(baseHeaders).send(body);

let seenNonce: string | null = null;

beforeEach(async () => {
  await seed();
  env.APPLE_CLIENT_IDS = 'com.vokve.fitness,com.vokve.fitness.signin';
  seenNonce = null;
  setAppleVerifier(async (_token, nonce) => {
    seenNonce = nonce;
    return apple();
  });
});

afterEach(() => {
  setAppleVerifier(null);
  setGoogleVerifier(null);
  env.APPLE_CLIENT_IDS = undefined;
});

describe('a first Apple sign-in', () => {
  it('creates an account from the token, with the email already proved', async () => {
    const response = await signInWith({ idToken: 'tok', nonce: NONCE });

    expect(response.status).toBe(200);
    expect(response.body.tokens.accessToken).toBeTruthy();
    expect(response.body.user.email).toBe('rana@example.com');
    expect(response.body.user.emailVerifiedAt).toBeTruthy();
    expect(response.body.user.phone).toBeNull();
    // The verifier is handed the raw nonce the phone sent, to hash and
    // compare with the token's.
    expect(seenNonce).toBe(NONCE);

    const stored = await UserModel.findById(response.body.user.id).lean();
    expect(stored?.appleId).toBe('001234.apple-sub.0001');
    expect(stored?.googleId).toBeUndefined();
    expect(await AuditLogModel.countDocuments({ action: 'user.signup_apple' })).toBe(1);
  });

  it('names the new account from the name Apple gave the phone', async () => {
    const response = await signInWith({
      idToken: 'tok',
      nonce: NONCE,
      fullName: { givenName: 'Rana', familyName: 'Jay' },
    });

    expect(response.status).toBe(200);
    expect(response.body.user.name).toBe('Rana Jay');
  });

  it('works with a private relay address', async () => {
    setAppleVerifier(async () =>
      apple({ email: 'x7k2p9@privaterelay.appleid.com', isPrivateEmail: true }),
    );

    const response = await signInWith({ idToken: 'tok', nonce: NONCE });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('x7k2p9@privaterelay.appleid.com');
  });

  it('signs the same member in again without the email, by Apple id alone', async () => {
    const first = await signInWith({ idToken: 'tok', nonce: NONCE });

    // Later tokens can leave the email out; the `sub` is what matches.
    setAppleVerifier(async () => apple({ email: null }));
    const again = await signInWith({ idToken: 'tok-2', nonce: NONCE });

    expect(again.status).toBe(200);
    expect(again.body.user.id).toBe(first.body.user.id);
    expect(await UserModel.countDocuments({ appleId: { $ne: null } })).toBe(1);
  });

  it('refuses to make an account when Apple shared no email', async () => {
    setAppleVerifier(async () => apple({ email: null }));

    const response = await signInWith({ idToken: 'tok', nonce: NONCE });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('APPLE_EMAIL_MISSING');
    expect(await UserModel.countDocuments({ appleId: { $ne: null } })).toBe(0);
  });
});

describe('what the body may and may not say', () => {
  it('refuses a body that names the member', async () => {
    const response = await signInWith({
      idToken: 'tok',
      nonce: NONCE,
      email: 'owner@vokve.com',
      appleId: 'someone-else',
    });

    expect(response.status).toBe(422);
    expect(await UserModel.countDocuments({ email: 'owner@vokve.com' })).toBe(0);
  });

  it('refuses a sign-in with no nonce', async () => {
    const response = await signInWith({ idToken: 'tok' });
    expect(response.status).toBe(422);
  });

  it('never renames a member who already has a name', async () => {
    const session = await signUpAndRegister();
    const existing = await UserModel.findById(session.userId);
    existing!.name = 'Asha Rao';
    await existing!.save();
    setAppleVerifier(async () => apple({ email: existing!.email }));

    const response = await signInWith({
      idToken: 'tok',
      nonce: NONCE,
      fullName: { givenName: 'Somebody', familyName: 'Else' },
    });

    expect(response.status).toBe(200);
    expect(response.body.user.name).toBe('Asha Rao');
  });
});

describe('an account that already exists', () => {
  it('is linked by its verified email rather than refused as taken', async () => {
    const session = await signUpAndRegister();
    const existing = await UserModel.findById(session.userId).lean();
    setAppleVerifier(async () => apple({ email: existing!.email.toUpperCase() }));

    const response = await signInWith({ idToken: 'tok', nonce: NONCE });

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(session.userId);
    const linked = await UserModel.findById(session.userId).lean();
    expect(linked?.appleId).toBe('001234.apple-sub.0001');
  });

  it('is the same account whichever provider the member presses', async () => {
    setGoogleVerifier(async () => ({
      googleId: 'google-sub-1',
      email: 'rana@example.com',
      emailVerified: true,
      name: 'Rana Jay',
      picture: null,
    }));
    env.GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
    const viaGoogle = await request(app)
      .post('/v1/auth/google')
      .set(baseHeaders)
      .send({ idToken: 'g-tok' });
    env.GOOGLE_WEB_CLIENT_ID = undefined;

    const viaApple = await signInWith({ idToken: 'tok', nonce: NONCE });

    expect(viaApple.status).toBe(200);
    expect(viaApple.body.user.id).toBe(viaGoogle.body.user.id);
    expect(await UserModel.countDocuments({ email: 'rana@example.com' })).toBe(1);
  });

  it('cannot be signed into with the password it was made with', async () => {
    await signInWith({ idToken: 'tok', nonce: NONCE });

    const attempt = await request(app)
      .post('/v1/auth/sign-in')
      .set(baseHeaders)
      .send({ email: 'rana@example.com', password: 'apple:001234.apple-sub.0001' });

    expect(attempt.status).toBe(401);
  });

  it('is not let back in once deleted', async () => {
    const first = await signInWith({ idToken: 'tok', nonce: NONCE });
    await UserModel.updateOne({ _id: first.body.user.id }, { $set: { deletedAt: new Date() } });

    const again = await signInWith({ idToken: 'tok', nonce: NONCE });

    expect(again.status).toBe(401);
  });
});

describe('what it refuses', () => {
  it('refuses a token Apple will not vouch for', async () => {
    setAppleVerifier(async () => {
      throw Object.assign(new Error('bad'), { status: 401, code: 'APPLE_TOKEN_INVALID' });
    });

    const response = await signInWith({ idToken: 'forged', nonce: NONCE });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await UserModel.countDocuments({ appleId: { $ne: null } })).toBe(0);
  });
});

describe('the Android return URL', () => {
  it('answers Apple’s form post without any of the app’s headers', async () => {
    const response = await request(app)
      .post('/v1/auth/apple/callback')
      .type('form')
      .send({ state: 's', code: 'c', id_token: 't' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/html/);
    // Nothing posted there is echoed back into the page.
    expect(response.text).not.toContain('id_token');
  });
});
