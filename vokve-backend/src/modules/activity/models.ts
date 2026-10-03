import { Schema, model } from 'mongoose';

/** Per-user per-local-day rollup — what `GET /activity/*` reads (BACKEND §7.3). */
const activityDailySchema = new Schema(
  {
    _id: { type: String, required: true }, // `${userId}:${localDay}`
    userId: { type: String, required: true },
    localDay: { type: String, required: true },
    steps: { type: Number, default: 0 },
    verifiedSteps: { type: Number, default: 0 },
    pedometerSteps: { type: Number, default: null },
    distanceKm: { type: Number, default: 0 },
    activeMinutes: { type: Number, default: 0 },
    /** Workout calories — `POST /workouts` adds to it. */
    caloriesBurned: { type: Number, default: 0 },
    /** Walking calories, set by the step rollup. The day's figure is the two together. */
    stepCalories: { type: Number, default: 0 },
    workoutsCompleted: { type: Number, default: 0 },
    hourly: { type: [Number], default: undefined },
    source: { type: String, default: null },
    verified: { type: Boolean, default: false },
    plausibility: { type: Number, default: null },
    flags: { type: [String], default: [] },
    /** Each fraud layer's score for the day, 0–100; null for a layer with nothing to judge. */
    layers: { type: Schema.Types.Mixed, default: undefined },
    /** The flags that made the day unverified on their own (RULES A20). */
    hardRejects: { type: [String], default: undefined },
    /** How many of the user's devices sent the day; their counts are never added. */
    deviceCount: { type: Number, default: undefined },
    /**
     * How the day was decided, device by device and source by source — what
     * `GET /activity/sources` shows. Written with the score, so it is the
     * decision as it was made, not a re-run under today's config.
     */
    breakdown: { type: Schema.Types.Mixed, default: undefined },
    scoredAt: { type: Date, default: undefined },
    /** High-water mark: steps already paid or held for this day (RULES A4). */
    stepsCredited: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'activity_daily' },
);
activityDailySchema.index({ userId: 1, localDay: -1 });
export const ActivityDailyModel = model('ActivityDaily', activityDailySchema);

/**
 * Single-use values for signed step snapshots (BACKEND §7.3). Spent by the
 * ingest that carries one; the TTL index sweeps the ones never used.
 */
const ingestNonceSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { collection: 'ingest_nonces', versionKey: false },
);
export const IngestNonceModel = model('IngestNonce', ingestNonceSchema);

/**
 * Every snapshot accepted, in brief: what it said, and the answer it got.
 * The unique hash is the dedupe (RULES A10) — the same snapshot sent again
 * is answered from here — and the rows of one day are its timeline, so a
 * count that moved backwards between two uploads is visible.
 */
const stepUploadSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    localDay: { type: String, required: true },
    payloadSha256: { type: String, required: true },
    keyId: { type: String, required: true },
    signedAt: { type: Date, required: true },
    deviceSteps: Number,
    recoveredSteps: Number,
    suspectSteps: Number,
    resolvedSteps: Number,
    integrityVerdict: { type: String, default: null },
    appVersion: String,
    /** The response the upload got, replayed to a duplicate. */
    response: { type: Schema.Types.Mixed, default: null },
    receivedAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 400 },
  },
  { collection: 'step_uploads', versionKey: false },
);
stepUploadSchema.index({ userId: 1, payloadSha256: 1 }, { unique: true });
stepUploadSchema.index({ userId: 1, localDay: 1, receivedAt: -1 });
export const StepUploadModel = model('StepUpload', stepUploadSchema);

/**
 * The latest signed snapshot of each device-day, exactly as it was signed
 * (RULES D4) — the evidence a review re-verifies. A newer one for the same
 * device-day takes its place; what the earlier ones said stays in
 * `step_uploads`, and their raw records in `activity_samples`. Expires with
 * ⚙ `activity.rawSnapshotRetentionDays`: a day's minutes, windows and
 * records are several hundred kilobytes, and the hold window is days.
 */
const stepSnapshotSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${deviceId}:${localDay}`
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    localDay: { type: String, required: true },
    uploadId: { type: String, required: true },
    keyId: { type: String, required: true },
    signature: { type: String, required: true },
    signedPayload: { type: String, required: true },
    payloadSha256: { type: String, required: true },
    signedAt: { type: Date, required: true },
    receivedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { collection: 'step_snapshots', versionKey: false },
);
stepSnapshotSchema.index({ userId: 1, localDay: 1 });
export const StepSnapshotModel = model('StepSnapshot', stepSnapshotSchema);

/**
 * What the scoring reads about one device's day: the evidence in its latest
 * snapshot, boiled down (see `snapshot.ts`). Kept small and kept as long as
 * the day, so a day can be re-scored long after its raw snapshot is gone.
 */
const deviceDaySchema = new Schema(
  {
    _id: { type: String, required: true }, // `${deviceId}:${localDay}`
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    localDay: { type: String, required: true },
    uploadId: { type: String, required: true },
    signedAt: { type: Date, required: true },
    evidence: { type: Schema.Types.Mixed, required: true },
    /**
     * What vouched for the snapshot when it arrived: the key that signed it
     * and the Play verdict standing then. Kept with the day, because the
     * device may attest a new key later and the day was proved by the old.
     */
    proof: { type: Schema.Types.Mixed, required: true },
    /** The newest Health Connect record and motion window stored, so a later snapshot adds only what is new. */
    lastRecordModifiedAt: { type: Number, default: 0 },
    lastWindowStartedAt: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'device_days' },
);
deviceDaySchema.index({ userId: 1, localDay: 1 });
export const DeviceDayModel = model('DeviceDay', deviceDaySchema);

/**
 * Raw Health Connect records, one row per version of a record and never
 * changed (RULES A10, D4): the id carries the record's last-modified time,
 * so a record the writing app edited later is a second row, not an edit.
 */
const activitySampleSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${userId}:hc:${recordId}:${lastModifiedTime}`
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    localDay: { type: String, required: true },
    provider: { type: String, default: 'health_connect' },
    sampleId: { type: String, required: true },
    recordType: { type: String, enum: ['steps', 'distance'], required: true },
    value: { type: Number, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    origin: { type: String, required: true },
    recordingMethod: { type: String, default: 'unknown' },
    device: { type: Schema.Types.Mixed, default: null },
    lastModifiedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: Date.now },
  },
  { collection: 'activity_samples', versionKey: false },
);
activitySampleSchema.index({ userId: 1, localDay: 1 });
activitySampleSchema.index({ origin: 1, receivedAt: -1 });
export const ActivitySampleModel = model('ActivitySample', activitySampleSchema);

/** Motion features, never samples (RULES A16, D-23), classified as they arrive. */
const motionWindowSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${deviceId}:${startedAt}`
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    localDay: { type: String, required: true },
    startedAt: { type: Date, required: true },
    durationMs: Number,
    sampleCount: Number,
    dominantFrequencyHz: Number,
    variance: Number,
    zeroCrossingRate: Number,
    peakRatio: Number,
    stepsDuringWindow: Number,
    class: { type: String, enum: ['walk', 'shake', 'still', 'other', 'idle'], required: true },
  },
  { collection: 'motion_windows', versionKey: false },
);
motionWindowSchema.index({ userId: 1, localDay: 1 });
export const MotionWindowModel = model('MotionWindow', motionWindowSchema);
