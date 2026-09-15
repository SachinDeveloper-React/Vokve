import type { RequestHandler } from 'express';
import { Errors } from '../lib/errors.js';
import { UserModel } from '../modules/identity/models.js';

/**
 * Both contact details must be proven before coins leave the account
 * (RULES O5, D-20). Mounted on redeem, payout and address routes; nothing
 * a read-only screen needs sits behind it.
 */
export const requireVerifiedContacts: RequestHandler = async (req, _res, next) => {
  const user = await UserModel.findById(req.ctx.userId, { phoneVerifiedAt: 1, emailVerifiedAt: 1 }).lean();
  if (!user) return next(Errors.unauthorized());
  if (!user.phoneVerifiedAt) return next(Errors.forbidden('PHONE_NOT_VERIFIED', 'Verify your phone number to continue.'));
  if (!user.emailVerifiedAt) return next(Errors.forbidden('EMAIL_NOT_VERIFIED', 'Verify your email address to redeem rewards.'));
  next();
};
