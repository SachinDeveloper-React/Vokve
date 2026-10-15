import type {
  AnalyticsEvent,
  AppError,
  AppErrorIntake,
  DeviceHealthReport,
  DeviceHealthSnapshot,
  PermissionEntry,
  PermissionSnapshot,
  PermissionStatus,
} from '../../contracts/index.js';
import { getConfig } from '../../config/remote.js';
import { newId } from '../../lib/ids.js';
import { sha256Hex } from '../../lib/signatures.js';
import { privacyAllows } from '../account/service.js';
import {
  AppErrorModel,
  DeviceHealthModel,
  DevicePermissionsModel,
  EventModel,
  PERMISSION_HISTORY_LIMIT,
} from './models.js';

/** What the request itself says about the phone that made it (BACKEND §3.8). */
export interface EventContext {
  platform?: 'ios' | 'android';
  appVersion?: string;
  build?: string;
  osVersion?: string;
  timezone?: string;
}

/** A phone clock this far ahead of ours is wrong, not early (RULES A8). */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Older than this and the event is history nobody will read; the queue should have drained long ago. */
const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// ─── What the member did (PRD ADV2) ────────────────────────────────────────

export interface EventIntakeResult {
  /** How many rows were written. */
  accepted: number;
  /** How many were dropped, and nothing about why — the app must not behave differently. */
  dropped: number;
}

/**
 * Takes a batch of events from the app.
 *
 * Three things never come from the body: the device, the app version and the
 * platform. They are read from the request's headers, so a row can always be
 * attributed even if the build sending it is old or lying.
 *
 * A member with usage analytics off is **accepted and dropped** (RULES P7):
 * the app should not have to know the setting, and a refusal would only
 * teach it to retry. Malformed or ancient rows go the same way — one bad
 * event in a batch of fifty must not cost the other forty-nine.
 */
export async function recordEvents(
  userId: string,
  deviceId: string,
  ctx: EventContext,
  events: AnalyticsEvent[],
): Promise<EventIntakeResult> {
  if (!(await privacyAllows(userId, 'analytics'))) {
    return { accepted: 0, dropped: events.length };
  }

  const now = Date.now();
  const rows = events.flatMap(event => {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at) || now - at > MAX_EVENT_AGE_MS) return [];
    const props = event.props && Object.keys(event.props).length > 0 ? event.props : undefined;
    // Every event may name the screen it happened on; a `screen_view` is
    // the one that only names it.
    const screen = propString(props, 'screen');
    return [{
      _id: newId('evt'),
      userId,
      deviceId,
      name: event.name,
      // A clock running ahead is corrected rather than refused: the event
      // did happen, and a row timed in the future breaks every range read.
      at: new Date(Math.min(at, now + MAX_CLOCK_SKEW_MS)),
      receivedAt: new Date(now),
      sessionId: event.sessionId ?? null,
      screen,
      props,
      platform: ctx.platform ?? null,
      appVersion: ctx.appVersion ?? null,
      build: ctx.build ?? null,
      osVersion: ctx.osVersion ?? null,
      timezone: ctx.timezone ?? null,
    }];
  });

  if (rows.length > 0) {
    // Unordered: a row the collection refuses does not stop the rest.
    await EventModel.insertMany(rows, { ordered: false }).catch(() => undefined);
  }
  return { accepted: rows.length, dropped: events.length - rows.length };
}

function propString(props: Record<string, unknown> | undefined, key: string): string | null {
  const value = props?.[key];
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 80) : null;
}

// ─── What the phone lets us do (RULES P14) ─────────────────────────────────

/**
 * Files one install's permission answers.
 *
 * The report is the whole set this build knows about, so a permission the
 * member has revoked arrives as `denied` rather than as a gap — which is
 * why a key missing from the report is left out of the snapshot instead of
 * being guessed at. A state that has not changed keeps its `since`, so the
 * answer to "since when" survives every later report; a state that has
 * changed writes a history row, and the last twenty are kept.
 *
 * Not gated by the analytics switch: this is the operational state support
 * reads when steps are zero or a push never arrived, not a product metric.
 */
export async function savePermissions(
  userId: string,
  deviceId: string,
  ctx: EventContext,
  entries: PermissionEntry[],
): Promise<PermissionSnapshot> {
  const existing = await DevicePermissionsModel.findById(`${userId}:${deviceId}`).lean();
  const before = new Map((existing?.permissions ?? []).map(p => [p.key, p]));
  const now = new Date();
  const changes: { key: string; from: string | null; to: string; at: Date }[] = [];

  // Last one wins where a build reports a key twice — the newer answer is
  // the one at the end of the array it built.
  const reported = new Map(entries.map(entry => [entry.key, entry]));
  const permissions = [...reported.values()].map(entry => {
    const previous = before.get(entry.key);
    if (previous && previous.state === entry.state) {
      return { ...entry, detail: entry.detail ?? null, since: previous.since, checkedAt: now };
    }
    if (previous) changes.push({ key: entry.key, from: previous.state, to: entry.state, at: now });
    else if (entry.state !== 'granted') changes.push({ key: entry.key, from: null, to: entry.state, at: now });
    return { ...entry, detail: entry.detail ?? null, since: now, checkedAt: now };
  });

  const history = [...changes.reverse(), ...(existing?.history ?? [])].slice(0, PERMISSION_HISTORY_LIMIT);

  const saved = await DevicePermissionsModel.findOneAndUpdate(
    { _id: `${userId}:${deviceId}` },
    {
      $set: {
        userId,
        deviceId,
        platform: ctx.platform ?? null,
        appVersion: ctx.appVersion ?? null,
        permissions,
        history,
      },
    },
    { upsert: true, new: true },
  ).lean();

  return toSnapshot(deviceId, saved);
}

