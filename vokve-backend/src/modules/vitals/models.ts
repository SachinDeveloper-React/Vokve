import { Schema, model } from 'mongoose';

/** What can be entered (RULES V1): BMI is derived, never logged. */
export const ENTERED_VITAL_KINDS = ['heart_rate', 'blood_pressure', 'weight'] as const;
export type EnteredVitalKind = (typeof ENTERED_VITAL_KINDS)[number];

/**
 * One reading (RULES V1, V2). The id is the app's own, so a log retried
 * after a dropped connection is the same reading. `secondary` is the
 * diastolic half of a blood pressure. Readings from a health store would
 * carry their provider in `source` (V10); the app's are `manual`.
 */
const vitalReadingSchema = new Schema(
  {
    _id: { type: String, required: true }, // `${userId}:${clientId}`
    userId: { type: String, required: true },
    clientId: { type: String, required: true },
    kind: { type: String, enum: ENTERED_VITAL_KINDS, required: true },
    value: { type: Number, required: true },
    secondary: { type: Number, default: null },
    recordedAt: { type: Date, required: true },
    source: { type: String, default: 'manual' },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'vital_readings', versionKey: false },
);
vitalReadingSchema.index({ userId: 1, kind: 1, recordedAt: -1 });
vitalReadingSchema.index({ userId: 1, recordedAt: -1 });
export const VitalReadingModel = model('VitalReading', vitalReadingSchema);
