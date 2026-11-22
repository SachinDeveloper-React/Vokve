import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * The people who run VOKVE (RULES Z9) — admins, managers and agents.
 *
 * Their own collections, never `users`: a member and a member of staff are
 * different kinds of account with different doors, and nothing a member can
 * do to their own row may ever reach one of these.
 */

const actorRefSchema = new Schema(
  { id: String, role: String, name: String, email: String },
  { _id: false },
);

const staffSchema = new Schema(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ['admin', 'manager', 'agent'], required: true },
    /** An agent's manager. Null for admins and managers. */
    managerId: { type: String, default: null },
    status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
    /** What was granted. What works is `effectivePermissions` of this and the manager's. */
    permissions: { type: [String], default: [] },
    passwordHash: { type: String, required: true },
    /** True for a password somebody else chose (new account, reset): changed at first sign-in. */
    mustChangePassword: { type: Boolean, default: true },
    passwordChangedAt: { type: Date, default: null },
    totp: {
      /** Encrypted at rest (`crypto.ts`); null until enrolled. */
      secret: { type: String, default: null },
      enabledAt: { type: Date, default: null },
      /** The last 30-second step a code was accepted for — each step opens once. */
      lastStep: { type: Number, default: null },
      pendingSecret: { type: String, default: null },
      pendingAt: { type: Date, default: null },
    },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    lastActiveAt: { type: Date, default: null },
    createdBy: { type: actorRefSchema, default: null },
    suspendedAt: { type: Date, default: null },
    suspendedBy: { type: actorRefSchema, default: null },
    suspendReason: { type: String, default: null },
    deletedAt: { type: Date, default: null },
    /** The address a deleted account had, so the log can still say who it was. */
    formerEmail: { type: String, default: null },
  },
  { timestamps: true, collection: 'staff' },
);
staffSchema.index({ email: 1 }, { unique: true });
staffSchema.index({ role: 1, status: 1 });
staffSchema.index({ managerId: 1, status: 1 });
export const StaffModel = model('Staff', staffSchema);
export type StaffDoc = InferSchemaType<typeof staffSchema> & { _id: string; createdAt: Date; updatedAt: Date };

/**
 * One signed-in browser. Server-side, so a suspension, a reset or "sign out
 * everywhere" takes effect on the very next request — a signed token would
 * stay good until it expired.
 */
const staffSessionSchema = new Schema(
  {
    _id: { type: String, required: true },
    staffId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    /** Pushed forward as the session is used; a quiet tab signs itself out. */
    idleUntil: { type: Date, required: true },
    lastSeenAt: { type: Date, default: null },
    /** The address that reached this server — the panel's own, for a panel sign-in. */
    ip: { type: String, default: null },
    /** The person's own address and browser, as the panel reported them (`x-vokve-operator-*`). */
    clientIp: { type: String, default: null },
    userAgent: { type: String, default: null },
    /** Signed in with an authenticator code. */
    mfa: { type: Boolean, default: false },
    /** Still has to set a password or enrol an authenticator: `@setup` routes only. */
    restricted: { type: Boolean, default: false },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'staff_sessions' },
);
staffSessionSchema.index({ tokenHash: 1 }, { unique: true });
staffSessionSchema.index({ staffId: 1, revokedAt: 1 });
staffSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86_400 });
export const StaffSessionModel = model('StaffSession', staffSessionSchema);

/**
 * Every request a member of staff made, and every sign-in (RULES Z9): who,
 * in which role, under which manager, with which permission, against what,
 * and what came of it. Reads are kept six months, everything else two
 * years.
 */
const staffActivitySchema = new Schema(
  {
    _id: { type: String, required: true },
    at: { type: Date, required: true },
    expireAt: { type: Date, required: true },
    actor: {
      kind: { type: String, required: true }, // staff | root | unknown
      id: { type: String, default: null },
      role: { type: String, default: null },
      name: { type: String, default: null },
      email: { type: String, default: null },
      managerId: { type: String, default: null },
    },
    /** read | write | auth */
    kind: { type: String, required: true },
    /** For auth events: login, login_failed, logout, password_changed, totp_enrolled, locked … */
    event: { type: String, default: null },
    method: { type: String, default: null },
    route: { type: String, default: null },
    path: { type: String, default: null },
    params: { type: Schema.Types.Mixed, default: null },
    query: { type: Schema.Types.Mixed, default: null },
    body: { type: Schema.Types.Mixed, default: null },
    permission: { type: String, default: null },
    status: { type: Number, default: null },
    errorCode: { type: String, default: null },
    ok: { type: Boolean, default: true },
    /** The staff account an action was about, when it was about one. */
    targetStaffId: { type: String, default: null },
    ip: { type: String, default: null },
    /** As the panel reported it; the panel's own address is in `ip`. */
    clientIp: { type: String, default: null },
    userAgent: { type: String, default: null },
    requestId: { type: String, default: null },
    durationMs: { type: Number, default: null },
  },
  { collection: 'staff_activity' },
);
staffActivitySchema.index({ at: -1 });
staffActivitySchema.index({ 'actor.id': 1, at: -1 });
staffActivitySchema.index({ 'actor.managerId': 1, at: -1 });
staffActivitySchema.index({ targetStaffId: 1, at: -1 });
staffActivitySchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
export const StaffActivityModel = model('StaffActivity', staffActivitySchema);
