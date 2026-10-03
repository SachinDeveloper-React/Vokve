import { isProduction } from '../../config/env.js';
import { getConfig } from '../../config/remote.js';
import {
  activityConfigSchema,
  type ActivityConfig,
  type ActivityGranularity,
  type ActivityRange,
  type StepSourcesReport,
} from '../../contracts/index.js';
import { addDays } from '../../lib/dates.js';
import { ApiError } from '../../lib/errors.js';
import { DeviceModel } from '../devices/models.js';
import { FraudFlagModel } from '../integrity/models.js';
import { playIntegrityProjectNumber } from '../integrity/service.js';
import type { DeviceProof } from './rollup.service.js';
import type { LayerName, SourceDecision } from './layers.js';
import { ActivityDailyModel, ActivitySampleModel, StepUploadModel } from './models.js';
import { toDaily } from './service.js';

/**
 * What the app reads about steps, all of it decided here: how the tracker
 * on the phone is set up (`GET /activity/config`), any period's steps at any
 * grain (`GET /activity/range`), and how one day was matched across phones
 * and Health Connect apps (`GET /activity/sources`).
 */

// ─── Config ─────────────────────────────────────────────────────────────────

/** The only Health Connect types the app declares — anything else would void its permission sheet. */
const DECLARED_RECORD_TYPES = ['steps', 'distance'] as const;
type DeclaredType = (typeof DECLARED_RECORD_TYPES)[number];
const declared = (types: readonly string[]): DeclaredType[] => {
  const kept = DECLARED_RECORD_TYPES.filter(type => types.includes(type));
  return kept.includes('steps') ? kept : ['steps', ...kept];
};

export async function clientActivityConfig(): Promise<ActivityConfig> {
  const config = await getConfig();
  const { tracker, sync } = config.activity;
  return activityConfigSchema.parse({
    tracker: {
      ...tracker,
      healthConnectReadTypes: declared(tracker.healthConnectReadTypes),
      privacyPolicyUrl: config.support.links.privacy,
    },
    sync: {
      ...sync,
      healthConnectRecordTypes: declared(sync.healthConnectRecordTypes),
      maxAgeDays: config.activity.maxAgeDays,
    },
    playIntegrity: { cloudProjectNumber: await playIntegrityProjectNumber() },
  });
}

// ─── Range ──────────────────────────────────────────────────────────────────

/** How wide a range each grain may ask for, so one request cannot read years of rows. */
const MAX_POINTS: Record<ActivityGranularity, number> = { hour: 24, day: 400, week: 60, month: 36 };

const DAY_MS = 86_400_000;
const dayIndex = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;
const pad = (n: number) => String(n).padStart(2, '0');

interface Bucket { start: string; end: string; days: string[] }

function buckets(from: string, to: string, granularity: ActivityGranularity): Bucket[] {
  const span = dayIndex(to) - dayIndex(from) + 1;
  const all = Array.from({ length: span }, (_, i) => addDays(from, i));
  if (granularity === 'day') return all.map(day => ({ start: day, end: day, days: [day] }));
  if (granularity === 'week') {
    const out: Bucket[] = [];
    for (let i = 0; i < all.length; i += 7) {
      const days = all.slice(i, i + 7);
      out.push({ start: days[0], end: days[days.length - 1], days });
    }
    return out;
  }
  // Calendar months, clipped to the range.
  const out: Bucket[] = [];
  for (const day of all) {
    const last = out[out.length - 1];
    if (last && last.start.slice(0, 7) === day.slice(0, 7)) {
      last.days.push(day);
      last.end = day;
    } else {
      out.push({ start: day, end: day, days: [day] });
    }
  }
  return out;
}

