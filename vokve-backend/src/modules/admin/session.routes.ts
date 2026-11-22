import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { getKV } from '../../db/redis.js';
import { ApiError, Errors } from '../../lib/errors.js';
import { verifyTotp } from '../../lib/totp.js';
import { signAdminSession } from '../../lib/tokens.js';
import {
  ADMIN_LOCKOUT_SECONDS, adminKeyMatches, adminLockedOut, isAdminMfaRequired, recordAdminFailure,
} from '../../middleware/admin.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { AuditLogModel } from '../platform/models.js';

/**
 * Signing the panel in (RULES Z7): the admin key, plus the authenticator's
 * six digits where `ADMIN_TOTP_SECRET` is set, exchanged for a twelve-hour
 * session. The panel keeps the session in its cookie instead of the key, so
 * the key is typed once and never sits in a browser.
 *
 * Mounted ahead of the admin routers — it is the one `/admin` path the
 * session gate cannot stand in front of, since it is where sessions come
 * from — and limited twice: ten tries a quarter-hour from one address, and
 * the same failure lockout the gate itself keeps.
 */
export const adminSessionRouter = Router();

const sessionBody = z
  .object({
    key: z.string().min(1).max(512),
    code: z.string().trim().regex(/^\d{6}$/, 'Six digits').optional(),
  })
  .strict();

adminSessionRouter.post(
  '/admin/session',
  rateLimit({ name: 'admin-session-ip', max: 10, windowSeconds: ADMIN_LOCKOUT_SECONDS, by: 'ip' }),
  validate('body', sessionBody),
  async (req, res) => {
    if (!env.ADMIN_API_KEY) throw Errors.notFound('That');
    if (await adminLockedOut(req.ip)) throw Errors.rateLimited(ADMIN_LOCKOUT_SECONDS);

    const body = req.body as z.infer<typeof sessionBody>;
    if (!adminKeyMatches(body.key)) {
      await recordAdminFailure(req.ip);
      throw Errors.unauthorized();
    }

    const mfa = isAdminMfaRequired();
    if (mfa) {
      if (!body.code) throw new ApiError(401, 'ADMIN_MFA_REQUIRED', 'Enter the six-digit code from your authenticator app.');
      const step = verifyTotp(env.ADMIN_TOTP_SECRET!, body.code);
      if (step === null) {
        await recordAdminFailure(req.ip);
        throw new ApiError(401, 'ADMIN_MFA_INVALID', 'That code is not right, or it has expired. Use the one on screen now.');
      }
      // Each code opens one session: one read over a shoulder, or replayed
      // off the wire, is spent by the time anybody else can type it.
      if (!(await getKV().setIfAbsent(`admin-totp-used:${step}`, 120))) {
        throw new ApiError(401, 'ADMIN_MFA_INVALID', 'That code has already been used. Wait for the next one.');
      }
    }

    const session = signAdminSession(mfa);
    await AuditLogModel.create({
      actorType: 'admin', actorId: env.ADMIN_ACTOR, action: 'admin.session',
      subjectType: 'admin', subjectId: env.ADMIN_ACTOR, after: { mfa, ip: req.ip },
    });
    res.set('Cache-Control', 'no-store').json({ token: session.token, expiresAt: session.expiresAt, mfa });
  },
);
