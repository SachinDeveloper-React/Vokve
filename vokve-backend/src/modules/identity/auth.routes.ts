import { Router } from 'express';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  otpRequestBody, refreshBody, refreshSession, requestContactChange, requestOtp, resendOtp, resendOtpBody, resetPassword,
  resetPasswordBody, sendEmailOtp, sendPhoneOtp, signIn, signInBody, signOut, signUp, signUpBody, verifyOtp, verifyOtpBody,
} from './auth.service.js';
import { z } from 'zod';

export const authRouter = Router();

const meta = (req: Parameters<Parameters<typeof authRouter.post>[1]>[0]) => ({ deviceId: req.ctx.deviceId, ip: req.ip });

// SMS costs money and is an abuse target: tightest limits in the API (RULES Z3).
const otpSendLimits = [
  rateLimit({ name: 'otp-send-ip', max: 20, windowSeconds: 3600, by: 'ip' }),
  rateLimit({ name: 'otp-send-target', max: 10, windowSeconds: 86_400, by: req => req.body?.phone ?? req.body?.identifier }),
];
const otpVerifyLimit = rateLimit({ name: 'otp-verify-ip', max: 30, windowSeconds: 600, by: 'ip' });

authRouter.post('/auth/sign-up', validate('body', signUpBody), ...otpSendLimits, async (req, res) => {
  res.json(await signUp(req.body, meta(req)));
});

authRouter.post('/auth/verify-otp', validate('body', verifyOtpBody), otpVerifyLimit, async (req, res) => {
  res.json(await verifyOtp(req.body.verificationId, req.body.code, meta(req)));
});

authRouter.post('/auth/resend-otp', validate('body', resendOtpBody), rateLimit({ name: 'otp-resend-ip', max: 20, windowSeconds: 3600, by: 'ip' }), async (req, res) => {
  res.json(await resendOtp(req.body.verificationId, meta(req)));
});

authRouter.post('/auth/sign-in', validate('body', signInBody), rateLimit({ name: 'sign-in-ip', max: 30, windowSeconds: 600, by: 'ip' }), async (req, res) => {
  res.json(await signIn(req.body.email, req.body.password, meta(req)));
});

authRouter.post('/auth/refresh', validate('body', refreshBody), async (req, res) => {
  res.json(await refreshSession(req.body.refreshToken, meta(req)));
});

authRouter.post('/auth/sign-out', requireAuth, async (req, res) => {
  res.json(await signOut(req.ctx.userId!, req.ctx.deviceId));
});

authRouter.post('/auth/email/send-otp', requireAuth, rateLimit({ name: 'email-otp-user', max: 5, windowSeconds: 3600, by: 'user' }), async (req, res) => {
  res.json(await sendEmailOtp(req.ctx.userId!, meta(req)));
});

authRouter.post('/auth/phone/send-otp', requireAuth, rateLimit({ name: 'phone-otp-user', max: 5, windowSeconds: 3600, by: 'user' }), async (req, res) => {
  res.json(await sendPhoneOtp(req.ctx.userId!, meta(req)));
});

authRouter.post('/auth/otp/request', validate('body', otpRequestBody), ...otpSendLimits, async (req, res) => {
  res.json(await requestOtp(req.body.identifier, req.body.purpose, meta(req)));
});

/** Always a challenge, real or decoy — the shape never says whether the account exists (RULES O9). */
authRouter.post('/auth/forgot-password', validate('body', otpRequestBody.pick({ identifier: true })), ...otpSendLimits, async (req, res) => {
  res.json(await requestOtp(req.body.identifier, 'reset_password', meta(req)));
});

const changeContactBody = z.object({ value: z.string().trim().min(3).max(120) });

authRouter.post('/auth/change-phone', requireAuth, validate('body', changeContactBody), rateLimit({ name: 'change-contact', max: 5, windowSeconds: 3600, by: 'user' }), async (req, res) => {
  res.json(await requestContactChange(req.ctx.userId!, 'phone', req.body.value, meta(req)));
});

authRouter.post('/auth/change-email', requireAuth, validate('body', changeContactBody), rateLimit({ name: 'change-contact', max: 5, windowSeconds: 3600, by: 'user' }), async (req, res) => {
  res.json(await requestContactChange(req.ctx.userId!, 'email', req.body.value, meta(req)));
});

authRouter.post('/auth/reset-password', validate('body', resetPasswordBody), otpVerifyLimit, async (req, res) => {
  res.json(await resetPassword(req.body.verificationId, req.body.code, req.body.password));
});