export async function getRange(userId: string, from: string, to: string, granularity: ActivityGranularity): Promise<ActivityRange> {
  if (from > to) throw new ApiError(422, 'VALIDATION_FAILED', 'Check the highlighted fields.', { from: 'Must be on or before to' });
  if (granularity === 'hour' && from !== to) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Check the highlighted fields.', { to: 'Hours are for one day: from and to must match' });
  }
  const plan = granularity === 'hour' ? [] : buckets(from, to, granularity);
  if (plan.length > MAX_POINTS[granularity]) {
    throw new ApiError(422, 'RANGE_TOO_LONG', 'That period is too long to show at once.', { maxPoints: MAX_POINTS[granularity] });
  }

  const rows = await ActivityDailyModel.find({ userId, localDay: { $gte: from, $lte: to } }).lean();
  const byDay = new Map(rows.map(row => [row.localDay, row]));
  const days = rows.map(row => toDaily(row.localDay, row));

  let points: ActivityRange['points'];
  if (granularity === 'hour') {
    const row = byDay.get(from);
    const hourly = row?.hourly?.length === 24 ? row.hourly : Array.from({ length: 24 }, () => 0);
    const steps = row?.steps ?? 0;
    // Hours carry no verdict of their own: each gets the day's verified share.
    const share = steps > 0 ? Math.min(1, (row?.verifiedSteps ?? 0) / steps) : 0;
    points = hourly.map((count, hour) => ({
      start: `${from}T${pad(hour)}:00`,
      end: `${from}T${pad(hour)}:59`,
      steps: Math.round(count),
      verifiedSteps: Math.round(count * share),
    }));
  } else {
    points = plan.map(bucket => ({
      start: bucket.start,
      end: bucket.end,
      steps: bucket.days.reduce((sum, day) => sum + (byDay.get(day)?.steps ?? 0), 0),
      verifiedSteps: bucket.days.reduce((sum, day) => sum + (byDay.get(day)?.verifiedSteps ?? 0), 0),
    }));
  }

  const best = days.reduce<{ date: string; steps: number } | null>(
    (top, day) => (day.steps > (top?.steps ?? 0) ? { date: day.date, steps: day.steps } : top),
    null,
  );
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    from,
    to,
    granularity,
    points,
    totals: {
      steps: days.reduce((sum, d) => sum + d.steps, 0),
      verifiedSteps: days.reduce((sum, d) => sum + d.verifiedSteps, 0),
      distanceKm: Math.round(days.reduce((sum, d) => sum + d.distanceKm, 0) * 100) / 100,
      caloriesBurned: round1(days.reduce((sum, d) => sum + d.caloriesBurned, 0)),
      activeMinutes: days.reduce((sum, d) => sum + d.activeMinutes, 0),
      activeDays: days.filter(d => d.steps > 0).length,
    },
    best,
  };
}

// ─── Sources ────────────────────────────────────────────────────────────────

/** One device's part of `activity_daily.breakdown`, as `rollup.service.ts` writes it. */
interface StoredDevice {
  deviceId: string;
  phone: { counted: number; recovered: number; flagged: number; clean: number };
  candidate: number;
  source: 'device' | 'health_connect';
  winner: string | null;
  /** What the phone showed, and which other app it came from; absent on days scored before D-51. */
  shown?: { steps: number; packageName: string | null };
  verified: boolean;
  verifiedSteps: number;
  displaySteps: number;
  plausibility: number;
  layers: Record<LayerName, number | null>;
  hard: string[];
  sources: SourceDecision[];
  sourcesStatus: string;
  signedAt: number;
  proof: DeviceProof;
}

const LAYER_NAMES: Record<LayerName, string> = {
  L0: 'Device integrity',
  L1: 'Where the steps came from',
  L2: 'Plausibility',
  L3: 'Phone against other apps',
  L4: 'Motion',
  L5: 'Patterns over days',
  L6: 'Shared devices',
};

