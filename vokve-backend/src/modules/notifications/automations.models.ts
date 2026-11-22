import { Schema, model } from 'mongoose';

/**
 * An automation's settings as the operator left them (RULES M11): on or
 * off, the member's local hour and weekdays it runs on, its own knobs, and
 * the words it rotates through. One row per built-in key; a key with no
 * row runs on the code's defaults (`automations.catalog.ts`), so a fresh
 * database sends exactly what the catalogue says.
 */
const templateSchema = new Schema(
  {
    id: { type: String, required: true },
    slot: { type: String, default: 'default' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

const automationSchema = new Schema(
  {
    _id: { type: String, required: true }, // the automation's key
    enabled: { type: Boolean, required: true },
    hour: { type: Number, default: null },
    weekdays: { type: [Number], default: undefined },
    params: { type: Schema.Types.Mixed, default: undefined },
    templates: { type: [templateSchema], default: undefined },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true, collection: 'notification_automations', versionKey: false },
);
export const NotificationAutomationModel = model('NotificationAutomation', automationSchema);

/**
 * A message the operator scheduled (RULES M11): who it is for (the
 * broadcast's segment), what it says, and when — once on a day, every day,
 * or on chosen weekdays — always at the member's own local hour.
 */
const campaignSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    category: { type: String, enum: ['motivation', 'information', 'update', 'offer'], required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String, default: null },
    segment: { type: Schema.Types.Mixed, default: {} },
    schedule: {
      kind: { type: String, enum: ['once', 'daily', 'weekly'], required: true },
      /** `YYYY-MM-DD`, for `once`: the member's own date. */
      date: { type: String, default: null },
      /** 0 = Monday … 6 = Sunday, for `weekly`. */
      weekdays: { type: [Number], default: undefined },
      hour: { type: Number, required: true },
    },
    /** The member's local dates it runs between, both ends included; null for open. */
    startsOn: { type: String, default: null },
    endsOn: { type: String, default: null },
    enabled: { type: Boolean, default: true },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
    lastRunAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'notification_campaigns', versionKey: false },
);
campaignSchema.index({ enabled: 1 });
export const NotificationCampaignModel = model('NotificationCampaign', campaignSchema);
