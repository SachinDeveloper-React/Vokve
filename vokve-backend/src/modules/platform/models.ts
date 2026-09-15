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

const eventSchema = new Schema(
  {
    userId: String,
    deviceId: String,
    appVersion: String,
    platform: String,
    name: { type: String, required: true },
    props: Schema.Types.Mixed,
    at: { type: Date, required: true, expires: 60 * 60 * 24 * 400 },
  },
  { collection: 'events', versionKey: false },
);
eventSchema.index({ userId: 1, at: -1 });
export const EventModel = model('Event', eventSchema);