/** What each flag means, in words a member can read. Unknown kinds fall back to their name. */
const FLAG_MESSAGES: Record<string, string> = {
  no_key: 'This phone has not confirmed it is genuine yet.',
  key_not_attested: "This phone's secure hardware could not vouch for its key.",
  attestation_chain_invalid: "This phone's key came with a broken certificate chain.",
  attestation_revoked: "This phone's key has been revoked by Google.",
  attestation_wrong_package: 'The key was made for a different app.',
  attestation_wrong_signer: 'The app was not signed by Vokve.',
  boot_not_verified: "The phone's bootloader is unlocked or its system is modified.",
  play_integrity_failed: 'Google Play could not vouch for this phone or this copy of the app.',
  play_integrity_weak: 'Google Play gave only a partial verdict.',
  play_integrity_unavailable: 'Google Play could not check this phone.',
  emulator: 'The steps came from an emulator, not a phone.',
  rooted: 'The phone shows signs of being rooted.',
  debug_build: 'A debug build of the app sent these steps.',
  developer_options: 'Developer options are on.',
  denylisted_source: 'An app known to fabricate steps wrote to Health Connect.',
  manual_entries: 'Some steps were typed in by hand; they were left out.',
  unverified_source: 'An app the server does not trust counted more than the phone.',
  pedometer_mismatch: "Another app's count is far from what the phone itself saw.",
  suspect_motion: "The phone's own checks flagged some of the steps.",
  untimed_steps: 'Many steps arrived in one lump rather than minute by minute.',
  daily_volume: 'More steps than a person usually walks in a day.',
  checks_disabled: "The phone's step checks were turned off.",
  no_minutes: 'The minute-by-minute record was missing.',
  clock_changed: "The phone's clock was changed during the day.",
  clock_ahead: "The phone's clock is ahead of the real time.",
  counter_reset: 'The step counter was reset during the day.',
  stride_incoherent: 'The distance does not fit the number of steps.',
  motion_disabled: 'Motion sampling is turned off.',
  motion_non_walk: 'Most of the motion looked like shaking or standing still, not walking.',
  shake_windows: 'Some of the motion looked like the phone being shaken.',
  night_steps: 'A lot of the steps were taken between 1 and 5 in the morning.',
  new_install_volume: 'A very high count within a day of installing.',
  round_totals: 'Several days ended on exactly round numbers.',
  identical_totals: 'Two days in a row had exactly the same count.',
  key_shared: "This phone's key is also on another account.",
  device_shared: 'This phone is registered to several accounts.',
};

const flagMessage = (kind: string) => FLAG_MESSAGES[kind] ?? kind.replace(/_/g, ' ');
const SEVERITY_ORDER = { hard: 0, soft: 1, info: 2 } as const;

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

/**
 * Of a source's steps, those left out for not saying how they were recorded
 * (⚙ `provenance.countUnknownMethod` off). Google Fit writes every step that
 * way — typed-in ones too, so they cannot be told apart.
 */
function unstatedSteps(source: SourceDecision): number {
  if (source.countable === null) return 0;
  return Math.max(0, source.steps - (source.manualSteps ?? 0) - source.countable);
}

function sourceNote(source: SourceDecision, ratio: AppRatio): string {
  const typed = source.manualSteps ? `, ${fmt(source.manualSteps)} of them typed in by hand` : '';
  switch (source.status) {
    case 'used':
      return `Counted the most${typed} — this app answers for the day.`;
    case 'lower':
      // Nothing was left to compete with: "something else counted more"
      // would be the wrong reason.
      if (!source.countable && unstatedSteps(source) > 0) {
        return 'Its steps do not say how they were recorded: shown, but never counted for coins.';
      }
      return `Trusted${typed}, but something else counted more.`;
    case 'not_counted':
      return `More than ${ratio.hard} times what the phone itself saw, so it does not count.`;
    case 'unverified':
      return 'Not an app Vokve trusts yet: shown, but never counted for coins.';
    case 'blocked':
      return 'Known to make up steps. Never counted.';
    case 'not_computed':
      return 'Typed-in steps could not be told apart, so it was left out.';
  }
}

interface AppRatio { hard: number }

/** Why the app the day shows is not what verified the day. */
function notVerifiedReason(source: SourceDecision, ratio: AppRatio): string {
  switch (source.status) {
    case 'not_counted':
      return `That is more than ${ratio.hard} times what the phone itself saw, so it is not verified.`;
    case 'unverified':
      return `${source.appName} is not an app Vokve trusts yet, so its steps are not verified.`;
    case 'blocked':
      return `${source.appName} is known to make up steps, so its steps are never verified.`;
    case 'not_computed':
      return `Typed-in steps could not be told apart in ${source.appName}, so its steps are not verified.`;
    default:
      return unstatedSteps(source) > 0
        ? `${source.appName} does not say how its steps were recorded, so they are not verified.`
        : "Only the phone's own count is verified.";
  }
}

const SOURCES_STATUS_NOTES: Record<string, string> = {
  not_consulted: 'Health Connect was not read — it is not connected, or steps are not allowed.',
  timed_out: "Health Connect took too long to answer, so only the phone's own count was used.",
  failed: "Health Connect could not be read, so only the phone's own count was used.",
};

