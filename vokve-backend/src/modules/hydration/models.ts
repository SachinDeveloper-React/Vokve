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
    sound: { type: String, default: 'default' },
    vibration: { type: Boolean, default: true },
    repeatDays: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
    /**
     * The zone the plan's times are on, kept here as well as on the user so
     * the minute sweep (RULES Y6) can find everyone due at 07:00 in one
     * query per zone instead of reading every member's profile. Written on
     * every save from the calling device's `x-vokve-timezone`; absent on
     * plans stored before the sweep existed, which the sweep falls back to
     * the user's own zone for.
     */
    timezone: { type: String, default: null },
    /**
     * The minute this plan last sent a reminder for, as `YYYY-MM-DDTHH:mm`
     * on the member's own clock.
     *
     * The sweep claims the minute by writing this before it sends, so two
     * instances ticking together cannot both send, and a plan whose morning
     * and custom blocks both hold 10:00 sends one reminder rather than two:
     * the member asked to be reminded at ten, not twice at ten.
     */
    lastSentMinute: { type: String, default: null },
  },
  { timestamps: true, collection: 'hydration_plans', versionKey: false },
);
/** The sweep's query: everyone with a live plan on one zone (RULES Y6). */
hydrationPlanSchema.index({ enabled: 1, timezone: 1 });
export const HydrationPlanModel = model('HydrationPlan', hydrationPlanSchema);
