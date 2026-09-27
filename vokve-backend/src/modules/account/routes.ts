import bcrypt from 'bcryptjs';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ApiError, Errors } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireDevice } from '../../middleware/device.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { signUpBody } from '../identity/auth.service.js';
import { UserModel } from '../identity/models.js';
import { createChallenge, isChannelUsable } from '../identity/otp.service.js';
import {
  avatarBody, cancelDeletion, changePassword, changePasswordBody, createTicket, deleteAccountBody, exportAccount, getAbout,
  getDeletion, getMedia, getPrivacy, getProfileSummary, getTicket, listFaqs, listSessions, listTickets, privacyBody,
  removeAvatar, replyBody, replyToTicket, scheduleDeletion, setAvatar, signOutOtherSessions, ticketBody, updatePrivacy,
} from './service.js';

export const accountRouter = Router();

/** Everything here is the member's own account, so a session and a known device are the floor. */
accountRouter.use(['/me', '/support'], requireAuth, requireDevice);

// ─── Profile ───────────────────────────────────────────────────────────────

/** Everything the account screen draws, in one call (RULES P4, P6). */
accountRouter.get('/me/profile', async (req, res) => {
  res.json(await getProfileSummary(req.ctx.userId!, req.ctx.timezone));
});

// ─── Avatar (RULES P10) ────────────────────────────────────────────────────

/**
 * The photo arrives base64 in JSON rather than as multipart.
 *
 * It is what a phone's picker hands over directly — the library returns the
 * bytes already downscaled and encoded — so there is no file to read and no
 * multipart parser to add for one endpoint. At 512px the payload is tens of
 * kilobytes; base64's third of overhead on that is not worth a dependency.
 */
accountRouter.post(
  '/me/avatar',
  rateLimit({ name: 'avatar-upload-user', max: 10, windowSeconds: 3600, by: 'user' }),
  validate('body', avatarBody),
  async (req, res) => {
    res.json(await setAvatar(req.ctx.userId!, req.body, { deviceId: req.ctx.deviceId }));
  },
);

accountRouter.delete('/me/avatar', async (req, res) => {
  res.json(await removeAvatar(req.ctx.userId!, { deviceId: req.ctx.deviceId }));
});

// ─── Privacy ───────────────────────────────────────────────────────────────

accountRouter.get('/me/privacy', async (req, res) => {
  res.json(await getPrivacy(req.ctx.userId!));
});

accountRouter.put('/me/privacy', validate('body', privacyBody), async (req, res) => {
  res.json(await updatePrivacy(req.ctx.userId!, req.body));
});

// ─── Password ──────────────────────────────────────────────────────────────

/**
 * Rate-limited per user rather than per IP: the guess being defended against
 * is someone with the phone in their hand, not a botnet.
 */
accountRouter.put(
  '/me/password',
  rateLimit({ name: 'password-change-user', max: 5, windowSeconds: 900, by: 'user' }),
  validate('body', changePasswordBody),
  async (req, res) => {
    res.json(await changePassword(req.ctx.userId!, req.body, { deviceId: req.ctx.deviceId }));
  },
);

// ─── Changing the email or the phone (RULES O2) ────────────────────────────

const changeEmailBody = z.object({
  email: signUpBody.shape.email,
  password: z.string().min(1, 'Enter your password'),
}).strict();

const changePhoneBody = z.object({
  phone: signUpBody.shape.phone,
  password: z.string().min(1, 'Enter your password'),
}).strict();

const contactChangeLimit = rateLimit({ name: 'contact-change-user', max: 5, windowSeconds: 3600, by: 'user' });

/**
 * Both contact changes work the same way: the password proves it is the
 * member, then a code is sent **to the new address** and only passing it
 * moves the account (`verify-otp`, purpose `change_email` / `change_phone`).
 * Sending to the new contact rather than the old one is what proves the new
 * one is reachable — an account moved to an address nobody reads is an
 * account locked out.
 *
 * The taken-check is a courtesy, not the guarantee: the unique index is,
 * and `verify-otp` turns its duplicate-key error into the same message.
 */
async function requestContactChange(req: Request, res: Response, kind: 'email' | 'phone') {
  const user = await UserModel.findById(req.ctx.userId);
  if (!user || user.deletedAt) throw Errors.unauthorized();
  const next = kind === 'email' ? (req.body.email as string) : (req.body.phone as string);

  if (!(await bcrypt.compare(req.body.password, user.passwordHash))) {
    throw new ApiError(422, 'PASSWORD_INCORRECT', 'That is not your password.', { password: 'That is not your password.' });
  }
  if (next === (kind === 'email' ? user.email : user.phone)) {
    throw Errors.validation({ [kind]: `That is already your ${kind === 'email' ? 'email address' : 'number'}.` });
  }
  if (await UserModel.exists({ [kind]: next, _id: { $ne: user._id } })) {
    throw Errors.validation({ [kind]: 'That is already registered.' });
  }
  const channel = kind === 'email' ? 'email' : 'sms';
  // Usable, not deliverable: outside production the code is echoed rather
  // than sent, which is how every other OTP flow is exercised here too.
  if (!isChannelUsable(channel)) {
    throw new ApiError(503, 'CHANNEL_UNAVAILABLE', `We cannot send a code by ${kind === 'email' ? 'email' : 'SMS'} yet.`);
  }

  res.json(await createChallenge({
    userId: user._id,
    channel,
    purpose: kind === 'email' ? 'change_email' : 'change_phone',
    target: next,
    payload: { next },
    deviceId: req.ctx.deviceId,
    ip: req.ip,
  }));
}