function explain(day: { steps: number; verifiedSteps: number; verified: boolean }, devices: StoredDevice[], best: StoredDevice, names: Map<string, string>, ratio: AppRatio): string[] {
  const lines: string[] = [];
  const name = names.get(best.deviceId) ?? 'This phone';
  if (devices.length > 1) {
    lines.push(`${devices.length} phones sent this day. ${name}'s count was used — counts from different phones are never added, since they saw the same walks.`);
  }
  const phone = best.phone;
  lines.push(`${name} counted ${plural(phone.counted, 'step', 'steps')} with its own sensor.`);
  if (phone.recovered > 0) {
    lines.push(`${plural(phone.recovered, 'step was', 'steps were')} added in one go after the phone had stopped counting for a while, so they are left out.`);
  }
  if (phone.flagged > 0) lines.push(`${plural(phone.flagged, 'step was', 'steps were')} flagged by the phone's own checks and left out.`);
  if (phone.recovered > 0 || phone.flagged > 0) lines.push(`That leaves ${plural(phone.clean, 'step', 'steps')} from the phone.`);

  const used = best.sources.find(s => s.status === 'used');
  // The other app the phone showed, when the day shows more than could be
  // verified from it: shown, not hidden (A11), and said why.
  const shownPackage = best.shown?.packageName;
  const shown = !used && shownPackage && day.steps > best.candidate
    ? best.sources.find(s => s.packageName === shownPackage)
    : undefined;
  const dropped = best.sources.filter(s => s.status === 'not_counted' && s !== shown);
  for (const source of dropped) {
    lines.push(`${source.appName} recorded ${fmt(source.steps)}, more than ${ratio.hard} times what the phone saw, so it was not counted.`);
  }
  if (used) {
    const typed = used.manualSteps ? ` (${fmt(used.manualSteps)} typed in by hand, left out)` : '';
    lines.push(`${used.appName} recorded ${fmt(used.steps)}${typed}: ${fmt(used.countable ?? 0)} that count — more than the phone, so ${used.appName} answers for the day.`);
  } else if (shown) {
    lines.push(`${shown.appName} recorded ${fmt(shown.steps)}, more than the phone, so the day shows ${plural(day.steps, 'step', 'steps')}.`);
    lines.push(notVerifiedReason(shown, ratio));
  } else if (best.sources.some(s => s.status === 'lower')) {
    const unstated = best.sources.find(s => s.status === 'lower' && s.steps > phone.clean && unstatedSteps(s) > 0);
    lines.push(
      unstated
        ? `${unstated.appName} recorded ${fmt(unstated.steps)}, but its steps do not say how they were recorded, so the phone's own count is used.`
        : "No trusted app counted more than the phone, so the phone's own count is used.",
    );
  } else if (best.sources.length === 0) {
    lines.push(best.sourcesStatus === 'read' ? 'No other app recorded steps today.' : SOURCES_STATUS_NOTES[best.sourcesStatus] ?? 'Health Connect was not read.');
  }
  lines.push(
    day.verified
      ? `The day passed the checks: ${plural(day.verifiedSteps, 'step is', 'steps are')} verified.`
      : 'The day did not pass the checks, so none of it is verified yet.',
  );
  return lines;
}

const showChecks = async () => (await getConfig()).activity.inspector.showChecks ?? !isProduction;

