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
    caloriesBurned: { type: Number, default: 0 },
    workoutsCompleted: { type: Number, default: 0 },
    hourly: { type: [Number], default: undefined },
    source: { type: String, default: null },
    verified: { type: Boolean, default: false },
    plausibility: { type: Number, default: null },
    flags: { type: [String], default: [] },
    /** High-water mark: steps already paid or held for this day (RULES A4). */
    stepsCredited: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'activity_daily' },
);
activityDailySchema.index({ userId: 1, localDay: -1 });
export const ActivityDailyModel = model('ActivityDaily', activityDailySchema);