accountRouter.post('/me/email', contactChangeLimit, validate('body', changeEmailBody), async (req, res) => {
  await requestContactChange(req, res, 'email');
});

accountRouter.post('/me/phone', contactChangeLimit, validate('body', changePhoneBody), async (req, res) => {
  await requestContactChange(req, res, 'phone');
});

// ─── Sessions ──────────────────────────────────────────────────────────────

accountRouter.get('/me/sessions', async (req, res) => {
  res.json({ data: await listSessions(req.ctx.userId!, req.ctx.deviceId), nextCursor: null });
});

/** Signs every device but this one out. The current one leaves by signing out. */
accountRouter.post('/me/sessions/revoke-others', async (req, res) => {
  res.json(await signOutOtherSessions(req.ctx.userId!, req.ctx.deviceId));
});

// ─── Data export and deletion (RULES P5, P8) ───────────────────────────────

accountRouter.get(
  '/me/export',
  rateLimit({ name: 'account-export-user', max: 5, windowSeconds: 86_400, by: 'user' }),
  async (req, res) => {
    res.json(await exportAccount(req.ctx.userId!));
  },
);

accountRouter.get('/me/deletion', async (req, res) => {
  res.json(await getDeletion(req.ctx.userId!));
});

accountRouter.post(
  '/me/deletion',
  rateLimit({ name: 'account-delete-user', max: 5, windowSeconds: 3600, by: 'user' }),
  validate('body', deleteAccountBody),
  async (req, res) => {
    res.json(await scheduleDeletion(req.ctx.userId!, req.body, { deviceId: req.ctx.deviceId }));
  },
);

accountRouter.delete('/me/deletion', async (req, res) => {
  res.json(await cancelDeletion(req.ctx.userId!, { deviceId: req.ctx.deviceId }));
});

// ─── Support ───────────────────────────────────────────────────────────────

const faqQuery = z.object({
  q: z.string().trim().max(60).optional(),
  category: z.enum(['account', 'coins', 'orders', 'tracking', 'payments', 'other']).optional(),
});

accountRouter.get('/support/faqs', validate('query', faqQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof faqQuery>;
  res.json({ data: await listFaqs(q.q, q.category), nextCursor: null });
});

accountRouter.get('/support/tickets', async (req, res) => {
  res.json({ data: await listTickets(req.ctx.userId!), nextCursor: null });
});

accountRouter.post(
  '/support/tickets',
  rateLimit({ name: 'support-ticket-user', max: 5, windowSeconds: 3600, by: 'user' }),
  validate('body', ticketBody),
  async (req, res) => {
    res.status(201).json(await createTicket(req.ctx.userId!, req.body, {
      appVersion: req.ctx.appVersion, platform: req.ctx.platform, osVersion: req.ctx.osVersion, deviceId: req.ctx.deviceId,
    }));
  },
);

accountRouter.get('/support/tickets/:id', async (req, res) => {
  res.json(await getTicket(req.ctx.userId!, String(req.params.id)));
});

accountRouter.post(
  '/support/tickets/:id/replies',
  rateLimit({ name: 'support-reply-user', max: 20, windowSeconds: 3600, by: 'user' }),
  validate('body', replyBody),
  async (req, res) => {
    res.json(await replyToTicket(req.ctx.userId!, String(req.params.id), req.body.message));
  },
);

// ─── About ─────────────────────────────────────────────────────────────────

/**
 * Open, like `/config` and `/health`: the About screen has to be able to say
 * "update required" to a build the version gate is already refusing, and a
 * signed-in-only endpoint could not.
 */
export const aboutRouter = Router();

/**
 * Media is served without a session (RULES P10): an avatar appears beside a
 * review the reader did not write, and a URL that needed the reader's token
 * could not be rendered by anything but the app that fetched it. The id is a
 * uuid, so it is unguessable; the cache header is long and immutable because
 * a new photo is a new id, never an overwrite of this one.
 */
aboutRouter.get('/media/avatars/:id', async (req, res) => {
  const media = await getMedia(String(req.params.id));
  if (!media) throw Errors.notFound('That image');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  // Belt and braces: whatever the type says, nothing here is ever a document.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.type(media.contentType).send(media.data);
});

aboutRouter.get('/app/about', async (req, res) => {
  res.json(await getAbout({ platform: req.ctx.platform, appVersion: req.ctx.appVersion, build: req.ctx.build }));
});
