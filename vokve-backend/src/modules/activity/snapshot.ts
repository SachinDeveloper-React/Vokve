import { z } from 'zod';
import { isValidTimeZone } from '../../lib/dates.js';
import type { AppConfig } from '../../config/defaults.js';

/**
 * The signed step snapshot react-native-step-tracker-pro produces
 * (`VerificationSnapshot`, schema version 2), read only after its signature
 * has been checked over these exact bytes. Loose on purpose: a field a later
 * tracker adds is ignored, a field an earlier one lacked takes its default.
 * Strict on the three things the server cannot do without — the version,
 * the day and the nonce.
 */

const count = z.number().finite();

const sourceSchema = z.object({
  packageName: z.string(),
  appName: z.string().default(''),
  kind: z.string().default('unknown'),
  steps: count.default(0),
  distance: count.default(0),
  manualSteps: count.default(-1),
  unknownMethodSteps: count.default(-1),
  lateWrittenSteps: count.default(-1),
  isSelf: z.boolean().default(false),
  isWearable: z.boolean().default(false),
  trustedWearable: z.boolean().default(false),
  isPlatform: z.boolean().default(false),
  distanceSource: z.string().nullish(),
  /** 24 local hours, midnight first; every entry -1 when not computed. */
  hourlySteps: z.array(count).default([]),
});

const minuteSchema = z.object({
  minuteStart: count,
  steps: count.default(0),
  untimedSteps: count.default(0),
  chargingSteps: count.default(0),
  stillSteps: count.default(0),
  vehicleSteps: count.default(0),
});

const windowSchema = z.object({
  startedAt: count,
  durationMs: count.default(0),
  sampleCount: count.default(0),
  dominantFrequencyHz: count.default(0),
  variance: count.default(0),
  zeroCrossingRate: count.default(0),
  peakRatio: count.default(0),
  stepsDuringWindow: count.default(0),
});

const recordSchema = z.object({
  id: z.string().min(1),
  packageName: z.string().default(''),
  recordingMethod: z.string().default('unknown'),
  recordType: z.enum(['steps', 'distance']).optional(),
  count: count.optional(),
  distanceMeters: count.optional(),
  startTime: count,
  endTime: count,
  lastModifiedTime: count.default(0),
  device: z
    .object({ type: z.string().nullish(), manufacturer: z.string().nullish(), model: z.string().nullish() })
    .nullish(),
});

const flagSchema = z.object({
  type: z.string(),
  severity: z.enum(['strong', 'weak']).catch('weak'),
  steps: count.default(0),
});

const eventSchema = z.object({
  type: z.string(),
  at: count.default(0),
  detail: z.record(z.string(), z.unknown()).nullish(),
});

export const signedSnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  libraryVersion: z.string().default('unknown'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deviceSteps: count.min(0),
  recoveredSteps: count.min(0).default(0),
  suspectSteps: count.min(0).default(0),
  sensor: z.string().default('none'),
  coverageStartAt: count.default(0),
  sources: z.array(sourceSchema).default([]),
  sourcesStatus: z.string().default('not_consulted'),
  resolved: z
    .object({
      steps: count.default(0),
      kind: z.string().default('self'),
      packageName: z.string().nullish(),
      appName: z.string().default(''),
      usedExternal: z.boolean().default(false),
      manualStepsExcluded: count.default(0),
      distanceSource: z.string().nullish(),
    })
    .prefault({}),
  capabilities: z
    .object({
      hasStepCounter: z.boolean().nullish(),
      manufacturer: z.string().nullish(),
      model: z.string().nullish(),
      sdkInt: count.nullish(),
    })
    .prefault({}),
  health: z
    .object({
      recoveryCount: count.default(0),
      lastRecoveryReason: z.string().nullish(),
      batteryOptimizationEnabled: z.boolean().default(false),
      aggressiveOem: z.boolean().default(false),
    })
    .prefault({}),
  clock: z
    .object({
      wallClockMs: count.default(0),
      bootId: count.default(0),
      timezone: z.string().default('UTC'),
      utcOffsetMinutes: count.default(0),
    })
    .prefault({}),
  integrity: z
    .object({
      enabled: z.boolean().default(false),
      mode: z.string().default('flag'),
      flags: z.array(flagSchema).default([]),
      events: z.array(eventSchema).default([]),
      device: z
        .object({
          emulator: z.boolean().default(false),
          testKeysBuild: z.boolean().default(false),
          suBinary: z.boolean().default(false),
          adbEnabled: z.boolean().default(false),
          developerOptions: z.boolean().default(false),
          appDebuggable: z.boolean().default(false),
        })
        .prefault({}),
    })
    .prefault({}),
  minutesStatus: z.enum(['enabled', 'disabled']).optional(),
  minutes: z.array(minuteSchema).optional(),
  motionWindowsStatus: z.enum(['enabled', 'disabled']).optional(),
  motionWindows: z.array(windowSchema).optional(),
  healthConnectRecords: z
    .object({
      status: z.string(),
      records: z.array(recordSchema).default([]),
      truncated: z.boolean().default(false),
    })
    .optional(),
  nonce: z.string().min(1).max(512),
  signedAt: count,
});
export type SignedSnapshot = z.infer<typeof signedSnapshotSchema>;
export type SnapshotRecord = z.infer<typeof recordSchema>;
export type SnapshotWindow = z.infer<typeof windowSchema>;

