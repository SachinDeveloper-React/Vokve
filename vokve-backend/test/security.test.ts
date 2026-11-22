import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, scrubUrl } from '../src/app.js';
import { env } from '../src/config/env.js';
import { invalidateConfig } from '../src/config/remote.js';
import { getKV } from '../src/db/redis.js';
import { credit } from '../src/modules/economy/service.js';
import { OrderModel } from '../src/modules/commerce/models.js';
import { UserModel } from '../src/modules/identity/models.js';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { verifyPaymentProof } from '../src/lib/payments.js';
import { signAdminSession, signAccessToken } from '../src/lib/tokens.js';
import { totpAt, totpCounter } from '../src/lib/totp.js';
import { app, authed, baseHeaders, signUpAndRegister } from './helpers.js';

/**
 * The pre-deploy security pass (2026-11-21): the operator's second factor,
 * the guesses a burst of parallel requests used to get for free, money
 * orders under the mock gateway, and the edges where the API took more than
 * the app ever sends.
 */

const KEY = 'test-admin-key-test-admin-key';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const IP = '::ffff:127.0.0.1';

async function clearAdminLockout() {
  await getKV().del(`admin-auth-lock:${IP}`);
  await getKV().del(`rl:admin-auth-fail:${IP}`);
  await getKV().del(`rl:admin-session-ip:${IP}`);
}

afterEach(async () => {
  env.ADMIN_TOTP_SECRET = undefined;
  env.JWT_SECRET_PREVIOUS = undefined;
  env.CORS_ORIGINS = undefined;
  env.NODE_ENV = 'test';
  await clearAdminLockout();
});

describe('the operator signs in for a session', () => {
  it('trades the key for a session, and the session opens the admin routes', async () => {
    const signedIn = await request(app).post('/v1/admin/session').send({ key: KEY });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toMatchObject({ token: expect.any(String), mfa: false });
    expect(signedIn.headers['cache-control']).toBe('no-store');

    const users = await request(app).get('/v1/admin/users').set('x-admin-session', signedIn.body.token);
    expect(users.status).toBe(200);
  });

  it('refuses a wrong key, and a member token as a session', async () => {
    expect((await request(app).post('/v1/admin/session').send({ key: 'not-the-key-not-the-key' })).status).toBe(401);

    const member = await signUpAndRegister();
    const asSession = await request(app).get('/v1/admin/users').set('x-admin-session', member.accessToken);
    expect(asSession.status).toBe(401);
  });

  it('a session is never a member session either', async () => {
    const member = await signUpAndRegister();
    const { token } = signAdminSession(true);
    const res = await request(app).get('/v1/me').set({ ...authed(member), authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
  });
});

describe('with an authenticator set up (RULES Z7)', () => {
  it('the key alone opens nothing, and old sessions must sign in again', async () => {
    const before = signAdminSession(false).token;
    env.ADMIN_TOTP_SECRET = SECRET;

    const bare = await request(app).get('/v1/admin/users').set('x-admin-key', KEY);
    expect(bare.status).toBe(401);
    expect(bare.body.error.code).toBe('ADMIN_MFA_REQUIRED');

    const stale = await request(app).get('/v1/admin/users').set('x-admin-session', before);
    expect(stale.body.error.code).toBe('ADMIN_MFA_REQUIRED');

    const noCode = await request(app).post('/v1/admin/session').send({ key: KEY });
    expect(noCode.body.error.code).toBe('ADMIN_MFA_REQUIRED');
  });

  it('key + the current code opens a session, once per code', async () => {
    env.ADMIN_TOTP_SECRET = SECRET;
    const code = totpAt(SECRET, totpCounter());

    const signedIn = await request(app).post('/v1/admin/session').send({ key: KEY, code });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.mfa).toBe(true);
    expect((await request(app).get('/v1/admin/users').set('x-admin-session', signedIn.body.token)).status).toBe(200);

    // Replayed — off the wire, or read over a shoulder — it is already spent.
    const again = await request(app).post('/v1/admin/session').send({ key: KEY, code });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('ADMIN_MFA_INVALID');
  });

  it('refuses a wrong code', async () => {
    env.ADMIN_TOTP_SECRET = SECRET;
    const wrong = String((Number(totpAt(SECRET, totpCounter())) + 1) % 1_000_000).padStart(6, '0');
    const res = await request(app).post('/v1/admin/session').send({ key: KEY, code: wrong });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ADMIN_MFA_INVALID');
  });
});

describe('guessing the admin key', () => {
  it('locks the address out after twenty wrong keys — even for the right one', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await request(app).get('/v1/admin/users').set('x-admin-key', `wrong-${i}`)).status).toBe(401);
    }
    const right = await request(app).get('/v1/admin/users').set('x-admin-key', KEY);
    expect(right.status).toBe(429);
    expect(right.headers['retry-after']).toBe('900');
  });

  it('does not count a request that offered no key at all', async () => {
    for (let i = 0; i < 25; i++) await request(app).get('/v1/admin/users');
    expect((await request(app).get('/v1/admin/users').set('x-admin-key', KEY)).status).toBe(200);
  });
});

