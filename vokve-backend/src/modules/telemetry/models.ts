import { Schema, model } from 'mongoose';
import { appPermissionSchema, permissionStateSchema } from '../../contracts/index.js';

/** 400 days, as the retention table says (BACKEND §14.7) — thirteen months, so a year-on-year read still has both ends. */
const EVENT_TTL_SECONDS = 400 * 24 * 60 * 60;

/**
 * One row per thing a member did (PRD ADV2): a screen they opened, a glass
 * they logged, an order they paid for.
 *
 * Written only by `POST /events`, never updated, and dropped on arrival for
 * an account with usage analytics switched off (RULES P7). The device, app
 * version, platform and OS come from the request's own headers rather than
 * the body, so a row's provenance is whatever the request actually was.
 *
 * `at` is the phone's clock — events are queued offline and can arrive
 * hours late — and `receivedAt` is ours, which is why the TTL hangs off it:
 * a row's life should be counted from when we took it, not from a timestamp
 * the phone chose.
 */
const eventSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    name: { type: String, required: true },
    /**
     * The screen the member was on. Lifted out of `props` for `screen_view`
     * so "which pages does this member open" is an index scan rather than a
     * walk through a Mixed field.
     */
    screen: { type: String, default: null },
    /** The app launch this belonged to, so a row can be read as part of a visit. */
    sessionId: { type: String, default: null },
    props: { type: Schema.Types.Mixed, default: undefined },
    at: { type: Date, required: true },
    receivedAt: { type: Date, required: true, default: Date.now },
    platform: { type: String, enum: ['ios', 'android', null], default: null },
    appVersion: { type: String, default: null },
    build: { type: String, default: null },
    osVersion: { type: String, default: null },
    timezone: { type: String, default: null },
  },
  { collection: 'events', timestamps: false },
);
// The operator's read: one member's trail, newest first.
eventSchema.index({ userId: 1, at: -1 });
// "Where do members go" and "how often is this done", across accounts.
eventSchema.index({ name: 1, at: -1 });
eventSchema.index({ screen: 1, at: -1 }, { sparse: true });
eventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: EVENT_TTL_SECONDS });
export const EventModel = model('Event', eventSchema);

/**
 * What one install's OS currently lets this app do (RULES P14), and when
 * each answer last changed.
 *
 * A collection of its own rather than rows in `events`: a permission is
 * operational state, not product analytics — it is the first thing support
 * looks at when steps read zero or a push never arrived — so it is kept for
 * an account that has switched analytics off, and it is *current* state, not
 * a stream. The last twenty changes are kept beside it, because "when did
 * they turn notifications off" is the question that follows.
 */
const devicePermissionsSchema = new Schema(
  {
    /** `userId:deviceId` — one snapshot per account per install. */
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    platform: { type: String, enum: ['ios', 'android', null], default: null },
    appVersion: { type: String, default: null },
    permissions: {
      type: [
        {
          _id: false,
          key: { type: String, enum: appPermissionSchema.options, required: true },
          state: { type: String, enum: permissionStateSchema.options, required: true },
          detail: { type: String, default: null },
          /** When this state was first seen — kept across reports that do not change it. */
          since: { type: Date, required: true },
          checkedAt: { type: Date, required: true },
        },
      ],
      default: [],
    },
    /** Newest first, capped: a permission that flaps should not grow a document without bound. */
    history: {
      type: [
        {
          _id: false,
          key: { type: String, required: true },
          from: { type: String, default: null },
          to: { type: String, required: true },
          at: { type: Date, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true, collection: 'device_permissions' },
);
devicePermissionsSchema.index({ userId: 1, updatedAt: -1 });
export const DevicePermissionsModel = model('DevicePermissions', devicePermissionsSchema);

/** How many changes one install's history keeps. */
export const PERMISSION_HISTORY_LIMIT = 20;
