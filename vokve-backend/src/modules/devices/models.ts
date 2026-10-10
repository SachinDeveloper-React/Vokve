import { Schema, model } from 'mongoose';

/**
 * One document per (user, install). Three ids on purpose (D-19): the client's
 * installId is canonical, the OS vendorId correlates re-installs, and the
 * attestation key is the one a cheater cannot mint.
 */
const deviceSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    installId: { type: String, required: true },
    vendorId: String,
    platform: { type: String, enum: ['ios', 'android'], required: true },
    info: {
      brand: String, manufacturer: String, model: String, deviceName: String, osVersion: String,
      isEmulator: Boolean, isTablet: Boolean, totalMemoryMb: Number, carrier: String,
      locale: String, timezone: String, screen: { w: Number, h: Number, scale: Number }, hasBiometrics: Boolean,
    },
    app: { version: String, build: String, bundleId: String, firstVersion: String },
    push: { token: String, provider: { type: String, default: 'fcm' }, updatedAt: Date, invalidAt: Date },
    /**
     * When this install last said it had the hydration plan scheduled with
     * the OS itself (RULES Y6).
     *
     * A local alarm fires at the minute, offline, with the member's own
     * sound; a push cannot promise any of the three. So the phone is the one
     * that notifies, and the server's push is the fallback for an account
     * where no install has claimed it lately — a new phone that has not
     * opened the app, or one whose notification permission was refused.
     * Stamped by the device heartbeat, never trusted past
     * `hydration.localScheduleTrustDays`: an install that has gone quiet
     * cannot be relied on to ring.
     */
    remindersScheduledAt: { type: Date, default: null },
    integrity: { provider: String, keyId: String, verdict: String, checkedAt: Date, raw: Schema.Types.Mixed },
    /**
     * The Keystore key this install signs step snapshots with, as accepted
     * by `POST /devices/:id/attestation` (RULES DV2): its public half, and
     * what its certificate chain proved. Kept apart from `integrity`, which
     * every registration rewrites.
     */
    attestation: {
      keyId: String,
      publicKey: String,
      algorithm: String,
      attested: Boolean,
      failure: String,
      securityLevel: String,
      verifiedBootState: String,
      deviceLocked: Boolean,
      attestationVersion: Number,
      packageNames: { type: [String], default: undefined },
      signatureDigests: { type: [String], default: undefined },
      revocationChecked: Boolean,
      verifiedAt: Date,
    },
    /** The challenge the next key must carry. Single use, and short-lived. */
    attestationChallenge: { value: String, expiresAt: Date },
    /** The latest Play Integrity verdict a snapshot from this install carried. */
    playIntegrity: {
      verdict: String,
      reasons: { type: [String], default: undefined },
      deviceRecognition: { type: [String], default: undefined },
      appRecognition: String,
      licensing: String,
      checkedAt: Date,
    },
    signals: { rooted: Boolean, emulator: Boolean, debugBuild: Boolean, hookingFramework: Boolean, mockLocation: Boolean, developerMode: Boolean },
    trust: { score: Number, tier: String },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
    /**
     * When this account counted steps on this install (D-56): a period from
     * each sign-in here to its sign-out, the last one open while signed in.
     * Steps taken outside every period — before the account signed in on
     * this phone, or while it was signed out — are not the account's, and
     * the day's evidence leaves them out. Absent on installs registered
     * before periods were kept: those count whole days until their next
     * sign-in.
     */
    counting: {
      type: [{ _id: false, from: { type: Date, required: true }, to: { type: Date, default: null } }],
      default: undefined,
    },
  },
  { timestamps: true, collection: 'devices' },
);
deviceSchema.index({ userId: 1, installId: 1 }, { unique: true });
deviceSchema.index({ installId: 1 });
deviceSchema.index({ vendorId: 1 }, { sparse: true });
deviceSchema.index({ 'integrity.keyId': 1 }, { sparse: true });
deviceSchema.index({ 'attestation.keyId': 1 }, { sparse: true });
deviceSchema.index({ 'push.token': 1 }, { sparse: true });
deviceSchema.index({ lastSeenAt: -1 });
deviceSchema.index({ 'app.version': 1, platform: 1 });
export const DeviceModel = model('Device', deviceSchema);

const appReleaseSchema = new Schema(
  {
    platform: { type: String, enum: ['ios', 'android'], required: true },
    version: { type: String, required: true },
    build: { type: String, required: true },
    status: { type: String, enum: ['current', 'supported', 'deprecated', 'blocked'], default: 'supported' },
    minOs: String,
    releasedAt: Date,
    notes: String,
  },
  { timestamps: true, collection: 'app_releases' },
);
appReleaseSchema.index({ platform: 1, version: 1, build: 1 }, { unique: true });
export const AppReleaseModel = model('AppRelease', appReleaseSchema);