/** What this install last told the server about itself. */
export async function readPermissions(userId: string, deviceId: string): Promise<PermissionSnapshot> {
  const row = await DevicePermissionsModel.findById(`${userId}:${deviceId}`).lean();
  return toSnapshot(deviceId, row);
}

/** One stored permission row, as `.lean()` hands it over. */
export interface StoredPermission {
  key: string;
  state: string;
  detail?: string | null;
  since: Date;
  checkedAt: Date;
}

function toSnapshot(
  deviceId: string,
  row: { permissions?: StoredPermission[]; updatedAt?: Date } | null,
): PermissionSnapshot {
  return {
    deviceId,
    permissions: (row?.permissions ?? []).map(toPermissionStatus),
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/** Exported so the operator's reads word a permission exactly as the app's own do. */
export function toPermissionStatus(p: StoredPermission): PermissionStatus {
  return {
    key: p.key as PermissionStatus['key'],
    state: p.state as PermissionStatus['state'],
    ...(p.detail ? { detail: p.detail } : {}),
    since: p.since.toISOString(),
    checkedAt: p.checkedAt.toISOString(),
  };
}

// ─── What went wrong (RULES P17) ───────────────────────────────────────────

/**
 * What makes two reports the same fault: the kind, the error's own name, its
 * message and the first frame of the stack.
 *
 * The message is included because `undefined is not an object (evaluating
 * 'a.b')` and the same for `c.d` are different bugs; the first frame because
 * one helper throwing the same message from two call sites usually is too.
 * Everything below the first frame is left out, so a stack that differs only
 * in how deep it was does not split a group.
 */
function fingerprintOf(error: AppError): string {
  const frame = (error.stack ?? '').split('\n').map(line => line.trim()).find(line => line.length > 0) ?? '';
  return sha256Hex([error.kind, error.name ?? '', error.message, frame].join('\u0000')).slice(0, 32);
}

/**
 * Takes what went wrong on a phone (RULES P17).
 *
 * Grouped on arrival: a report that matches a group already on this install
 * increments its count, moves `lastAt` and replaces the stack and context
 * with the newer ones. A report of something new is a new group — up to
 * ⚙ `telemetry.errors.maxGroupsPerDevicePerDay`, past which a build in a
 * crash loop with a changing message cannot keep writing.
 *
 * Unlike the trail, this is kept for a member with usage analytics off: it
 * is the record of the app failing them, and support reads it (RULES P7).
 * A row that cannot be read is dropped rather than failing the batch — the
 * app must not be taught to retry a report it cannot fix.
 */
export async function recordErrors(
  userId: string,
  deviceId: string,
  ctx: EventContext,
  errors: AppError[],
): Promise<AppErrorIntake> {
  const config = await getConfig();
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  let groupsToday = await AppErrorModel.countDocuments({ deviceId, firstAt: { $gte: dayAgo } });

  let accepted = 0;
  let dropped = 0;
  for (const error of errors) {
    const at = Date.parse(error.at);
    if (Number.isNaN(at) || at > now.getTime() + MAX_CLOCK_SKEW_MS || now.getTime() - at > MAX_EVENT_AGE_MS) {
      dropped += 1;
      continue;
    }
    const fingerprint = fingerprintOf(error);
    const _id = `${userId}:${deviceId}:${fingerprint}`;
    const existing = await AppErrorModel.exists({ _id });
    if (!existing && groupsToday >= config.telemetry.errors.maxGroupsPerDevicePerDay) {
      dropped += 1;
      continue;
    }
    await AppErrorModel.updateOne(
      { _id },
      {
        $setOnInsert: { _id, userId, deviceId, fingerprint, kind: error.kind, firstAt: new Date(at) },
        $set: {
          name: error.name ?? null,
          message: error.message,
          scope: error.scope ?? null,
          screen: error.screen ?? null,
          stack: error.stack ?? null,
          fatal: error.fatal,
          context: error.context && Object.keys(error.context).length > 0 ? error.context : undefined,
          sessionId: error.sessionId ?? null,
          platform: ctx.platform ?? null,
          appVersion: ctx.appVersion ?? null,
          build: ctx.build ?? null,
          osVersion: ctx.osVersion ?? null,
          receivedAt: now,
        },
        $max: { lastAt: new Date(at) },
        $inc: { count: 1 },
      },
      { upsert: true },
    );
    if (!existing) groupsToday += 1;
    accepted += 1;
  }
  return { accepted, dropped };
}

// ─── Whether the phone is working (RULES P17) ──────────────────────────────

/**
 * Takes an install's verdict on itself: the tracker's health, Health
 * Connect's grants, the state of the sync.
 *
 * Replaced rather than appended to — this is current state, and the history
 * that matters is kept elsewhere (`device_permissions` for what the member
 * allowed, `devices.stepSync` for when this install last reported). Kept
 * whatever the analytics switch says, for the same reason as the permission
 * snapshot: it is what support reads when steps are zero.
 */
export async function saveDeviceHealth(
  userId: string,
  deviceId: string,
  ctx: EventContext,
  report: DeviceHealthReport,
): Promise<DeviceHealthSnapshot> {
  const now = new Date();
  const _id = `${userId}:${deviceId}`;
  await DeviceHealthModel.updateOne(
    { _id },
    {
      $setOnInsert: { _id, userId, deviceId },
      $set: {
        platform: ctx.platform ?? null,
        appVersion: ctx.appVersion ?? null,
        tracking: report.tracking,
        healthConnect: report.healthConnect,
        sync: report.sync,
        at: now,
        receivedAt: now,
      },
    },
    { upsert: true },
  );
  return { ...report, deviceId, at: now.toISOString() };
}
