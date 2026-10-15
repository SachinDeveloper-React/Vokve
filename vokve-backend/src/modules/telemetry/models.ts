import { Schema, model } from 'mongoose';
import { appErrorKindSchema, appPermissionSchema, permissionStateSchema } from '../../contracts/index.js';

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

/**
 * Thirty days, not the trail's four hundred (BACKEND §14.7): an error is
 * read while it is happening or not at all, and a stack from a build three
 * releases ago answers nothing.
 */
const ERROR_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * What went wrong on a phone, **grouped** (RULES P17).
 *
 * One row per (account, install, fingerprint) rather than per occurrence,
 * for the reason every crash reporter does the same: the interesting number
 * is "this has happened 240 times since Tuesday", and a loop that throws on
 * every render must not be able to write 240 rows a minute. `count` carries
 * the occurrences, `firstAt`/`lastAt` the span, and the stack and context
 * are the **latest** ones — an older copy of the same fault says nothing
 * new.
 *
 * Kept whatever the usage-analytics switch says, like the permission
 * snapshot (RULES P7, P14): it is the record of the app failing somebody,
 * not of what they were interested in.
 */
const appErrorSchema = new Schema(
  {
    /** `userId:deviceId:fingerprint`. */
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    /** sha256 of the kind, the name, the message and the first frame. */
    fingerprint: { type: String, required: true },
    kind: { type: String, enum: appErrorKindSchema.options, required: true },
    name: { type: String, default: null },
    message: { type: String, required: true },
    scope: { type: String, default: null },
    screen: { type: String, default: null },
    stack: { type: String, default: null },
    fatal: { type: Boolean, default: false },
    context: { type: Schema.Types.Mixed, default: undefined },
    sessionId: { type: String, default: null },
    count: { type: Number, default: 1 },
    firstAt: { type: Date, required: true },
    lastAt: { type: Date, required: true },
    /** The build it last happened on, which is what a fix ships against. */
    platform: { type: String, enum: ['ios', 'android', null], default: null },
    appVersion: { type: String, default: null },
    build: { type: String, default: null },
    osVersion: { type: String, default: null },
    receivedAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'app_errors', timestamps: false },
);
// The operator's read: one member's faults, most recent first.
appErrorSchema.index({ userId: 1, lastAt: -1 });
// And across accounts: what is breaking, and on which build.
appErrorSchema.index({ fingerprint: 1, lastAt: -1 });
appErrorSchema.index({ appVersion: 1, lastAt: -1 });
appErrorSchema.index({ receivedAt: 1 }, { expireAfterSeconds: ERROR_TTL_SECONDS });
export const AppErrorModel = model('AppError', appErrorSchema);

/**
 * Whether an install is actually working (RULES P17): the tracker's own
 * health, Health Connect's grants and the state of the step sync, as the
 * phone last reported them.
 *
 * Current state, one document per (account, install) — not a stream. The
 * history of it is already answered elsewhere: `device_permissions` keeps
 * what the member allowed and when it changed, `devices.stepSync` when this
 * install last reported, and `events` what they were doing at the time.
 * What was missing was the phone's own verdict on itself.
 */
const deviceHealthSchema = new Schema(
  {
    /** `userId:deviceId`. */
    _id: { type: String, required: true },
    userId: { type: String, required: true },
    deviceId: { type: String, required: true },
    platform: { type: String, enum: ['ios', 'android', null], default: null },
    appVersion: { type: String, default: null },
    tracking: { type: Schema.Types.Mixed, default: undefined },
    healthConnect: { type: Schema.Types.Mixed, default: undefined },
    sync: { type: Schema.Types.Mixed, default: undefined },
    /** The phone's clock, when it put the report together. */
    at: { type: Date, required: true },
    receivedAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'device_health', timestamps: true },
);
deviceHealthSchema.index({ userId: 1, at: -1 });
// The fleet read: every install whose service is dead, worst first.
deviceHealthSchema.index({ 'tracking.looksDead': 1, at: -1 });
export const DeviceHealthModel = model('DeviceHealth', deviceHealthSchema);
