import { Schema, model } from 'mongoose';
import { notificationTopicSchema } from '../../contracts/index.js';

export const NOTIFICATION_TOPICS = notificationTopicSchema.options;

/**
 * The notification centre's feed (BACKEND §6.14). One row per thing that
 * happened to the user, in the shape the client's `AppNotification` reads.
 *
 * `dedupeKey` is the producers' idempotency: a job that runs twice — the
 * expiry warning, a streak-at-risk reminder — names the event it is about,
 * and the partial unique index turns the second insert into an E11000 that
 * `notify()` reports as a duplicate. Rows without a key are free to repeat.
 *
 * `pushDeferredUntil` is a push held back by quiet hours; the hourly tick
 * sends it once the window ends. The feed row itself is never delayed.
 */
const notificationSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    topic: { type: String, enum: NOTIFICATION_TOPICS, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    dedupeKey: { type: String, default: null },
    pushedAt: { type: Date, default: null },
    pushDeferredUntil: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'notifications', versionKey: false },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1 });
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
notificationSchema.index({ pushDeferredUntil: 1 }, { sparse: true });
export const NotificationModel = model('Notification', notificationSchema);
