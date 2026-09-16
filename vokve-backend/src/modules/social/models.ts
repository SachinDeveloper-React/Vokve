import { Schema, model } from 'mongoose';

/** One code per user (RULES F1); the unique index on `code` is what makes lookups by code safe. */
const referralCodeSchema = new Schema(
  {
    _id: { type: String, required: true }, // userId
    code: { type: String, required: true },
  },
  { timestamps: true, collection: 'referral_codes', versionKey: false },
);
referralCodeSchema.index({ code: 1 }, { unique: true });
export const ReferralCodeModel = model('ReferralCode', referralCodeSchema);

export const REFERRAL_STATUSES = ['pending', 'rewarded', 'voided'] as const;

/**
 * One friend joining on one code (ARCHITECTURE §6 social). The invitee is
 * unique — a code is applied once per person (F2) — and the reward amounts
 * are stamped at qualification so a later config change does not rewrite
 * what was paid. `voided` is F5's outcome, set by the fraud sweep; the
 * client only ever sees pending or rewarded.
 */
const referralSchema = new Schema(
  {
    _id: { type: String, required: true },
    inviterId: { type: String, required: true },
    inviteeId: { type: String, required: true },
    code: { type: String, required: true },
    status: { type: String, enum: REFERRAL_STATUSES, default: 'pending' },
    appliedAt: { type: Date, default: Date.now },
    qualifiedAt: { type: Date, default: null },
    rewardedAt: { type: Date, default: null },
    inviterCoins: { type: Number, default: 0 },
    inviteeCoins: { type: Number, default: 0 },
    /** The inviter's monthly cap was already used up when this one qualified (F4). */
    inviterCapped: { type: Boolean, default: false },
    attribution: { link: String, campaign: String, deviceId: String },
    voidReason: { type: String, default: null },
  },
  { timestamps: true, collection: 'referrals', versionKey: false },
);
referralSchema.index({ inviteeId: 1 }, { unique: true });
referralSchema.index({ inviterId: 1, appliedAt: -1 });
referralSchema.index({ inviterId: 1, status: 1, rewardedAt: -1 });
export const ReferralModel = model('Referral', referralSchema);
