import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../../config/defaults.js';
import { assertConfigValid, getConfig, invalidateConfig } from '../../config/remote.js';
import { appIconSchema, type AppIconDecision } from '../../contracts/index.js';
import { Errors } from '../../lib/errors.js';
import { AppConfigModel, AuditLogModel } from '../platform/models.js';
import { APP_ICONS, DEFAULT_APP_ICON, appIconKeys } from './appIcons.js';
import { DeviceModel } from './models.js';

/**
 * Which launcher icon phones show (RULES DV13).
 *
 * The server names a key; the phone shows it if its build carries one by
 * that name and keeps its base icon otherwise. A festive icon is either
 * switched on by hand (`festive`, which wins) or by a window on the
 * schedule. A member who turned festive icons off in the app gets `base`
 * whatever this says — the app decides that, since it is the phone's own
 * setting and needs no round trip.
 *
 * Nothing pushes the change: each phone asks on launch and on every return
 * to the foreground, and iOS can only change an icon while the app is in
 * front anyway. So a window that opens at midnight shows on a phone the
 * next time its owner opens VOKVE.
 */

type IconConfig = AppConfig['app']['icon'];
type IconWindow = IconConfig['schedule'][number];

/** How far back a device counts as "in use" for the panel's tally. */
const ACTIVE_DAYS = 30;
/** Windows that closed longer ago than this are dropped on the next write. */
const KEEP_CLOSED_DAYS = 365;
const MAX_WINDOWS = 60;

const asTuple = (keys: string[]) => keys as [string, ...string[]];

/** The festive icon on show at `now`, and what put it there. */
export function liveIcon(icon: IconConfig, now = new Date()) {
  if (icon.festive) {
    return { festive: icon.festive, source: 'manual' as const, window: null };
  }
  const at = now.getTime();
  const window = icon.schedule.find(entry => Date.parse(entry.startsAt) <= at && at < Date.parse(entry.endsAt)) ?? null;
  return window
    ? { festive: window.icon, source: 'schedule' as const, window }
    : { festive: null, source: null, window: null };
}

/** `GET /app/icon`: public — the icon is the same signed in or out. */
export async function appIcon(now = new Date()): Promise<AppIconDecision> {
  const { icon } = (await getConfig()).app;
  return appIconSchema.parse({ base: icon.base, festive: liveIcon(icon, now).festive });
}

// ─── The panel ─────────────────────────────────────────────────────────────

const windowState = (entry: IconWindow, at: number) =>
  Date.parse(entry.endsAt) <= at ? 'closed' : Date.parse(entry.startsAt) <= at ? 'live' : 'upcoming';

export async function appIconSettings() {
  const now = new Date();
  const config = await getConfig();
  const { icon } = config.app;
  const live = liveIcon(icon, now);
  const since = new Date(now.getTime() - ACTIVE_DAYS * 86_400_000);

  const [doc, devices] = await Promise.all([
    AppConfigModel.findById('app').lean(),
    DeviceModel.aggregate<{ _id: { icon: string | null; platform: string }; devices: number }>([
      { $match: { revokedAt: null, lastSeenAt: { $gte: since } } },
      { $group: { _id: { icon: { $ifNull: ['$app.icon', null] }, platform: '$platform' }, devices: { $sum: 1 } } },
    ]),
  ]);

  return {
    catalog: APP_ICONS.map(entry => ({ ...entry, retired: entry.retired ?? false })),
    defaultIcon: DEFAULT_APP_ICON,
    base: icon.base,
    festive: icon.festive,
    schedule: [...icon.schedule]
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .map(entry => ({ ...entry, state: windowState(entry, now.getTime()) })),
    /** What a phone with festive icons on is told right now. */
    live: {
      icon: live.festive ?? icon.base,
      festive: live.festive,
      source: live.source ?? 'base',
      until: live.window?.endsAt ?? null,
    },
    /**
     * The icon each install last said it was showing, over the devices seen
     * in the last thirty days. `null` is a build from before icons could
     * change, or one that has not reported yet.
     */
    devices: devices
      .map(row => ({ icon: row._id.icon, platform: row._id.platform, devices: row.devices }))
      .sort((a, b) => b.devices - a.devices),
    activeDays: ACTIVE_DAYS,
    updatedBy: (doc as { updatedBy?: string } | null)?.updatedBy ?? null,
    updatedAt: (doc as { updatedAt?: Date } | null)?.updatedAt?.toISOString() ?? null,
  };
}

