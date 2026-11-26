import { Router } from 'express';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  appleBody, createFromLinkToken, facebookBody, signInWithApple, signInWithFacebook, otpRequestBody, refreshBody, refreshSession, requestContactChange, requestOtp, requestStepUp, resendOtp, resendOtpBody, resetPassword,
  resetPasswordBody, sendEmailOtp, sendPhoneOtp, signIn, signInBody, signInWithGoogle, signOut, signUp, signUpBody,
  verifyOtp, verifyOtpBody,
} from './auth.service.js';
import { z } from 'zod';

export const authRouter = Router();

const meta = (req: Parameters<Parameters<typeof authRouter.post>[1]>[0]) => ({
  deviceId: req.ctx.deviceId,
  ip: req.ip,
  // Kept on the sign-in period, so "when did they sign in" comes with "on
  // which build" (RULES P16).
  appVersion: req.ctx.appVersion,
});

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

/**
 * Password guesses against one account, from however many addresses (RULES
 * Z3). The per-IP limit alone let a credential-stuffing run spread one
 * member's guesses across a botnet without any address ever hitting it.
 * Keyed on the identifier as the account lookup reads it, so `A@x.com` and
 * `a@x.com ` are one bucket. Ten in fifteen minutes is far past a member
 * mistyping, and a member who is locked out still has the code sign-in.
 */
export function signInAccountKey(identifier: unknown): string | undefined {
  if (typeof identifier !== 'string') return undefined;
  const value = identifier.trim().toLowerCase();
  if (!value) return undefined;
  return value.includes('@') ? value : value.replace(/[\s-]/g, '').replace(/^\+?/, '+');
}

authRouter.post('/auth/sign-in', validate('body', signInBody), rateLimit({ name: 'sign-in-ip', max: 30, windowSeconds: 600, by: 'ip' }),
  rateLimit({ name: 'sign-in-account', max: 10, windowSeconds: 900, by: req => signInAccountKey(req.body?.email) }), async (req, res) => {
  res.json(await signIn(req.body.email, req.body.password, meta(req)));
});

/**
 * Signing in with Google (RULES O12).
 *
 * Takes the ID token and nothing else — no email, no name, no id. All
 * three are read out of the token once Google's signature has been
 * checked, because a body that carried them would be a body anybody
 * could write.
 *
 * Limited by IP like the password route: the token is unguessable, but
 * verifying one costs a round trip to Google's keys and the limit is
 * what stops that being somebody else's lever.
 */
const googleBody = z
  .object({
    idToken: z.string().trim().min(1).max(4000),
    /** `ask` on a new client: no account yet means a choice, not a new account (RULES O15). */
    ifNew: z.enum(['create', 'ask']).optional(),
  })
  .strict();

authRouter.post(
  '/auth/google',
  validate('body', googleBody),
  rateLimit({ name: 'sign-in-google-ip', max: 30, windowSeconds: 600, by: 'ip' }),
  async (req, res) => {
    res.json(await signInWithGoogle(req.body.idToken, meta(req), req.body.ifNew ?? 'create'));
  },
);

/**
 * Signing in with Apple (RULES O13).
 *
 * The identity token, the raw nonce it was minted for, and — only on a
 * member's very first Apple sign-in, the one time Apple tells the app —
 * their name. Nothing that says who the member *is*: no email, no id.
 * Limited like the Google route, for the same reason.
 */
authRouter.post(
  '/auth/apple',
  validate('body', appleBody),
  rateLimit({ name: 'sign-in-apple-ip', max: 30, windowSeconds: 600, by: 'ip' }),
  async (req, res) => {
    res.json(await signInWithApple(req.body, meta(req)));
  },
);

/**
 * Signing in with Facebook (RULES O18).
 *
 * Android's access token, or iOS's Limited Login token with its nonce —
 * and nothing that says who the member is. Android's costs two Graph calls
 * to Facebook, so the limit is the Google route's, for the same reason.
 */
authRouter.post(
  '/auth/facebook',
  validate('body', facebookBody),
  rateLimit({ name: 'sign-in-facebook-ip', max: 30, windowSeconds: 600, by: 'ip' }),
  async (req, res) => {
    res.json(await signInWithFacebook(req.body.proof, meta(req), req.body.ifNew ?? 'create'));
  },
);

/**
 * "Create a new account" after a provider sign-in answered
 * `IDENTITY_NOT_LINKED` (RULES O15). The link token is the proof: it names
 * the identity Google, Apple or Facebook just vouched for, for fifteen
 * minutes.
 */
const identityCreateBody = z.object({ linkToken: z.string().trim().min(1).max(4000) }).strict();

authRouter.post(
  '/auth/identity/create',
  validate('body', identityCreateBody),
  rateLimit({ name: 'sign-in-identity-ip', max: 30, windowSeconds: 600, by: 'ip' }),
  async (req, res) => {
    res.json(await createFromLinkToken(req.body.linkToken, meta(req)));
  },
);

authRouter.post('/auth/refresh', validate('body', refreshBody), async (req, res) => {
  res.json(await refreshSession(req.body.refreshToken, meta(req)));
});

authRouter.post('/auth/sign-out', requireAuth, async (req, res) => {
  res.json(await signOut(req.ctx.userId!, req.ctx.deviceId));
});

authRouter.post('/auth/step-up', requireAuth, rateLimit({ name: 'step-up-user', max: 5, windowSeconds: 3600, by: 'user' }), async (req, res) => {
  res.json(await requestStepUp(req.ctx.userId!, meta(req)));
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
