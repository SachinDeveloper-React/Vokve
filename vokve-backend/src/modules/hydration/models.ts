import { Schema, model } from 'mongoose';

/**
 * One drink (RULES Y1). The id is the app's own, so a log retried after a
 * dropped connection is the same row, not a second glass; its day is the
 * local day of `at`, fixed when written (D2). Deleting keeps the row (D3).
 */
const hydrationEntrySchema = new Schema(
  {
    _id: { type: String, required: true }, // `${userId}:${clientId}`
    userId: { type: String, required: true },
    clientId: { type: String, required: true },
    ml: { type: Number, required: true, min: 1 },
    at: { type: Date, required: true },
    localDay: { type: String, required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'hydration_entries', versionKey: false },
);
hydrationEntrySchema.index({ userId: 1, localDay: 1 });
export const HydrationEntryModel = model('HydrationEntry', hydrationEntrySchema);

/** A member's reminder plan (RULES Y5), one per member, written whole. */
const hydrationPlanSchema = new Schema(
  {
    _id: { type: String, required: true }, // userId
    enabled: { type: Boolean, required: true },
    reminders: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            time: { type: String, required: true },
            slot: { type: String, enum: ['morning', 'afternoon', 'evening', 'custom'], required: true },
            enabled: { type: Boolean, default: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    sound: { type: String, default: 'Default' },
    vibration: { type: Boolean, default: true },
    repeatDays: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
  },
  { timestamps: true, collection: 'hydration_plans', versionKey: false },
);
export const HydrationPlanModel = model('HydrationPlan', hydrationPlanSchema);