/**
 * Validates the icon settings the way every config read will, writes them as
 * one document field, and keeps an audit row. Closed windows older than a
 * year are dropped on the way, so the list does not grow forever.
 */
async function writeIcon(actor: string, next: IconConfig, action: string, note: string | undefined) {
  const before = await getConfig();
  const cutoff = Date.now() - KEEP_CLOSED_DAYS * 86_400_000;
  const icon: IconConfig = { ...next, schedule: next.schedule.filter(entry => Date.parse(entry.endsAt) > cutoff) };
  if (icon.schedule.length > MAX_WINDOWS) {
    throw Errors.validation({ schedule: `At most ${MAX_WINDOWS} windows — remove some that have closed first.` });
  }

  const preview = structuredClone(before) as AppConfig;
  preview.app.icon = icon;
  try {
    assertConfigValid(preview);
  } catch (error) {
    throw Errors.validation({ icon: error instanceof Error ? error.message : 'Those icon settings would not be accepted.' });
  }

  await AppConfigModel.updateOne({ _id: 'app' }, { $set: { 'value.icon': icon, updatedBy: actor } }, { upsert: true });
  invalidateConfig();
  await AuditLogModel.create({
    actorType: 'admin',
    actorId: actor,
    action,
    subjectType: 'app_config',
    subjectId: 'app',
    before: before.app.icon,
    after: { ...icon, note: note ?? null },
  });
  return appIconSettings();
}

export const setAppIconBody = z
  .object({
    /** The everyday icon. */
    base: z.enum(asTuple(appIconKeys('base'))).optional(),
    /** A festive icon on now, by hand — it wins over the schedule. Null takes it off. */
    festive: z.enum(asTuple(appIconKeys('festive'))).nullable().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine(body => body.base !== undefined || body.festive !== undefined, 'Change the base or the festive icon');
export type SetAppIconBody = z.infer<typeof setAppIconBody>;

export async function setAppIcon(actor: string, body: SetAppIconBody) {
  const { icon } = (await getConfig()).app;
  return writeIcon(
    actor,
    {
      ...icon,
      ...(body.base !== undefined ? { base: body.base } : {}),
      ...(body.festive !== undefined ? { festive: body.festive } : {}),
    },
    'app.icon',
    body.note,
  );
}

export const iconWindowBody = z
  .object({
    icon: z.enum(asTuple(appIconKeys('festive'))),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    /** For the operator: "Diwali 2027", say. */
    note: z.string().trim().max(120).optional(),
  })
  .strict();
export type IconWindowBody = z.infer<typeof iconWindowBody>;

/** Puts a festive icon on the schedule. Refused where it overlaps another window. */
export async function addIconWindow(actor: string, body: IconWindowBody) {
  const { icon } = (await getConfig()).app;
  const entry: IconWindow = {
    id: randomUUID(),
    icon: body.icon,
    startsAt: new Date(body.startsAt).toISOString(),
    endsAt: new Date(body.endsAt).toISOString(),
    note: body.note || null,
  };
  if (Date.parse(entry.endsAt) <= Date.now()) {
    throw Errors.validation({ endsAt: 'That window has already closed — it would never show.' });
  }
  return writeIcon(actor, { ...icon, schedule: [...icon.schedule, entry] }, 'app.icon.schedule_add', body.note);
}

export async function removeIconWindow(actor: string, windowId: string) {
  const { icon } = (await getConfig()).app;
  if (!icon.schedule.some(entry => entry.id === windowId)) throw Errors.notFound('That window');
  return writeIcon(
    actor,
    { ...icon, schedule: icon.schedule.filter(entry => entry.id !== windowId) },
    'app.icon.schedule_remove',
    undefined,
  );
}
