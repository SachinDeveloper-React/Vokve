import { Schema, model } from 'mongoose';

const appConfigSchema = new Schema(
  { _id: { type: String, required: true }, value: { type: Schema.Types.Mixed, required: true }, updatedBy: String },
  { timestamps: true, collection: 'app_config' },
);
export const AppConfigModel = model('AppConfig', appConfigSchema);

const auditLogSchema = new Schema(
  {
    actorType: { type: String, required: true }, // user | admin | system
    actorId: String,
    deviceId: String,
    appVersion: String,
    action: { type: String, required: true },
    subjectType: String,
    subjectId: String,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: 'at', updatedAt: false }, collection: 'audit_log' },
);
auditLogSchema.index({ subjectType: 1, subjectId: 1, at: -1 });
export const AuditLogModel = model('AuditLog', auditLogSchema);

/** (userId, key) → stored response, replayed on a retry (BACKEND §3.6). */
const idempotencySchema = new Schema(
  {
    _id: { type: String, required: true }, // `${userId}:${key}`
    status: Number,
    body: Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
  },
  { collection: 'idempotency_keys', versionKey: false },
);
export const IdempotencyModel = model('Idempotency', idempotencySchema);

// The `events` collection lives in `modules/telemetry` now, beside the
// permission snapshots and the operator's reads of both.

/**
 * The catalogue's image library (RULES R18).
 *
 * One row per object in the bucket, which is what makes a bucket usable by
 * a person: S3 holds opaque keys, and an operator looking for the photo of
 * the travel bottle is looking for `bottle-750.jpg`, the name it had on
 * their machine. The filename is kept as a label for exactly that — the
 * picker searches it, and the spreadsheet import matches on it, which is
 * what lets a sheet carry `bottle-750.jpg` in its images column instead of
 * a hundred-character URL nobody can type.
 *
 * A row is written only after the bucket has confirmed the object, so the
 * library never offers a picture that is not there.
 */
const mediaAssetSchema = new Schema(
  {
    _id: { type: String, required: true },
    /** The object's key in the bucket. Ours, never the uploader's filename. */
    key: { type: String, required: true, unique: true },
    /** Where it is read back from, with the CDN in front where there is one. */
    url: { type: String, required: true },
    /** What it was called when it was chosen. The handle a human has for it. */
    filename: { type: String, required: true },
    /** What it is for: `shop`, `food`, `plan`. Narrows the picker. */
    kind: { type: String, required: true },
    contentType: { type: String, required: true },
    bytes: { type: Number, required: true },
    uploadedBy: { type: String, required: true },
  },
  { timestamps: true, collection: 'media_assets' },
);
// The picker and the import both ask the same question — "is there one
// called this" — and the import asks it once per row of a two-thousand-row
// sheet, so the filename is indexed rather than scanned.
mediaAssetSchema.index({ filename: 1 });
mediaAssetSchema.index({ kind: 1, createdAt: -1 });
export const MediaAssetModel = model('MediaAsset', mediaAssetSchema);
