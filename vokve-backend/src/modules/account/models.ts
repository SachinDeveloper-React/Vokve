import { Schema, model } from 'mongoose';
import { supportCategorySchema, supportTicketStatusSchema } from '../../contracts/index.js';

/**
 * A member's choices about their own data (RULES P7). One document per user,
 * created on first read: a missing row means "nothing changed from the
 * defaults", which is what a new account wants anyway.
 */
const privacySchema = new Schema(
  {
    _id: { type: String, required: true }, // userId
    analytics: { type: Boolean, default: true },
    personalisedOffers: { type: Boolean, default: true },
    shareNameWithReferrer: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'account_privacy' },
);
export const AccountPrivacyModel = model('AccountPrivacy', privacySchema);

/**
 * Uploaded images, bytes and all (RULES P10).
 *
 * In the database rather than an object store: an avatar is tens of
 * kilobytes, there are at most one per member, and a deployment that needs
 * a second piece of infrastructure before a profile photo works is a
 * deployment that ships without profile photos. The id is a uuid, so the
 * URL is unguessable and can be served without a session — which is what
 * lets an avatar appear beside a review the reader did not write.
 */
const mediaSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    kind: { type: String, enum: ['avatar'], required: true },
    contentType: { type: String, required: true },
    bytes: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true, collection: 'media' },
);
mediaSchema.index({ userId: 1, kind: 1 });
export const MediaModel = model('Media', mediaSchema);

/**
 * The help centre's articles. A collection rather than a constant so support
 * can answer a wave of the same question by writing one row, without waiting
 * for an app release — which is the whole point of a help centre.
 */
const faqSchema = new Schema(
  {
    _id: { type: String, required: true },
    category: { type: String, enum: supportCategorySchema.options, required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
    /** Extra words the search should match — what users call it, not what we do. */
    tags: { type: [String], default: [] },
    sort: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'support_faqs' },
);
faqSchema.index({ active: 1, category: 1, sort: 1 });
export const SupportFaqModel = model('SupportFaq', faqSchema);

/**
 * One conversation with support. The thread lives on the ticket rather than
 * in its own collection: a ticket is read whole, has a handful of messages,
 * and never needs to be queried across users by message.
 */
const ticketSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    /** Short and quotable — what a member reads out on a call. */
    reference: { type: String, required: true },
    subject: { type: String, required: true },
    category: { type: String, enum: supportCategorySchema.options, required: true },
    status: { type: String, enum: supportTicketStatusSchema.options, default: 'open' },
    messages: [{
      _id: false,
      id: { type: String, required: true },
      from: { type: String, enum: ['user', 'support'], required: true },
      body: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
    }],
    /** What the phone was running when it was opened — the first thing support asks. */
    context: {
      appVersion: String,
      platform: String,
      osVersion: String,
      deviceId: String,
    },
  },
  { timestamps: true, collection: 'support_tickets' },
);
ticketSchema.index({ userId: 1, createdAt: -1 });
ticketSchema.index({ reference: 1 }, { unique: true });
ticketSchema.index({ status: 1, createdAt: -1 });
export const SupportTicketModel = model('SupportTicket', ticketSchema);