export async function getSourcesReport(userId: string, date: string, currentDeviceId: string | undefined): Promise<StepSourcesReport> {
  const config = await getConfig();
  const ratio = { hard: config.activity.thresholds.pedometerRatio.hard };
  const row = await ActivityDailyModel.findById(`${userId}:${date}`).lean();
  const breakdown = row?.breakdown as { bestDeviceId: string; devices: StoredDevice[] } | undefined;
  const stored = breakdown?.devices ?? [];

  const [deviceDocs, uploads, samples, flags] = await Promise.all([
    DeviceModel.find({ userId }, { info: 1 }).lean(),
    StepUploadModel.find({ userId, localDay: date }, { response: 0 }).sort({ receivedAt: -1 }).limit(20).lean(),
    ActivitySampleModel.aggregate<{ _id: { origin: string; method: string }; records: number; steps: number }>([
      { $match: { userId, localDay: date, recordType: 'steps' } },
      // A record edited later is stored again; only its newest version counts.
      { $sort: { lastModifiedAt: -1 } },
      { $group: { _id: '$sampleId', origin: { $first: '$origin' }, method: { $first: '$recordingMethod' }, value: { $first: '$value' } } },
      { $group: { _id: { origin: '$origin', method: '$method' }, records: { $sum: 1 }, steps: { $sum: '$value' } } },
    ]),
    FraudFlagModel.find({ userId, localDay: date, status: { $ne: 'dismissed' } }).sort({ createdAt: 1 }).lean(),
  ]);

  const names = new Map(
    deviceDocs.map(d => [d._id, [d.info?.brand, d.info?.model].filter(Boolean).join(' ').trim() || 'Phone']),
  );
  const lastSync = new Map<string, Date>();
  for (const upload of uploads) if (!lastSync.has(upload.deviceId)) lastSync.set(upload.deviceId, upload.receivedAt);

  // App names as the phones reported them, for the raw records.
  const appNames = new Map<string, string>();
  for (const device of stored) for (const source of device.sources) appNames.set(source.packageName, source.appName);

  const byOrigin = new Map<string, StepSourcesReport['records'][number]>();
  for (const group of samples) {
    const entry = byOrigin.get(group._id.origin) ?? {
      packageName: group._id.origin,
      appName: appNames.get(group._id.origin) ?? group._id.origin,
      records: 0, steps: 0, manualSteps: 0, unknownMethodSteps: 0,
    };
    entry.records += group.records;
    entry.steps += Math.round(group.steps);
    if (group._id.method === 'manual') entry.manualSteps += Math.round(group.steps);
    if (group._id.method === 'unknown') entry.unknownMethodSteps += Math.round(group.steps);
    byOrigin.set(group._id.origin, entry);
  }

  const day = toDaily(date, row);
  const best = stored.find(device => device.deviceId === breakdown?.bestDeviceId) ?? stored[0];
  const explanation = best
    ? explain(day, stored, best, names, ratio)
    : ['Nothing has been synced for this day yet. Open the app with step counting on and it will be.'];

  const devices: StepSourcesReport['devices'] = stored.map(device => ({
    deviceId: device.deviceId,
    name: names.get(device.deviceId) ?? 'Phone',
    isCurrent: device.deviceId === currentDeviceId,
    answeredForDay: device.deviceId === best?.deviceId,
    syncedAt: lastSync.get(device.deviceId)?.toISOString() ?? null,
    phone: device.phone,
    counted: device.candidate,
    source: device.source,
    verified: device.verified,
    sourcesNote: device.sourcesStatus === 'read' ? null : SOURCES_STATUS_NOTES[device.sourcesStatus] ?? null,
    sources: [...device.sources]
      .sort((a, b) => b.steps - a.steps)
      .map(source => ({
        packageName: source.packageName,
        appName: source.appName,
        kind: source.kind,
        isWearable: source.isWearable,
        isPlatform: source.isPlatform,
        steps: Math.max(0, source.steps),
        manualSteps: source.manualSteps,
        countable: source.countable,
        ratioToPhone: source.ratioToPhone,
        status: source.status,
        note: sourceNote(source, ratio),
      })),
    proof: {
      keyAttested: device.proof?.key ? device.proof.key.attested : null,
      bootVerified: device.proof?.key?.verifiedBootState
        ? device.proof.key.verifiedBootState === 'verified' && device.proof.key.deviceLocked !== false
        : null,
      playIntegrity: device.proof?.play?.verdict ?? null,
    },
  }));

  return {
    date,
    scoredAt: (row?.scoredAt as Date | undefined)?.toISOString() ?? null,
    day,
    explanation,
    devices,
    records: [...byOrigin.values()].sort((a, b) => b.steps - a.steps),
    uploads: uploads.map(upload => ({
      at: upload.receivedAt.toISOString(),
      deviceName: names.get(upload.deviceId) ?? 'Phone',
      phoneSteps: Math.max(0, Math.round(upload.deviceSteps ?? 0)),
      shownSteps: Math.max(0, Math.round(upload.resolvedSteps ?? 0)),
      playIntegrity: upload.integrityVerdict ?? null,
    })),
    checks: (await showChecks())
      ? {
          plausibility: (row?.plausibility as number | null | undefined) ?? null,
          layers: (Object.keys(LAYER_NAMES) as LayerName[]).map(key => ({
            key,
            name: LAYER_NAMES[key],
            score: best?.layers?.[key] ?? null,
          })),
          flags: flags
            .map(f => ({ kind: f.kind, layer: f.layer, severity: f.severity as 'hard' | 'soft' | 'info', message: flagMessage(f.kind) }))
            .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
        }
      : null,
  };
}
