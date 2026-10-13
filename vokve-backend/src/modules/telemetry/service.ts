import type {
  AnalyticsEvent,
  PermissionEntry,
  PermissionSnapshot,
  PermissionStatus,
} from '../../contracts/index.js';
import { newId } from '../../lib/ids.js';
import { privacyAllows } from '../account/service.js';
import { DevicePermissionsModel, EventModel, PERMISSION_HISTORY_LIMIT } from './models.js';

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
