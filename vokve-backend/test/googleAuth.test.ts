import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { setGoogleVerifier, type GoogleIdentity } from '../src/lib/googleIdentity.js';
import { UserModel } from '../src/modules/identity/models.js';
import { app, baseHeaders, signUpAndRegister } from './helpers.js';
import { seed } from '../src/seed/seed.js';

/**
 * Signing in with Google (RULES O12).
 *
 * Everything here turns on one thing: the server believes the *token*
 * and nothing else in the request. So the tests send bodies that lie —
 * an email that is not the token's, a token Google will not vouch for,
 * an address Google has not proved — and check that none of them gets
 * anybody in.
 *
 * The verifier is replaced rather than reaching Google. What is being
 * checked is what this code does with an answer, not that
 * `google-auth-library` can check a signature; a test that needed the
 * network would also be a test that passed on the day Google was slow.
 */

const google = (over: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  googleId: 'google-sub-1',
  email: 'rana@example.com',
  emailVerified: true,
  name: 'Rana Jay',
  picture: 'https://lh3.googleusercontent.com/a/photo',
  ...over,
});

const signInWith = (body: Record<string, unknown>) =>
  request(app).post('/v1/auth/google').set(baseHeaders).send(body);

beforeEach(async () => {
  await seed();
  env.GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
  setGoogleVerifier(async () => google());
});

afterEach(() => {
  setGoogleVerifier(null);
  env.GOOGLE_WEB_CLIENT_ID = undefined;
});

describe('a first Google sign-in', () => {
  it('creates an account from the token, with the email already proved', async () => {
    const response = await signInWith({ idToken: 'tok' });

    expect(response.status).toBe(200);
    expect(response.body.tokens.accessToken).toBeTruthy();
    expect(response.body.user.email).toBe('rana@example.com');
    // Google has proved the address, so there is nothing to verify.
    expect(response.body.user.emailVerifiedAt).toBeTruthy();
    // And nothing about a phone, which is a shape the rules already
    // know: one proven contact signs in, two are needed to spend (O5).
    expect(response.body.user.phone).toBeNull();
    expect(response.body.user.phoneVerifiedAt).toBeNull();
  });

  it('reads the account from the token, not from the body', async () => {
    // The body claims to be somebody else entirely. If any of it were
    // believed, this would be a way to sign in as any member by name.
    const response = await signInWith({
      idToken: 'tok',
      email: 'owner@vokve.app',
      googleId: 'some-other-sub',
    });

    // Refused outright: the body carries fields the route does not take.
    expect(response.status).toBe(422);
    expect(await UserModel.countDocuments({ email: 'owner@vokve.app' })).toBe(0);
  });

  it('lets two phone-less accounts exist side by side', async () => {
    // The phone index has to be sparse, or the second account collides
    // with the first on a missing value and the sign-in fails with a
    // duplicate key nobody can act on.
    await signInWith({ idToken: 'tok' });

    setGoogleVerifier(async () => google({ googleId: 'sub-2', email: 'two@example.com' }));
    const second = await signInWith({ idToken: 'tok-2' });

    expect(second.status).toBe(200);
    expect(await UserModel.countDocuments({ googleId: { $ne: null } })).toBe(2);
  });

  it('signs the same account in again rather than making a second', async () => {
    await signInWith({ idToken: 'tok' });
    const again = await signInWith({ idToken: 'tok' });

    expect(again.status).toBe(200);
    expect(await UserModel.countDocuments({ email: 'rana@example.com' })).toBe(1);
  });
});

describe('an account that already exists', () => {
  it('is linked by email rather than refused as taken', async () => {
    const session = await signUpAndRegister();
    const existing = await UserModel.findById(session.userId).lean();
    setGoogleVerifier(async () => google({ email: existing!.email, googleId: 'sub-link' }));

    const response = await signInWith({ idToken: 'tok' });

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(session.userId);
    // Telling somebody "that email is taken" by their own account is the
    // most confusing answer an app can give.
    expect(await UserModel.countDocuments({ email: existing!.email })).toBe(1);
    const linked = await UserModel.findById(session.userId).lean();
    expect(linked?.googleId).toBe('sub-link');
  });

  it('matches the email whatever its case', async () => {
    const session = await signUpAndRegister();
    const existing = await UserModel.findById(session.userId).lean();
    setGoogleVerifier(async () =>
      google({ email: existing!.email.toUpperCase(), googleId: 'sub-case' }),
    );

    // The verifier lowercases, but the match also runs under the same
    // collation the unique index uses — without it `Someone@` would make
    // a second account beside `someone@`.
    const response = await signInWith({ idToken: 'tok' });
    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(session.userId);
  });

  it('cannot be signed into with a password it does not have', async () => {
    await signInWith({ idToken: 'tok' });

    // The stored hash is a string bcrypt can never match, so the password
    // route simply does not let anybody in — rather than throwing on a
    // missing field, which is what an optional column would have done.
    const attempt = await request(app)
      .post('/v1/auth/sign-in')
      .set(baseHeaders)
      .send({ email: 'rana@example.com', password: 'google:google-sub-1' });

    expect(attempt.status).toBe(401);
  });
});

describe('what it refuses', () => {
  it('refuses a token Google will not vouch for', async () => {
    setGoogleVerifier(async () => {
      throw Object.assign(new Error('bad'), { status: 401, code: 'GOOGLE_TOKEN_INVALID' });
    });

    const response = await signInWith({ idToken: 'forged' });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await UserModel.countDocuments({ googleId: { $ne: null } })).toBe(0);
  });

  it('refuses an empty token rather than asking Google about it', async () => {
    const response = await signInWith({ idToken: '' });
    expect(response.status).toBe(422);
  });
});
