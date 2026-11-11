import request from 'supertest';
import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { signStepUpToken } from '../src/lib/tokens.js';
import { app, authed, baseHeaders, signUpAndRegister } from './helpers.js';

/**
 * The gates in front of everything else: what counts as a session, which
 * device a request may claim to come from, whose address a limit counts,
 * and what a member may put where the server expects an email, a phone or
 * a search word. Each of these held for the app as it is written and gave
 * way to a request the app would never send.
 */
describe('hardening', () => {
  describe('what counts as a session', () => {
    it('a step-up token is not an access token', async () => {
      // It is signed with the same secret and names the same member, which
      // is the whole of what the access check used to ask. It carries no
      // trust tier, so it was read as `normal` — a restricted account that
      // passed its own OTP held ten minutes of an unrestricted session.
      const session = await signUpAndRegister();
      const stepUp = signStepUpToken(session.userId);

      const asSession = await request(app).get('/v1/me')
        .set({ ...authed(session), authorization: `Bearer ${stepUp}` });
      expect(asSession.status).toBe(401);

      // The real one still is.
      const real = await request(app).get('/v1/me').set(authed(session));
      expect(real.status).toBe(200);
    });

    it('a token signed with another algorithm is refused', async () => {
      const session = await signUpAndRegister();
      const hs512 = jwt.sign({ sub: session.userId, tier: 'trusted' }, process.env.JWT_SECRET!, {
        algorithm: 'HS512', expiresIn: 900, issuer: 'vokve',
      });

      const res = await request(app).get('/v1/me').set({ ...authed(session), authorization: `Bearer ${hs512}` });
      expect(res.status).toBe(401);
    });
  });

  describe('the device a request claims', () => {
    it('a device id nobody registered is refused every time, not only the first', async () => {
      // The heartbeat debounce was set before the device was looked up and
      // left set when the lookup failed, so the second request with the
      // same made-up id found the key and was waved through for five
      // minutes without the database ever being asked again.
      const session = await signUpAndRegister();
      const madeUp = { ...authed(session), 'x-vokve-device-id': 'dev_made_up_by_the_caller' };

      const first = await request(app).get('/v1/me').set(madeUp);
      expect(first.status).toBe(428);
      const second = await request(app).get('/v1/me').set(madeUp);
      expect(second.status).toBe(428);
      expect(second.body.error.code).toBe('DEVICE_NOT_REGISTERED');
    });

    it("another member's device id is refused even while that device is fresh", async () => {
      const owner = await signUpAndRegister();
      const other = await signUpAndRegister();
      // The owner's own request sets the debounce for their device…
      expect((await request(app).get('/v1/me').set(authed(owner))).status).toBe(200);

      // …which must not vouch for somebody else quoting the same id.
      const borrowed = await request(app).get('/v1/me')
        .set({ ...authed(other), 'x-vokve-device-id': owner.deviceId });
      expect(borrowed.status).toBe(428);

      // And the owner is not disturbed by the attempt.
      expect((await request(app).get('/v1/me').set(authed(owner))).status).toBe(200);
    });

    it('a revoked device stays refused on the requests after the first', async () => {
      const session = await signUpAndRegister();
      expect((await request(app).delete(`/v1/me/devices/${session.deviceId}`).set(authed(session))).status).toBe(200);

      expect((await request(app).get('/v1/me').set(authed(session))).status).toBe(428);
      expect((await request(app).get('/v1/me').set(authed(session))).status).toBe(428);
    });
  });

  describe('whose address a limit counts', () => {
    it('counts the address the proxy saw, not the one the caller wrote in front of it', async () => {
      // One hop is trusted: the proxy appends the address it saw to
      // X-Forwarded-For, so the last entry is the caller and everything
      // before it is the caller's own writing. Trusting the whole header
      // let each request name a new address and never meet a per-IP limit.
      const seen = '203.0.113.77';
      const statuses: number[] = [];
      for (let i = 0; i < 31; i += 1) {
        const res = await request(app).post('/v1/auth/verify-otp')
          .set({ ...baseHeaders, 'x-forwarded-for': `198.51.100.${i}, ${seen}` })
          .send({ verificationId: 'no-such-challenge', code: '000000' });
        statuses.push(res.status);
      }
      // Thirty attempts in ten minutes, then the limit — whatever the header claimed.
      expect(statuses.slice(0, 30)).not.toContain(429);
      expect(statuses[30]).toBe(429);
    });
  });

  describe('what a member may write', () => {
    it('a search word is a word, not a pattern', async () => {
      const session = await signUpAndRegister();
      const all = await request(app).get('/v1/exercises').set(authed(session));
      expect(all.status).toBe(200);
      expect(all.body.data.length).toBeGreaterThan(0);

      // `.*` matched every exercise when the word went to Mongo as a regex.
      const pattern = await request(app).get('/v1/exercises').query({ q: '.*' }).set(authed(session));
      expect(pattern.status).toBe(200);
      expect(pattern.body.data).toHaveLength(0);

      // A plain word still finds what it names, in any case.
      const word = String(all.body.data[0].name).split(' ')[0];
      const found = await request(app).get('/v1/exercises').query({ q: word.toUpperCase() }).set(authed(session));
      expect(found.body.data.map((e: { name: string }) => e.name)).toContain(all.body.data[0].name);
    });

    it('a new email has to be one email address', async () => {
      const session = await signUpAndRegister();
      for (const value of [
        'not an email',
        // Two recipients: the mailer would send the code to both.
        'mine@example.com, theirs@example.com',
        '"mine@example.com>"@example.org',
        'Me <mine@example.com>',
      ]) {
        const res = await request(app).post('/v1/auth/change-email').set(authed(session)).send({ value });
        expect({ value, status: res.status }).toEqual({ value, status: 422 });
        expect(res.body.error.details).toHaveProperty('email');
      }
    });

    it('a new phone has to be a phone number', async () => {
      const session = await signUpAndRegister();
      for (const value of ['call me', '+91 98', '+0123456789', '98765x43210']) {
        const res = await request(app).post('/v1/auth/change-phone').set(authed(session)).send({ value });
        expect({ value, status: res.status }).toEqual({ value, status: 422 });
        expect(res.body.error.details).toHaveProperty('phone');
      }
    });
  });
});
