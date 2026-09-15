import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { invalidateConfig } from '../src/config/remote.js';
import { env } from '../src/config/env.js';
import { setMailTransport } from '../src/lib/mail.js';
import { app, authed, baseHeaders, signUpAndRegister } from './helpers.js';

describe('auth: phone OTP → session → email OTP', () => {
  it('signs up with the code sent to the email, and is signed in with the email proven', async () => {
    const signUp = await request(app).post('/v1/auth/sign-up').set(baseHeaders)
      .send({ email: 'Asha@Example.com', phone: '+919876543210', password: 'walk1000steps', dateOfBirth: '1994-03-21', gender: 'female' });
    expect(signUp.status).toBe(200);
    // otp.signupChannel = email while there is no SMS provider (D-31).
    expect(signUp.body).toMatchObject({ channel: 'email', phone: '', target: 'a•••@example.com', codeLength: 6 });
    expect(signUp.body.devCode).toMatch(/^\d{6}$/);

    // A wrong digit leaves the challenge alive (RULES O6).
    const wrong = await request(app).post('/v1/auth/verify-otp').set(baseHeaders)
      .send({ verificationId: signUp.body.verificationId, code: signUp.body.devCode === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error).toMatchObject({ code: 'OTP_INVALID', details: { attemptsRemaining: 4 } });

    const verify = await request(app).post('/v1/auth/verify-otp').set(baseHeaders)
      .send({ verificationId: signUp.body.verificationId, code: signUp.body.devCode });
    expect(verify.status).toBe(200);
    expect(verify.body.user).toMatchObject({ email: 'asha@example.com', emailVerifiedAt: expect.any(String), phoneVerifiedAt: null, profileCompletedAt: null, country: 'IN' });
    expect(verify.body.tokens.accessToken).toBeTruthy();
    // No SMS provider → no phone challenge is issued; the banner asks later.
    expect(verify.body.nextVerification).toBeNull();

    // The same code cannot be replayed.
    const replay = await request(app).post('/v1/auth/verify-otp').set(baseHeaders)
      .send({ verificationId: signUp.body.verificationId, code: signUp.body.devCode });
    expect(replay.status).toBe(404);

    // Asking for the phone code is refused honestly while SMS does not exist.
    const phone = await request(app).post('/v1/auth/phone/send-otp')
      .set({ ...baseHeaders, authorization: `Bearer ${verify.body.tokens.accessToken}` });
    expect(phone.status).toBe(503);
    expect(phone.body.error.code).toBe('SMS_UNAVAILABLE');
  });

  it('with sign-up on SMS and email deliverable, the email is asked for right after — and actually sent', async () => {
    // The second step is only issued when its channel can really deliver, so
    // stand up a capturing mail transport and pretend SMTP is configured.
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    setMailTransport({ sendMail: async (m: { to: string; subject: string; text: string }) => { sent.push(m); return {}; } } as never);
    Object.assign(env, { SMTP_HOST: 'smtp.test', SMTP_USER: 'u', SMTP_PASS: 'p', MAIL_FROM: 'VOKVE <no-reply@test>' });
    await AppConfigModel.updateOne({ _id: 'otp' }, { $set: { value: { signupChannel: 'sms' } } }, { upsert: true });
    invalidateConfig();

    const signUp = await request(app).post('/v1/auth/sign-up').set(baseHeaders)
      .send({ email: 'sms@example.com', phone: '+919876500000', password: 'walk1000steps', dateOfBirth: '1994-03-21', gender: 'male' });
    expect(signUp.body.channel).toBe('sms');
    const verify = await request(app).post('/v1/auth/verify-otp').set(baseHeaders)
      .send({ verificationId: signUp.body.verificationId, code: signUp.body.devCode });
    expect(verify.body.user).toMatchObject({ phoneVerifiedAt: expect.any(String), emailVerifiedAt: null });
    expect(verify.body.nextVerification).toMatchObject({ channel: 'email', target: 's•••@example.com' });
    expect(verify.body.nextVerification.devCode).toMatch(/^\d{6}$/);

    const email = await request(app).post('/v1/auth/verify-otp').set(baseHeaders)
      .send({ verificationId: verify.body.nextVerification.verificationId, code: verify.body.nextVerification.devCode });
    expect(email.status).toBe(200);
    expect(email.body.user.emailVerifiedAt).toEqual(expect.any(String));
    expect(email.body.nextVerification).toBeNull();

    // The email carried the same code the API echoed, to the right address.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('sms@example.com');
    expect(sent[0].subject).toMatch(/Verify your email/);
    expect(sent[0].text).toContain(verify.body.nextVerification.devCode);

    setMailTransport(null);
    Object.assign(env, { SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, MAIL_FROM: undefined });
  });

  it('rejects a duplicate email or phone with field-level details', async () => {
    const dup = await request(app).post('/v1/auth/sign-up').set(baseHeaders)
      .send({ email: (await signUpAndRegister()).email, phone: '+919999999999', password: 'walk1000steps', dateOfBirth: '1994-03-21', gender: 'male' });
    expect(dup.status).toBe(422);
    expect(dup.body.error.details.email).toMatch(/already registered/);
  });

  it('signs in with a phone number in the email field, and refresh rotates the token', async () => {
    const session = await signUpAndRegister();
    const signIn = await request(app).post('/v1/auth/sign-in').set(baseHeaders)
      .send({ email: `${session.phone.slice(0, 3)} ${session.phone.slice(3, 8)} ${session.phone.slice(8)}`, password: 'walk1000steps' });
    expect(signIn.status).toBe(200);
    expect(signIn.body.user.id).toBe(session.userId);

    const refreshed = await request(app).post('/v1/auth/refresh').set(baseHeaders).send({ refreshToken: signIn.body.tokens.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(signIn.body.tokens.refreshToken);

    const bad = await request(app).post('/v1/auth/sign-in').set(baseHeaders).send({ email: session.email, password: 'nope12345' });
    expect(bad.status).toBe(401);
  });

  it('gates /me on a registered device and stamps profileCompletedAt exactly once', async () => {
    const session = await signUpAndRegister();

    const noDevice = await request(app).get('/v1/me').set({ ...baseHeaders, authorization: `Bearer ${session.accessToken}` });
    expect(noDevice.status).toBe(428);
    expect(noDevice.body.error.code).toBe('DEVICE_NOT_REGISTERED');

    const me = await request(app).get('/v1/me').set(authed(session));
    expect(me.status).toBe(200);
    expect(me.body.profileCompletedAt).toBeNull();

    const complete = await request(app).post('/v1/me/complete-profile').set(authed(session))
      .send({ name: 'Asha Rao', heightCm: 165.5, weightKg: 58.2, units: 'metric' });
    expect(complete.status).toBe(200);
    const stamp = complete.body.profileCompletedAt;
    expect(stamp).toEqual(expect.any(String));

    const patch = await request(app).patch('/v1/me').set(authed(session)).send({ name: 'Asha R', profileCompletedAt: null });
    expect(patch.status).toBe(422); // strict: server-only field rejected

    const again = await request(app).post('/v1/me/complete-profile').set(authed(session))
      .send({ name: 'Asha Rao', heightCm: 166, weightKg: 58, units: 'metric' });
    expect(again.body.profileCompletedAt).toBe(stamp);
  });

  it('syncs settings with the client clamps and notification preferences with defaults', async () => {
    const session = await signUpAndRegister();
    const defaults = await request(app).get('/v1/me/settings').set(authed(session));
    expect(defaults.body).toMatchObject({ dailyStepGoal: 10000, dailyWaterGoalMl: 2500, restTimerSeconds: 90 });
    const tooHigh = await request(app).put('/v1/me/settings').set(authed(session)).send({ dailyStepGoal: 99999 });
    expect(tooHigh.status).toBe(422);
    const prefs = await request(app).get('/v1/me/notification-preferences').set(authed(session));
    expect(prefs.body.categories).toMatchObject({ activity: true, health: false });
    expect(prefs.body.quietHours).toEqual({ enabled: true, start: '22:00', end: '07:00' });
  });

  it('forgot-password returns the same shape for a real and an unknown identifier, and resets the real one', async () => {
    const session = await signUpAndRegister();

    const real = await request(app).post('/v1/auth/forgot-password').set(baseHeaders).send({ identifier: session.email });
    const decoy = await request(app).post('/v1/auth/forgot-password').set(baseHeaders).send({ identifier: 'nobody@example.com' });
    expect(real.status).toBe(200);
    expect(decoy.status).toBe(200);
    expect(Object.keys(decoy.body).sort()).toEqual(Object.keys(real.body).sort());
    expect(real.body.devCode).toMatch(/^\d{6}$/);
    expect(decoy.body.devCode).toBeNull(); // never echoed — a decoy must not be verifiable
    expect(decoy.body.target).toBe('n•••@example.com');

    // A guess against the decoy fails exactly like a wrong code on a real one.
    const guess = await request(app).post('/v1/auth/reset-password').set(baseHeaders)
      .send({ verificationId: decoy.body.verificationId, code: '123456', password: 'newpass123' });
    expect(guess.status).toBe(422);
    expect(guess.body.error.code).toBe('OTP_INVALID');

    const reset = await request(app).post('/v1/auth/reset-password').set(baseHeaders)
      .send({ verificationId: real.body.verificationId, code: real.body.devCode, password: 'newpass123' });
    expect(reset.status).toBe(200);

    const old = await request(app).post('/v1/auth/sign-in').set(baseHeaders).send({ email: session.email, password: 'walk1000steps' });
    expect(old.status).toBe(401);
    const fresh = await request(app).post('/v1/auth/sign-in').set(baseHeaders).send({ email: session.email, password: 'newpass123' });
    expect(fresh.status).toBe(200);
    // Every earlier session was revoked by the reset.
    const stale = await request(app).post('/v1/auth/refresh').set(baseHeaders).send({ refreshToken: session.refreshToken });
    expect(stale.status).toBe(401);
  });

  it('changes the email by proving the new address first, and the old one keeps working until then', async () => {
    const session = await signUpAndRegister();
    const same = await request(app).post('/v1/auth/change-email').set(authed(session)).send({ value: session.email });
    expect(same.status).toBe(422);

    const req = await request(app).post('/v1/auth/change-email').set(authed(session)).send({ value: 'New.Asha@Example.com' });
    expect(req.status).toBe(200);
    expect(req.body).toMatchObject({ channel: 'email', target: 'n•••@example.com' });

    const before = await request(app).get('/v1/me').set(authed(session));
    expect(before.body.email).toBe(session.email);

    const done = await request(app).post('/v1/auth/verify-otp').set(baseHeaders).send({ verificationId: req.body.verificationId, code: req.body.devCode });
    expect(done.status).toBe(200);
    expect(done.body.user.email).toBe('new.asha@example.com');
    expect(done.body.user.emailVerifiedAt).toEqual(expect.any(String));
  });

  it('a code for one purpose never completes another', async () => {
    const session = await signUpAndRegister();
    // A fresh email-verification challenge for this user, presented to
    // reset-password: wrong purpose — even though the code itself is right.
    // (The user already has a verified email, so the challenge is minted
    // directly rather than through send-otp, which would refuse.)
    const { createChallenge } = await import('../src/modules/identity/otp.service.js');
    const challenge = await createChallenge({ channel: 'email', purpose: 'login', target: session.email, userId: session.userId });
    const misuse = await request(app).post('/v1/auth/reset-password').set(baseHeaders)
      .send({ verificationId: challenge.verificationId, code: challenge.devCode!, password: 'newpass123' });
    expect(misuse.status).toBe(400);
    expect(misuse.body.error.code).toBe('OTP_WRONG_PURPOSE');
    // And the consumed sign-up code cannot be reused anywhere either.
    const reuse = await request(app).post('/v1/auth/verify-otp').set(baseHeaders)
      .send({ verificationId: session.signupVerificationId, code: session.signupCode });
    expect(reuse.status).toBe(404);
  });
});
