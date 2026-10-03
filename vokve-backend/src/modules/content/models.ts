import { Schema, model } from 'mongoose';

export const CONTENT_TOPICS = ['motivation', 'hydration', 'reminders', 'nutrition', 'health', 'heart_rate', 'blood_pressure'] as const;

/**
 * The app's standing words — tips, the day's motivation line — kept here so
 * they can be written, rotated and corrected without a release. One is
 * shown per topic per day.
 */
const contentTipSchema = new Schema(
  {
    _id: { type: String, required: true },
    topic: { type: String, enum: CONTENT_TOPICS, required: true },
    title: { type: String, default: null },
    text: { type: String, required: true },
    active: { type: Boolean, default: true },
    sort: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'content_tips', versionKey: false },
);
contentTipSchema.index({ topic: 1, active: 1, sort: 1 });
export const ContentTipModel = model('ContentTip', contentTipSchema);
