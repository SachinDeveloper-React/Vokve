import { Schema, model } from 'mongoose';

export const COIN_SOURCES = ['steps', 'workout', 'streak', 'challenge', 'referral', 'purchase', 'refund'] as const;
export type CoinSource = (typeof COIN_SOURCES)[number];

/**
 * Append-only. Amounts are milli-coins (D-27). The unique index is the
 * anti-double-pay guarantee (RULES E7): a second credit for the same event is
 * an E11000, which `credit()` treats as "already done".
 */
const ledgerSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    amountMc: { type: Number, required: true, validate: (v: number) => Number.isInteger(v) && v !== 0 },
    source: { type: String, enum: COIN_SOURCES, required: true },
    title: { type: String, required: true },
    referenceType: { type: String, required: true },
    referenceId: { type: String, required: true },
    idempotencyKey: { type: String, default: null },
    holdId: { type: String, default: null },
    actor: { type: String, default: 'system' },
    deviceId: String,
    appVersion: String,
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'coin_ledger', versionKey: false },
);
ledgerSchema.index({ userId: 1, source: 1, referenceType: 1, referenceId: 1 }, { unique: true });
ledgerSchema.index({ userId: 1, createdAt: -1 });
ledgerSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
export const CoinLedgerModel = model('CoinLedger', ledgerSchema);

const balanceSchema = new Schema(
  {
    _id: { type: String, required: true },
    balanceMc: { type: Number, default: 0, min: 0 },
    pendingMc: { type: Number, default: 0, min: 0 },
    lifetimeEarnedMc: { type: Number, default: 0, min: 0 },
    lastCreditAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'coin_balances' },
);
export const CoinBalanceModel = model('CoinBalance', balanceSchema);

/**
 * The daily ceiling (RULES E8, BACKEND §8.2.1). One doc per user per local
 * day; the conditional `$inc` in `applyCaps()` is what makes two concurrent
 * credits unable to both pass.
 */
const dailyCapSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${userId}:${localDay}`
    userId: { type: String, required: true },
    localDay: { type: String, required: true },
    totalMc: { type: Number, default: 0 },
    bySource: { type: Map, of: Number, default: {} },
    cappedMc: { type: Number, default: 0 },
    workoutCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'coin_daily_caps' },
);
dailyCapSchema.index({ userId: 1, localDay: -1 });
export const CoinDailyCapModel = model('CoinDailyCap', dailyCapSchema);

/** Escrow for step coins (RULES E15). Released or voided by a job, never spent while held. */
const holdSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    amountMc: { type: Number, required: true },
    source: { type: String, enum: COIN_SOURCES, required: true },
    title: { type: String, required: true },
    referenceType: { type: String, required: true },
    referenceId: { type: String, required: true },
    releaseAfter: { type: Date, default: null },
    status: { type: String, enum: ['held', 'released', 'voided'], default: 'held' },
    reason: { type: String, default: null },
  },
  { timestamps: true, collection: 'coin_holds' },
);
holdSchema.index({ userId: 1, source: 1, referenceType: 1, referenceId: 1 }, { unique: true });
holdSchema.index({ status: 1, releaseAfter: 1 });
export const CoinHoldModel = model('CoinHold', holdSchema);
