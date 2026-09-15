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
    integrity: { provider: String, keyId: String, verdict: String, checkedAt: Date, raw: Schema.Types.Mixed },
    signals: { rooted: Boolean, emulator: Boolean, debugBuild: Boolean, hookingFramework: Boolean, mockLocation: Boolean, developerMode: Boolean },
    trust: { score: Number, tier: String },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'devices' },
);
deviceSchema.index({ userId: 1, installId: 1 }, { unique: true });
deviceSchema.index({ installId: 1 });
deviceSchema.index({ vendorId: 1 }, { sparse: true });
deviceSchema.index({ 'integrity.keyId': 1 }, { sparse: true });
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
