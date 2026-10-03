import { Schema, model } from 'mongoose';

/**
 * Everything a device has proved, one row per proof: each key attestation
 * it submitted and each Play Integrity verdict a snapshot carried
 * (ARCHITECTURE §6, `attestations`). The device document holds only the
 * latest; this is the history a fraud review reads. Raw tokens are never
 * stored (RULES Z2) — only what was concluded from them.
 */
const attestationRecordSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    provider: { type: String, enum: ['key_attestation', 'play_integrity'], required: true },
    verdict: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: null },
    checkedAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 90 },
  },
  { collection: 'attestations', versionKey: false },
);
attestationRecordSchema.index({ deviceId: 1, checkedAt: -1 });
attestationRecordSchema.index({ userId: 1, checkedAt: -1 });
export const AttestationRecordModel = model('AttestationRecord', attestationRecordSchema);

export const FLAG_LAYERS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'] as const;
export type FlagLayer = (typeof FLAG_LAYERS)[number];

/**
 * What a fraud layer found about one user's day (BACKEND §7.5). `hard`
 * makes the day unverified on its own; `soft` costs score; `info` is kept
 * for the record. One row per (user, day, kind): a day re-scored after a
 * later upload updates its flag rather than stacking copies.
 */
const fraudFlagSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    localDay: { type: String, required: true },
    layer: { type: String, enum: FLAG_LAYERS, required: true },
    kind: { type: String, required: true },
    severity: { type: String, enum: ['hard', 'soft', 'info'], required: true },
    deviceId: { type: String, default: null },
    details: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['open', 'confirmed', 'dismissed'], default: 'open' },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'fraud_flags' },
);
fraudFlagSchema.index({ userId: 1, localDay: 1, kind: 1 }, { unique: true });
fraudFlagSchema.index({ status: 1, severity: 1, createdAt: -1 });
fraudFlagSchema.index({ kind: 1, createdAt: -1 });
export const FraudFlagModel = model('FraudFlag', fraudFlagSchema);
