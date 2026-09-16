import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppConfigModel } from '../src/modules/platform/models.js';
import { invalidateConfig } from '../src/config/remote.js';
import { UserModel } from '../src/modules/identity/models.js';
import { NotificationModel } from '../src/modules/notifications/models.js';
import { ReferralModel } from '../src/modules/social/models.js';
import { app, authed, baseHeaders, signUpAndRegister, type Session } from './helpers.js';

/** A plausible workout, the qualifying event (RULES F3). */
function workout(id: string) {
  return {
    id, title: 'Push Day', startedAt: new Date(Date.now() - 45 * 60_000).toISOString(), completedAt: new Date().toISOString(),
    exercises: [{ id: 'we-1', exercise: { id: 'bench', name: 'Barbell Bench Press', muscleGroup: 'chest', equipment: 'barbell', isTimed: false, imageUrl: null },
      sets: [{ id: 's1', reps: 8, weightKg: 60, rpe: null, durationSeconds: null, completed: true }], restSeconds: 90, notes: null }],
    totalVolumeKg: 0, caloriesBurned: 0,
  };
}

async function program(session: Session) {
  const res = await request(app).get('/v1/referrals/me').set(authed(session));
  expect(res.status).toBe(200);
  return res.body;
}

describe('referrals: code, share, apply, qualify (RULES F1–F4, F6)', () => {
  it('gives every user one stable code from the unambiguous alphabet, with the share text and the served amounts', async () => {
    const session = await signUpAndRegister();
    const first = await program(session);
    expect(first.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{7}$/);
    expect(first.shareUrl).toBe(`https://vokve.app/r/${first.code}`);
    expect(first.shareMessage).toContain(first.code);
    expect(first.shareMessage).toContain('20 coins');
    expect(first.rewards).toEqual({ inviter: 20, invitee: 20, qualifier: "your friend's first workout", monthlyInviterCap: 10 });
    expect(first.stats).toEqual({ successful: 0, pending: 0, coinsEarned: 0, rewardedThisMonth: 0 });
    expect(first).toMatchObject({ referrals: [], applied: null, canApply: true });
    expect(first.applyBy).toEqual(expect.any(String));

    // The same code every time, and a different one for someone else.
    expect((await program(session)).code).toBe(first.code);
    const other = await signUpAndRegister();
    expect((await program(other)).code).not.toBe(first.code);
  });

  it('applying a code opens a pending referral for both sides; the first workout pays both', async () => {
    const inviter = await signUpAndRegister();
    const invitee = await signUpAndRegister();
    const { code } = await program(inviter);

    // Typed loosely: lower case with a space, as a person would.
    const applied = await request(app).post('/v1/referrals/apply').set(authed(invitee)).send({ code: ` ${code.slice(0, 3).toLowerCase()} ${code.slice(3)} ` });
    expect(applied.status).toBe(200);
    expect(applied.body.applied).toMatchObject({ code, status: 'pending', rewardCoins: 20 });
    expect(applied.body.canApply).toBe(false);

    const inviterView = await program(inviter);
    expect(inviterView.stats).toMatchObject({ successful: 0, pending: 1, coinsEarned: 0 });
    expect(inviterView.referrals[0]).toMatchObject({ status: 'pending', rewardCoins: 20 });
    expect(inviterView.referrals[0].name).toEqual(expect.any(String));
    expect((await NotificationModel.findOne({ userId: inviter.userId }).lean())?.title).toContain('joined on your code');

    // The invitee's first plausible workout is the qualifying event.
    const saved = await request(app).post('/v1/workouts').set({ ...authed(invitee), 'idempotency-key': 'w1' }).send(workout('wk-1'));
    expect(saved.status).toBe(200);

    const after = await program(inviter);
    expect(after.stats).toMatchObject({ successful: 1, pending: 0, coinsEarned: 20, rewardedThisMonth: 1 });
    expect(after.referrals[0]).toMatchObject({ status: 'rewarded', rewardCoins: 20 });
    expect((await request(app).get('/v1/wallet').set(authed(inviter))).body.balance).toBe(20);
    // The invitee: the workout's 100 plus the 20 welcome bonus.
    expect((await request(app).get('/v1/wallet').set(authed(invitee))).body.balance).toBe(120);
    expect((await program(invitee)).applied).toMatchObject({ status: 'rewarded', rewardCoins: 20 });

    // A second workout pays no second referral.
    await request(app).post('/v1/workouts').set({ ...authed(invitee), 'idempotency-key': 'w2' }).send(workout('wk-2'));
    expect((await request(app).get('/v1/wallet').set(authed(inviter))).body.balance).toBe(20);
    const ledger = await request(app).get('/v1/wallet/transactions').query({ source: 'referral' }).set(authed(invitee));
    expect(ledger.body.data).toHaveLength(1);
  });

  it('refuses a code that is unknown, your own, applied twice, or applied after the window', async () => {
    const inviter = await signUpAndRegister();
    const invitee = await signUpAndRegister();
    const { code } = await program(inviter);

    const unknown = await request(app).post('/v1/referrals/apply').set(authed(invitee)).send({ code: 'ZZZZZZZ' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('REFERRAL_CODE_INVALID');

    const self = await request(app).post('/v1/referrals/apply').set(authed(inviter)).send({ code });
    expect(self.status).toBe(422);
    expect(self.body.error.code).toBe('REFERRAL_SELF');

    expect((await request(app).post('/v1/referrals/apply').set(authed(invitee)).send({ code })).status).toBe(200);
    const twice = await request(app).post('/v1/referrals/apply').set(authed(invitee)).send({ code });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('REFERRAL_ALREADY_APPLIED');

    // Signed up eight days ago: the window has shut.
    const late = await signUpAndRegister();
    // Through the driver: mongoose treats `createdAt` as immutable.
    await UserModel.collection.updateOne({ _id: late.userId as never }, { $set: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    expect((await program(late)).canApply).toBe(false);
    const closed = await request(app).post('/v1/referrals/apply').set(authed(late)).send({ code });
    expect(closed.status).toBe(422);
    expect(closed.body.error.code).toBe('REFERRAL_WINDOW_CLOSED');
  });

  it('the inviter is paid up to the monthly cap; the invitee is paid regardless', async () => {
    await AppConfigModel.updateOne({ _id: 'coins' }, { $set: { value: { referral: { monthlyInviterCap: 1 } } } }, { upsert: true });
    invalidateConfig();
    const inviter = await signUpAndRegister();
    const { code } = await program(inviter);

    for (const n of [1, 2]) {
      const invitee = await signUpAndRegister();
      await request(app).post('/v1/referrals/apply').set(authed(invitee)).send({ code });
      await request(app).post('/v1/workouts').set({ ...authed(invitee), 'idempotency-key': `w${n}` }).send(workout(`wk-${n}`));
      expect((await request(app).get('/v1/wallet').set(authed(invitee))).body.balance).toBe(120);
    }

    const view = await program(inviter);
    expect(view.stats).toMatchObject({ successful: 2, coinsEarned: 20, rewardedThisMonth: 2 });
    expect((await request(app).get('/v1/wallet').set(authed(inviter))).body.balance).toBe(20);
    expect(await ReferralModel.countDocuments({ inviterId: inviter.userId, inviterCapped: true })).toBe(1);

    // Paging the list, newest first.
    const page = await request(app).get('/v1/referrals').query({ limit: 1 }).set(authed(inviter));
    expect(page.body.data).toHaveLength(1);
    expect(page.body.nextCursor).not.toBeNull();
    const rest = await request(app).get('/v1/referrals').query({ limit: 1, cursor: page.body.nextCursor }).set(authed(inviter));
    expect(rest.body.data).toHaveLength(1);
    expect(rest.body.nextCursor).toBeNull();
  });
});

describe('referrals: a code at sign-up', () => {
  it('refuses a bad code on its field before any OTP goes out, and applies a good one when the account is created', async () => {
    const inviter = await signUpAndRegister();
    const { code } = await program(inviter);
    const newcomer = { email: 'newcomer@example.com', phone: '+919876500001', password: 'walk1000steps', dateOfBirth: '1996-01-02', gender: 'male' };

    const bad = await request(app).post('/v1/auth/sign-up').set(baseHeaders).send({ ...newcomer, referralCode: 'NOPE999' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.referralCode).toContain('does not match');

    // Typed loosely, like a person: lower case, a space in the middle.
    const signUp = await request(app).post('/v1/auth/sign-up').set(baseHeaders).send({ ...newcomer, referralCode: ` ${code.slice(0, 3).toLowerCase()} ${code.slice(3)}` });
    expect(signUp.status).toBe(200);
    // Nothing exists yet: the code rides on the challenge until the OTP passes.
    expect(await ReferralModel.countDocuments({ code })).toBe(0);

    const verify = await request(app).post('/v1/auth/verify-otp').set(baseHeaders).send({ verificationId: signUp.body.verificationId, code: signUp.body.devCode });
    expect(verify.status).toBe(200);
    const inviteeId = verify.body.user.id;

    // The referral opened with the account; the inviter sees it at once.
    expect(await ReferralModel.countDocuments({ code, inviteeId, status: 'pending' })).toBe(1);
    const view = await program(inviter);
    expect(view.stats).toMatchObject({ pending: 1, successful: 0 });
    expect((await NotificationModel.findOne({ userId: inviter.userId }).lean())?.title).toContain('joined on your code');

    // The invitee sees it as applied, and cannot apply another.
    const register = await request(app).post('/v1/devices/register').set(baseHeaders)
      .set('authorization', `Bearer ${verify.body.tokens.accessToken}`).set('x-vokve-refresh-token', verify.body.tokens.refreshToken)
      .send({ installId: 'install-newcomer', vendorId: 'vendor-newcomer', platform: 'android',
        profile: { brand: 'Google', model: 'Pixel 8', osVersion: '14', isEmulator: false, app: { version: '1.0.0', build: '1', bundleId: 'com.vokve' } } });
    const session = { ...inviter, userId: inviteeId, accessToken: verify.body.tokens.accessToken, deviceId: register.body.deviceId } as Session;
    const mine = await program(session);
    expect(mine.applied).toMatchObject({ code, status: 'pending', rewardCoins: 20 });
    expect(mine.canApply).toBe(false);
  });

  it('sign-up without a code is unchanged', async () => {
    const session = await signUpAndRegister();
    expect((await program(session)).applied).toBeNull();
  });
});
