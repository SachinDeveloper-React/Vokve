import { Schema, model } from 'mongoose';
import { SITE_ENQUIRY_STATUSES } from '../../contracts/site.js';

/**
 * The public website's content (RULES P22).
 *
 * One row per page the panel has saved; a page with no row is served from
 * the shipped copy (`defaults/`). `revision` counts saves and is what a save
 * must name to go through — two people editing the same page cannot quietly
 * undo each other.
 */
const sitePageSchema = new Schema(
  {
    /** The page's key: `config`, `home`, `about`, `faq`, `contact`, `legal`, `deletion`, `licenses`, `invite`. */
    _id: { type: String, required: true },
    content: { type: Schema.Types.Mixed, required: true },
    revision: { type: Number, required: true },
    updatedBy: { type: String, required: true },
  },
  { timestamps: true, collection: 'site_pages', versionKey: false, minimize: false },
);
export const SitePageModel = model('SitePage', sitePageSchema);

/**
 * A policy or other text page, by its web address (`privacy` → /privacy).
 * The shipped five are served from the defaults until saved; anything else
 * exists only here. `published`/`listing` live inside `content` because the
 * panel edits them in the same form as the text.
 */
const siteDocumentSchema = new Schema(
  {
    _id: { type: String, required: true },
    content: { type: Schema.Types.Mixed, required: true },
    revision: { type: Number, required: true },
    updatedBy: { type: String, required: true },
  },
  { timestamps: true, collection: 'site_documents', versionKey: false, minimize: false },
);
export const SiteDocumentModel = model('SiteDocument', siteDocumentSchema);

/**
 * Every saved version of a page or a document, newest last — what "History"
 * lists and "Restore" copies back. `target` is `page:<key>` or `doc:<slug>`.
 * Pruned to the newest `SITE_REVISIONS_KEPT` per target on each save.
 */
const siteRevisionSchema = new Schema(
  {
    _id: { type: String, required: true },
    target: { type: String, required: true },
    revision: { type: Number, required: true },
    /** The content as saved; null when the save put the page back to the shipped copy or deleted the document. */
    content: { type: Schema.Types.Mixed, default: null },
    action: { type: String, enum: ['saved', 'restored', 'reset', 'created', 'deleted'], required: true },
    savedBy: { type: String, required: true },
    note: { type: String, default: null },
  },
  { timestamps: { createdAt: 'at', updatedAt: false }, collection: 'site_revisions', versionKey: false, minimize: false },
);
siteRevisionSchema.index({ target: 1, revision: -1 });
export const SiteRevisionModel = model('SiteRevision', siteRevisionSchema);

/**
 * A message sent from the website's contact form.
 *
 * Not a support ticket: a ticket belongs to a member and lives in their app,
 * and most of these come from people who are not members yet (press,
 * partners, someone deciding whether to install). `userId` is filled when the
 * address is a member's, so the panel can open their account beside it.
 */
const enquiryReplySchema = new Schema(
  {
    id: { type: String, required: true },
    body: { type: String, required: true },
    by: { type: String, required: true },
    /** `sent` — emailed from the server; `logged` — answered elsewhere and written down here. */
    via: { type: String, enum: ['sent', 'logged'], required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const siteEnquirySchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, default: null },
    topic: { type: String, default: null },
    message: { type: String, required: true },
    page: { type: String, default: null },
    status: { type: String, enum: SITE_ENQUIRY_STATUSES, default: 'new' },
    userId: { type: String, default: null },
    /** The team's own note, never shown to the sender. */
    note: { type: String, default: null },
    replies: { type: [enquiryReplySchema], default: [] },
    handledBy: { type: String, default: null },
  },
  { timestamps: true, collection: 'site_enquiries', versionKey: false },
);
siteEnquirySchema.index({ status: 1, createdAt: -1 });
siteEnquirySchema.index({ email: 1, createdAt: -1 });
export const SiteEnquiryModel = model('SiteEnquiry', siteEnquirySchema);