export type WindowClass = 'walk' | 'shake' | 'still' | 'other' | 'idle';
type Thresholds = AppConfig['activity']['thresholds'];

/**
 * What one motion window looked like (RULES A16): a walk's dominant
 * frequency sits at the stride, a hand shake is fast and hard, and steps
 * counted while nothing moves rhythmically are a phone in a car or on a desk.
 */
export function classifyWindow(window: SnapshotWindow, t: Thresholds): WindowClass {
  if (window.stepsDuringWindow <= 0) return 'idle';
  const hz = window.dominantFrequencyHz;
  if (hz >= t.motion.shakeMinHz && window.variance >= t.motion.shakeMinVariance) return 'shake';
  if (hz >= t.motion.walkMinHz && hz <= t.motion.walkMaxHz) return 'walk';
  if (hz < t.motion.stillMaxHz) return 'still';
  return 'other';
}

export interface SourceEvidence {
  packageName: string;
  appName: string;
  kind: string;
  steps: number;
  distance: number;
  manualSteps: number;
  unknownMethodSteps: number;
  isWearable: boolean;
  trustedWearable: boolean;
  isPlatform: boolean;
  distanceSource: string | null;
  /** The source's own 24 hours, when the tracker computed them. */
  hourlySteps: number[] | null;
}

/** One device's day, as the fraud layers read it. Small enough to keep with the day. */
export interface DeviceDayEvidence {
  libraryVersion: string;
  sensor: string;
  timezone: string;
  utcOffsetMinutes: number;
  signedAt: number;
  wallClockMs: number;
  deviceSteps: number;
  recoveredSteps: number;
  suspectSteps: number;
  coverageStartAt: number;
  resolved: {
    steps: number;
    usedExternal: boolean;
    packageName: string | null;
    kind: string;
    manualStepsExcluded: number;
    distanceSource: string | null;
  };
  sourcesStatus: string;
  sources: SourceEvidence[];
  minutes: {
    status: 'enabled' | 'disabled' | 'absent';
    count: number;
    timedSteps: number;
    untimedSteps: number;
    chargingSteps: number;
    vehicleSteps: number;
    activeMinutes: number;
    /** Steps between 01:00 and 05:00 local (RULES A17). */
    nightSteps: number;
    peakMinuteSteps: number;
  };
  /** Twenty-four local hours, midnight first. */
  hourly: number[];
  motion: {
    status: 'enabled' | 'disabled' | 'absent';
    windows: number;
    stepWindows: number;
    walk: number;
    shake: number;
    still: number;
    other: number;
  };
  checks: {
    enabled: boolean;
    mode: string;
    strong: { type: string; steps: number }[];
    weak: { type: string; steps: number }[];
    clockJumps: number;
    configChanges: number;
    resets: number;
  };
  hints: {
    emulator: boolean;
    testKeysBuild: boolean;
    suBinary: boolean;
    adbEnabled: boolean;
    developerOptions: boolean;
    appDebuggable: boolean;
  };
  health: { recoveryCount: number; aggressiveOem: boolean; batteryOptimizationEnabled: boolean };
  records: { status: string; count: number; truncated: boolean };
  device: { manufacturer: string | null; model: string | null; sdkInt: number | null };
}

/** The local hour of an instant, in the zone the phone reported. */
function hourFinder(timezone: string, utcOffsetMinutes: number): (epochMs: number) => number {
  if (isValidTimeZone(timezone)) {
    const format = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' });
    return epochMs => Number(format.format(new Date(epochMs))) % 24;
  }
  return epochMs => Math.floor((((epochMs / 60_000 + utcOffsetMinutes) % 1440) + 1440) % 1440 / 60);
}