describe('rotating the JWT secret (RULES Z1)', () => {
  it('believes a token from the previous secret only while it is named', async () => {
    const member = await signUpAndRegister();
    const old = jwt.sign({ sub: member.userId, tier: 'normal' }, 'the-old-secret-the-old-secret-xx', {
      algorithm: 'HS256', expiresIn: 900, issuer: 'vokve',
    });
    const withOld = { ...authed(member), authorization: `Bearer ${old}` };

    expect((await request(app).get('/v1/me').set(withOld)).status).toBe(401);
    env.JWT_SECRET_PREVIOUS = 'the-old-secret-the-old-secret-xx';
    expect((await request(app).get('/v1/me').set(withOld)).status).toBe(200);
    // New tokens are still signed with the current secret.
    const fresh = signAccessToken({ sub: member.userId, tier: 'normal' }).token;
    expect(() => jwt.verify(fresh, env.JWT_SECRET)).not.toThrow();
  });

  it('does not let the previous secret revive an expired token', async () => {
    const member = await signUpAndRegister();
    env.JWT_SECRET_PREVIOUS = 'the-old-secret-the-old-secret-xx';
    const expired = jwt.sign({ sub: member.userId, tier: 'normal', exp: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET, {
      algorithm: 'HS256', issuer: 'vokve',
    });
    expect((await request(app).get('/v1/me').set({ ...authed(member), authorization: `Bearer ${expired}` })).status).toBe(401);
  });
});

describe('a code guessed by many requests at once (RULES O6)', () => {
  it('compares no more than maxAttempts guesses, however many arrive together', async () => {
    const member = await signUpAndRegister();
    const challenge = await request(app).post('/v1/auth/step-up').set(authed(member)).send({});
    expect(challenge.status).toBe(200);
    const right = challenge.body.devCode as string;
    const wrong = String((Number(right) + 1) % 1_000_000).padStart(6, '0');

    const burst = await Promise.all(
      Array.from({ length: 15 }, () =>
        request(app).post('/v1/auth/verify-otp').set(authed(member)).send({ verificationId: challenge.body.verificationId, code: wrong }),
      ),
    );
    const compared = burst.filter(r => r.body.error?.code === 'OTP_INVALID').length;
    expect(compared).toBeLessThanOrEqual(5);
    expect(burst.every(r => ['OTP_INVALID', 'OTP_TOO_MANY_ATTEMPTS'].includes(r.body.error?.code))).toBe(true);

    // And the right code, after that, is too late.
    const late = await request(app).post('/v1/auth/verify-otp').set(authed(member)).send({ verificationId: challenge.body.verificationId, code: right });
    expect(late.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('a right code sent twice at once opens one session, not two', async () => {
    const member = await signUpAndRegister();
    const challenge = await request(app).post('/v1/auth/step-up').set(authed(member)).send({});
    const send = () => request(app).post('/v1/auth/verify-otp').set(authed(member))
      .send({ verificationId: challenge.body.verificationId, code: challenge.body.devCode });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].filter(s => s === 200)).toHaveLength(1);
  });
});

describe('password guesses spread across addresses (RULES Z3)', () => {
  it('stops at ten for one account, whatever the address', async () => {
    const member = await signUpAndRegister();
    const guess = (email: string) => request(app).post('/v1/auth/sign-in').set(baseHeaders).send({ email, password: 'not-their-password-1' });
    for (let i = 0; i < 10; i++) expect((await guess(member.email)).status).toBe(401);
    // The same account, written differently, is the same bucket.
    const eleventh = await guess(`  ${member.email.toUpperCase()} `);
    expect(eleventh.status).toBe(429);
  });
});

describe('money orders while payments are mocked (RULES R12)', () => {
  it('refuses to take an order that owes money in production, and the mock proof with it', async () => {
    const member = await signUpAndRegister();
    await UserModel.updateOne({ _id: member.userId }, { $set: { phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(), name: 'Asha Verma' } });
    await credit({ userId: member.userId, source: 'refund', referenceType: 'test', referenceId: 'fund', amount: 2_000, title: 'Test funds', localDay: '2026-09-14', exemptFromCap: true });
    const address = await request(app).post('/v1/me/addresses').set(authed(member)).send({
      label: 'Home', name: 'Asha Verma', phone: '+919876543210', line1: '12 MG Road', line2: '', city: 'Bengaluru',
      state: 'Karnataka', postalCode: '560001', country: 'IN', isDefault: true,
    });
    expect(address.status).toBe(201);
    await AppConfigModel.updateOne({ _id: 'commerce' }, { $set: { value: { paymentMode: 'money' } } }, { upsert: true });
    invalidateConfig();

    try {
      expect(env.PAYMENT_PROVIDER).toBe('mock');
      env.NODE_ENV = 'production';
      const placed = await request(app).post('/v1/checkout').set(authed(member))
        .send({ lines: [{ itemId: 'foam-roller', quantity: 1 }], addressId: address.body.id, coins: 0 });
      expect(placed.status).toBe(503);
      expect(placed.body.error.code).toBe('PAYMENT_UNAVAILABLE');
      expect(await OrderModel.countDocuments({ userId: member.userId })).toBe(0);
      expect(verifyPaymentProof('mockord_x', { providerPaymentId: 'pay_made_up' })).toBe(false);
    } finally {
      env.NODE_ENV = 'test';
      await AppConfigModel.deleteOne({ _id: 'commerce' });
      invalidateConfig();
    }
    // Outside production the mock still works end to end, as it must for development.
    expect(verifyPaymentProof('mockord_x', { providerPaymentId: 'pay_made_up' })).toBe(true);
  });
});

describe('what a member may link as their photo', () => {
  it('takes our own media or their Google photo, and nothing else', async () => {
    const member = await signUpAndRegister();
    const patch = (avatarUrl: string | null) => request(app).patch('/v1/me').set(authed(member)).send({ avatarUrl });

    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://tracker.example/pixel.png', 'http://lh3.googleusercontent.com/a/x']) {
      expect((await patch(bad)).status).toBe(422);
    }
    expect((await patch('https://lh3.googleusercontent.com/a/ACg8ocK')).status).toBe(200);
    expect((await patch(`${env.PUBLIC_BASE_URL}/v1/media/avatars/med_1`)).status).toBe(200);
    expect((await patch(null)).status).toBe(200);
  });
});

describe('edges of the request', () => {
  it('reads no large body for a caller with no session', async () => {
    const big = { snapshot: 'x'.repeat(2_000_000) };
    const res = await request(app).post('/v1/activity/ingest').set(baseHeaders).send(big);
    expect(res.status).toBe(401);
  });

  it('takes a request id only when it looks like one', async () => {
    const odd = await request(app).get('/v1/health').set('x-request-id', 'x'.repeat(500));
    expect(odd.headers['x-request-id']).not.toBe('x'.repeat(500));
    const fine = await request(app).get('/v1/health').set('x-request-id', 'req-1234-abcd');
    expect(fine.headers['x-request-id']).toBe('req-1234-abcd');
  });

  it('keeps search words and tokens out of the request log', () => {
    expect(scrubUrl('/v1/admin/users?q=asha%40example.com&limit=20')).toBe('/v1/admin/users?q=redacted&limit=20');
    expect(scrubUrl('/v1/foods?search=paneer&token=abc')).toBe('/v1/foods?search=redacted&token=redacted');
    expect(scrubUrl('/v1/health')).toBe('/v1/health');
  });
});

describe('CORS (RULES Z8)', () => {
  it('answers only the origins named, and avatars to anyone', async () => {
    env.CORS_ORIGINS = 'https://admin.vokve.test';
    const locked = createApp();

    const named = await request(locked).get('/v1/health').set('origin', 'https://admin.vokve.test');
    expect(named.headers['access-control-allow-origin']).toBe('https://admin.vokve.test');
    expect(named.headers['access-control-allow-credentials']).toBeUndefined();

    const other = await request(locked).get('/v1/health').set('origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();

    const avatar = await request(locked).get('/v1/media/avatars/nope').set('origin', 'https://evil.example');
    expect(avatar.headers['access-control-allow-origin']).toBe('*');
  });

  it('in production with no list, no origin at all', async () => {
    env.NODE_ENV = 'production';
    const production = createApp();
    env.NODE_ENV = 'test';

    const res = await request(production).get('/v1/health').set('origin', 'https://anyone.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const avatar = await request(production).get('/v1/media/avatars/nope').set('origin', 'https://anyone.example');
    expect(avatar.headers['access-control-allow-origin']).toBe('*');
  });
});

describe('config paths that are not config (RULES Z8)', () => {
  it('refuses a path through an inherited property, so nothing is written onto Object.prototype', async () => {
    const admin = { 'x-admin-key': KEY };
    for (const path of ['coins.__proto__', 'coins.__proto__.polluted', 'coins.constructor', 'hydration.toString']) {
      const res = await request(app).put('/v1/admin/config').set(admin).send({ set: { [path]: { polluted: true } } });
      expect(res.status).toBe(422);
    }
    const reset = await request(app).put('/v1/admin/config/steps').set(admin).send({ reset: ['coins.constructor'] });
    expect(reset.status).toBe(422);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