export function summarise(snapshot: SignedSnapshot, config: AppConfig['activity']): DeviceDayEvidence {
  const t = config.thresholds;
  const hourOf = hourFinder(snapshot.clock.timezone, snapshot.clock.utcOffsetMinutes);

  const hourly = Array.from({ length: 24 }, () => 0);
  const minutes = snapshot.minutes ?? [];
  let timedSteps = 0;
  let untimedSteps = 0;
  let chargingSteps = 0;
  let vehicleSteps = 0;
  let activeMinutes = 0;
  let nightSteps = 0;
  let peakMinuteSteps = 0;
  for (const minute of minutes) {
    const hour = hourOf(minute.minuteStart);
    const all = minute.steps + minute.untimedSteps;
    hourly[hour] += all;
    timedSteps += minute.steps;
    untimedSteps += minute.untimedSteps;
    chargingSteps += minute.chargingSteps;
    vehicleSteps += minute.vehicleSteps;
    if (minute.steps >= config.activeMinuteSteps) activeMinutes += 1;
    if (hour >= 1 && hour < 5) nightSteps += all;
    peakMinuteSteps = Math.max(peakMinuteSteps, minute.steps);
  }

  const windows = snapshot.motionWindows ?? [];
  const motion = { walk: 0, shake: 0, still: 0, other: 0, stepWindows: 0 };
  for (const window of windows) {
    const kind = classifyWindow(window, t);
    if (kind === 'idle') continue;
    motion.stepWindows += 1;
    motion[kind] += 1;
  }

  const events = snapshot.integrity.events;
  const jumpMs = t.clockJumpMinutes * 60_000;
  const clockJumps = events.filter(event => {
    if (event.type !== 'clock_changed') return false;
    const jump = Number(event.detail?.jumpMs ?? 0);
    return Math.abs(jump) > jumpMs;
  }).length;

  return {
    libraryVersion: snapshot.libraryVersion,
    sensor: snapshot.sensor,
    timezone: snapshot.clock.timezone,
    utcOffsetMinutes: snapshot.clock.utcOffsetMinutes,
    signedAt: snapshot.signedAt,
    wallClockMs: snapshot.clock.wallClockMs,
    deviceSteps: Math.round(snapshot.deviceSteps),
    recoveredSteps: Math.round(snapshot.recoveredSteps),
    suspectSteps: Math.round(snapshot.suspectSteps),
    coverageStartAt: snapshot.coverageStartAt,
    resolved: {
      steps: Math.round(snapshot.resolved.steps),
      usedExternal: snapshot.resolved.usedExternal,
      packageName: snapshot.resolved.packageName ?? null,
      kind: snapshot.resolved.kind,
      manualStepsExcluded: Math.round(snapshot.resolved.manualStepsExcluded),
      distanceSource: snapshot.resolved.distanceSource ?? null,
    },
    sourcesStatus: snapshot.sourcesStatus,
    // This app's own mirror of the phone's count is the phone's count; Vokve
    // writes none, but a source that says it is ours is never a second one.
    sources: snapshot.sources
      .filter(source => !source.isSelf)
      .map(source => ({
        packageName: source.packageName,
        appName: source.appName,
        kind: source.kind,
        steps: Math.round(source.steps),
        distance: source.distance,
        manualSteps: Math.round(source.manualSteps),
        unknownMethodSteps: Math.round(source.unknownMethodSteps),
        isWearable: source.isWearable,
        trustedWearable: source.trustedWearable,
        isPlatform: source.isPlatform,
        distanceSource: source.distanceSource ?? null,
        hourlySteps:
          source.hourlySteps.length === 24 && source.hourlySteps.every(steps => steps >= 0)
            ? source.hourlySteps.map(steps => Math.round(steps))
            : null,
      })),
    minutes: {
      status: snapshot.minutesStatus ?? 'absent',
      count: minutes.length,
      timedSteps,
      untimedSteps,
      chargingSteps,
      vehicleSteps,
      activeMinutes,
      nightSteps,
      peakMinuteSteps,
    },
    hourly,
    motion: { status: snapshot.motionWindowsStatus ?? 'absent', windows: windows.length, ...motion },
    checks: {
      enabled: snapshot.integrity.enabled,
      mode: snapshot.integrity.mode,
      strong: snapshot.integrity.flags
        .filter(flag => flag.severity === 'strong')
        .map(flag => ({ type: flag.type, steps: Math.round(flag.steps) })),
      weak: snapshot.integrity.flags
        .filter(flag => flag.severity === 'weak')
        .map(flag => ({ type: flag.type, steps: Math.round(flag.steps) })),
      clockJumps,
      configChanges: events.filter(event => event.type === 'config_changed').length,
      resets: events.filter(event => event.type === 'reset_today' || event.type === 'history_cleared').length,
    },
    hints: { ...snapshot.integrity.device },
    health: {
      recoveryCount: Math.round(snapshot.health.recoveryCount),
      aggressiveOem: snapshot.health.aggressiveOem,
      batteryOptimizationEnabled: snapshot.health.batteryOptimizationEnabled,
    },
    records: {
      status: snapshot.healthConnectRecords?.status ?? 'absent',
      count: snapshot.healthConnectRecords?.records.length ?? 0,
      truncated: snapshot.healthConnectRecords?.truncated ?? false,
    },
    device: {
      manufacturer: snapshot.capabilities.manufacturer ?? null,
      model: snapshot.capabilities.model ?? null,
      sdkInt: snapshot.capabilities.sdkInt ?? null,
    },
  };
}
