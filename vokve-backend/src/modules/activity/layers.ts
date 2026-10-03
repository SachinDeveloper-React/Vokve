import type { AppConfig } from '../../config/defaults.js';
import type { FlagLayer } from '../integrity/models.js';
import type { DeviceDayEvidence, SourceEvidence } from './snapshot.js';

/**
 * The fraud layers (BACKEND §7.5, RULES A14–A20), as pure functions of what
 * a day's snapshots proved. No single check catches fake steps; each layer
 * scores 0–100, a layer with nothing to judge stays out of the mean, and a
 * hard flag makes the day unverified whatever the score.
 *
 * Shadow mode (RULES T9, D-05) is not decided here: these always say what
 * they found. Whether a finding costs anybody anything is the caller's call.
 */

export type Severity = 'hard' | 'soft' | 'info';
export type LayerName = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

export interface DayFlag {
  layer: FlagLayer;
  kind: string;
  severity: Severity;
  deviceId: string | null;
  details: Record<string, unknown>;
}

/** What the server holds about one device that sent the day. */
export interface DeviceInput {
  deviceId: string;
  evidence: DeviceDayEvidence;
  key: {
    attested: boolean;
    failure: string | null;
    verifiedBootState: string | null;
    deviceLocked: boolean | null;
  } | null;
  play: { verdict: string; reasons: string[] } | null;
  /** Other accounts this install or vendor id is registered to (A18). */
  sharedAccounts: number;
  /** Other accounts holding this device's attestation key. */
  keySharedAccounts: number;
  firstSeenAt: Date | null;
}

/** The user's earlier days, newest first — what the behavioural checks compare with (A17). */
export interface HistoryDay {
  localDay: string;
  pedometerSteps: number | null;
}

/**
 * What became of one Health Connect source on one device's day:
 * - `used` — it answered for the day: allowed, and above the phone's clean count;
 * - `lower` — allowed and believable, and the phone (or another source) counted more;
 * - `not_counted` — allowed, but more than ⚙ `pedometerRatio.hard` times what the phone saw (A15);
 * - `unverified` — an app not on the allowlist: shown, never paid (A14);
 * - `blocked` — on the denylist;
 * - `not_computed` — the tracker could not split typed-in from counted steps.
 */
export type SourceStatus = 'used' | 'lower' | 'not_counted' | 'unverified' | 'blocked' | 'not_computed';

export interface SourceDecision {
  packageName: string;
  appName: string;
  kind: string;
  isWearable: boolean;
  isPlatform: boolean;
  /** Everything the app wrote for the day. */
  steps: number;
  /** Typed in by hand; null when not computed. */
  manualSteps: number | null;
  /** Recording method not stated; null when not computed. */
  unknownMethodSteps: number | null;
  /** What could count: `steps` less the above, as config has it. */
  countable: number | null;
  /** `countable` ÷ the phone's own count; null when either is missing. */
  ratioToPhone: number | null;
  standing: 'allowed' | 'denied' | 'unknown';
  status: SourceStatus;
}

export interface DeviceScore {
  deviceId: string;
  /** What the day shows: what the phone showed its user, or the server's count when higher. */
  displaySteps: number;
  /** The phone's own count, and what was taken off it before it competed. */
  phone: { counted: number; recovered: number; flagged: number; clean: number };
  /** The phone's own count, less what it recovered in one go or flagged. */
  phoneClean: number;
  /** Every Health Connect source the device reported, and what became of it. */
  sources: SourceDecision[];
  /** The best count this device's evidence supports, before the day is judged. */
  candidate: number;
  source: 'device' | 'health_connect';
  winner: SourceEvidence | null;
  layers: Record<LayerName, number | null>;
  plausibility: number;
  flags: DayFlag[];
  hard: string[];
  verified: boolean;
  verifiedSteps: number;
}

type ActivityConfig = AppConfig['activity'];

/** `com.android.healthconnect.phone.*` matches by prefix; anything else exactly. */
export function matchesPackage(packageName: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern =>
    pattern.endsWith('*') ? packageName.startsWith(pattern.slice(0, -1)) : packageName === pattern,
  );
}

/**
 * A source's steps that may count: typed-in steps never do (A1), and steps
 * whose recording method is unstated only when config says so (§7.4). Null
 * when the split was not computed — such a total cannot be judged.
 */
export function countableSteps(source: SourceEvidence, provenance: ActivityConfig['provenance']): number | null {
  if (source.manualSteps < 0) return null;
  let steps = source.steps - source.manualSteps;
  if (!provenance.countUnknownMethod) {
    if (source.unknownMethodSteps < 0) return null;
    steps -= source.unknownMethodSteps;
  }
  return Math.max(0, steps);
}

function sourceStanding(source: SourceEvidence, provenance: ActivityConfig['provenance']): 'denied' | 'allowed' | 'unknown' {
  if (matchesPackage(source.packageName, provenance.deny)) return 'denied';
  if (matchesPackage(source.packageName, provenance.allow)) return 'allowed';
  if (provenance.trustTrackerCatalog && source.trustedWearable) return 'allowed';
  return 'unknown';
}

export function scoreDevice(
  input: DeviceInput,
  history: HistoryDay[],
  now: Date,
  config: AppConfig,
): DeviceScore {
  const ev = input.evidence;
  const t = config.activity.thresholds;
  const flags: DayFlag[] = [];
  const flag = (layer: FlagLayer, kind: string, severity: Severity, details: Record<string, unknown> = {}) =>
    flags.push({ layer, kind, severity, deviceId: input.deviceId, details });

  const deviceSteps = ev.deviceSteps;
  const phoneClean = Math.max(0, deviceSteps - ev.recoveredSteps - ev.suspectSteps);

  // ─── L0 · device integrity ──────────────────────────────────────────────
  let l0 = 100;
  const key = input.key;
  if (!key) {
    l0 = 0;
    flag('L0', 'no_key', 'hard');
  } else if (!key.attested) {
    // A broken or misdirected chain is a forgery; a chain that simply proves
    // nothing is a phone that cannot attest, and costs score only.
    if (key.failure === 'chain_invalid' || key.failure === 'revoked' || key.failure === 'wrong_package' || key.failure === 'wrong_signer') {
      l0 = 0;
      flag('L0', `attestation_${key.failure}`, 'hard');
    } else {
      l0 = Math.min(l0, 40);
      flag('L0', 'key_not_attested', 'soft', { failure: key.failure });
    }
  } else if (key.verifiedBootState !== 'verified' || key.deviceLocked === false) {
    // An unlocked bootloader or an OS its maker did not sign: the phone can
    // be made to say anything.
    l0 = 10;
    flag('L0', 'boot_not_verified', 'hard', { verifiedBootState: key.verifiedBootState, deviceLocked: key.deviceLocked });
  }

  const play = input.play;
  if (play) {
    if (play.verdict === 'fail') {
      const hardReasons = play.reasons.filter(reason => reason !== 'stale_token' && reason !== 'unlicensed');
      if (hardReasons.length > 0) {
        l0 = Math.min(l0, 0);
        flag('L0', 'play_integrity_failed', 'hard', { reasons: play.reasons });
      } else {
        l0 = Math.min(l0, 70);
        flag('L0', 'play_integrity_weak', 'soft', { reasons: play.reasons });
      }
    } else if (play.verdict === 'unavailable') {
      l0 = Math.min(l0, 70);
      flag('L0', 'play_integrity_unavailable', 'soft', { reasons: play.reasons });
    }
  }

  if (ev.hints.emulator) {
    l0 = 0;
    flag('L0', 'emulator', 'hard');
  }
  if (ev.hints.suBinary || ev.hints.testKeysBuild) {
    l0 = Math.min(l0, 30);
    flag('L0', 'rooted', 'soft', { suBinary: ev.hints.suBinary, testKeysBuild: ev.hints.testKeysBuild });
  }
  if (ev.hints.appDebuggable) {
    l0 = Math.min(l0, 50);
    flag('L0', 'debug_build', 'soft');
  }
  if (ev.hints.adbEnabled || ev.hints.developerOptions) {
    flag('L0', 'developer_options', 'info', { adb: ev.hints.adbEnabled });
  }

  // ─── L1 · provenance ────────────────────────────────────────────────────
  let l1: number | null = null;
  const provenance = config.activity.provenance;
  const external: { source: SourceEvidence; steps: number }[] = [];
  const decisions = new Map<SourceEvidence, SourceDecision>();
  const decide = (source: SourceEvidence, standing: SourceDecision['standing'], countable: number | null, status: SourceStatus) =>
    decisions.set(source, {
      packageName: source.packageName,
      appName: source.appName,
      kind: source.kind,
      isWearable: source.isWearable,
      isPlatform: source.isPlatform,
      steps: source.steps,
      manualSteps: source.manualSteps >= 0 ? source.manualSteps : null,
      unknownMethodSteps: source.unknownMethodSteps >= 0 ? source.unknownMethodSteps : null,
      countable,
      ratioToPhone: countable !== null && deviceSteps > 0 ? round2(countable / deviceSteps) : null,
      standing,
      status,
    });
  if (ev.sources.length > 0) {
    l1 = 100;
    for (const source of ev.sources) {
      const standing = sourceStanding(source, provenance);
      if (standing === 'denied') {
        l1 = Math.min(l1, 40);
        flag('L1', 'denylisted_source', 'soft', { packageName: source.packageName, steps: source.steps });
        decide(source, standing, null, 'blocked');
        continue;
      }
      if (source.manualSteps > 0) {
        l1 = Math.min(l1, 80);
        flag('L1', 'manual_entries', 'soft', { packageName: source.packageName, manualSteps: source.manualSteps });
      }
      const steps = countableSteps(source, provenance);
      if (steps === null) {
        decide(source, standing, null, 'not_computed');
        continue;
      }
      if (standing === 'allowed') {
        external.push({ source, steps });
        decide(source, standing, steps, 'lower');
        continue;
      }
      decide(source, standing, steps, 'unverified');
      if (steps > phoneClean) {
        // Shown to the user, never paid, never punished (A14).
        l1 = Math.min(l1, 90);
        flag('L1', 'unverified_source', 'info', { packageName: source.packageName, steps });
      }
    }
  }

  // ─── L3 · cross-source ──────────────────────────────────────────────────
  let l3: number | null = null;
  const ratio = config.activity.thresholds.pedometerRatio;
  let best: { source: SourceEvidence; steps: number } | null = null;
  for (const candidate of external) {
    if (candidate.steps <= 0) continue;
    if (deviceSteps > 0) {
      const r = candidate.steps / deviceSteps;
      if (r > ratio.hard) {
        // More than double what the phone saw: the surplus cannot be
        // corroborated, so the source does not count and the day falls back
        // on the phone's own count (A15).
        l3 = Math.min(l3 ?? 100, 30);
        flag('L3', 'pedometer_mismatch', 'soft', { packageName: candidate.source.packageName, ratio: round2(r), hard: true });
        decisions.get(candidate.source)!.status = 'not_counted';
        continue;
      }
      if (r < ratio.min || r > ratio.max) {
        l3 = Math.min(l3 ?? 100, 60);
        flag('L3', 'pedometer_mismatch', 'soft', { packageName: candidate.source.packageName, ratio: round2(r) });
      } else {
        l3 = l3 ?? 100;
      }
    }
    if (!best || candidate.steps > best.steps) best = candidate;
  }

  const externalWins = best !== null && best.steps > phoneClean;
  const candidate = externalWins ? best!.steps : phoneClean;
  const winner = externalWins ? best!.source : null;
  if (winner) decisions.get(winner)!.status = 'used';

  // ─── L2 · statistical plausibility ──────────────────────────────────────
  let l2 = 100;
  if (deviceSteps > 0) {
    const suspectShare = ev.suspectSteps / deviceSteps;
    l2 = Math.round(100 * (1 - Math.min(1, suspectShare)));
    if (suspectShare >= t.suspectShareHard) {
      flag('L2', 'suspect_motion', 'hard', { suspectSteps: ev.suspectSteps, share: round2(suspectShare), strong: ev.checks.strong });
    } else if (ev.suspectSteps > 0) {
      flag('L2', 'suspect_motion', 'soft', { suspectSteps: ev.suspectSteps, share: round2(suspectShare), strong: ev.checks.strong });
    }
    if (ev.minutes.status === 'enabled') {
      const untimedShare = ev.minutes.untimedSteps / deviceSteps;
      if (untimedShare > t.untimedShare) {
        l2 = Math.max(0, l2 - 20);
        flag('L2', 'untimed_steps', 'soft', { share: round2(untimedShare) });
      }
    }
  }
  const dayTotal = Math.max(deviceSteps, candidate);
  if (dayTotal > t.maxDailySteps) {
    l2 = Math.min(l2, 60);
    flag('L2', 'daily_volume', 'soft', { steps: dayTotal });
  }
  if (!ev.checks.enabled) {
    l2 = Math.min(l2, 50);
    flag('L2', 'checks_disabled', 'soft');
  } else if (ev.minutes.status !== 'enabled') {
    l2 = Math.min(l2, 60);
    flag('L2', 'no_minutes', 'soft', { status: ev.minutes.status });
  }
  if (ev.checks.clockJumps > 0) {
    l2 = Math.min(l2, 70);
    flag('L2', 'clock_changed', 'soft', { jumps: ev.checks.clockJumps });
  }
  if (ev.signedAt > now.getTime() + config.activity.futureSkewMinutes * 60_000) {
    flag('L2', 'clock_ahead', 'hard', { signedAt: ev.signedAt, serverAt: now.getTime() });
  }
  if (ev.checks.resets > 0) flag('L2', 'counter_reset', 'info', { resets: ev.checks.resets });
  if (winner && winner.distanceSource === 'health_connect' && winner.distance > 0 && best!.steps > 0) {
    const stride = winner.distance / best!.steps;
    if (stride < t.strideMeters.min || stride > t.strideMeters.max) {
      l2 = Math.max(0, l2 - 20);
      flag('L2', 'stride_incoherent', 'soft', { packageName: winner.packageName, stride: round2(stride) });
    }
  }

  // ─── L4 · motion signature ──────────────────────────────────────────────
  let l4: number | null = null;
  if (ev.motion.status === 'disabled') {
    // Opting out lowers trust, never blocks (D-23).
    flag('L4', 'motion_disabled', 'info');
  } else if (ev.motion.status === 'enabled' && ev.motion.stepWindows > 0) {
    const nonWalk = ev.motion.shake + ev.motion.still;
    const share = nonWalk / ev.motion.stepWindows;
    l4 = Math.round(100 * (1 - share));
    if (share >= t.motion.nonWalkHardShare) {
      flag('L4', 'motion_non_walk', 'hard', { share: round2(share), windows: ev.motion.stepWindows, shake: ev.motion.shake, still: ev.motion.still });
    } else if (ev.motion.shake > 0) {
      flag('L4', 'shake_windows', 'soft', { shake: ev.motion.shake, windows: ev.motion.stepWindows });
    }
  }

  // ─── L5 · temporal and behavioural ──────────────────────────────────────
  let l5 = 100;
  const behaviour = (kind: string, details: Record<string, unknown>) => {
    l5 = Math.max(0, l5 - 25);
    flag('L5', kind, 'soft', details);
  };
  if (deviceSteps > 0 && ev.minutes.status === 'enabled') {
    const nightShare = ev.minutes.nightSteps / deviceSteps;
    if (nightShare > t.nightShare) behaviour('night_steps', { share: round2(nightShare) });
  }
  if (
    input.firstSeenAt &&
    ev.signedAt - input.firstSeenAt.getTime() < 24 * 3_600_000 &&
    dayTotal >= t.newInstallSteps
  ) {
    behaviour('new_install_volume', { steps: dayTotal });
  }
  const recent = [deviceSteps, ...history.slice(0, 6).map(day => day.pedometerSteps ?? 0)];
  const round = recent.filter(steps => steps >= 1000 && steps % 1000 === 0).length;
  if (round >= t.roundTotalDays) behaviour('round_totals', { days: round });
  const yesterday = history[0]?.pedometerSteps ?? null;
  if (deviceSteps > 0 && yesterday === deviceSteps) behaviour('identical_totals', { steps: deviceSteps });

  // ─── L6 · graph ─────────────────────────────────────────────────────────
  let l6 = 100;
  if (input.keySharedAccounts > 0) {
    l6 = 0;
    flag('L6', 'key_shared', 'hard', { accounts: input.keySharedAccounts + 1 });
  }
  if (input.sharedAccounts + 1 >= config.devices.flagAtAccountsPerDevice) {
    l6 = Math.min(l6, 50);
    flag('L6', 'device_shared', 'soft', { accounts: input.sharedAccounts + 1 });
  }

  const layers: Record<LayerName, number | null> = { L0: l0, L1: l1, L2: l2, L3: l3, L4: l4, L5: l5, L6: l6 };
  const plausibility = weightedScore(layers, config.activity.weights);
  const hard = flags.filter(f => f.severity === 'hard').map(f => f.kind);
  const verified = hard.length === 0 && plausibility >= config.activity.verifiedMinScore;

  return {
    deviceId: input.deviceId,
    // Never below what the server itself decided the day is worth.
    displaySteps: Math.max(ev.resolved.steps, deviceSteps, candidate),
    phone: { counted: deviceSteps, recovered: ev.recoveredSteps, flagged: ev.suspectSteps, clean: phoneClean },
    phoneClean,
    sources: ev.sources.map(source => decisions.get(source)!).filter(Boolean),
    candidate,
    source: externalWins ? 'health_connect' : 'device',
    winner,
    layers,
    plausibility,
    flags,
    hard,
    verified,
    verifiedSteps: verified ? candidate : 0,
  };
}

/** The weighted mean of the layers that had something to judge (A20). */
export function weightedScore(layers: Record<LayerName, number | null>, weights: Record<LayerName, number>): number {
  let total = 0;
  let weight = 0;
  for (const [name, score] of Object.entries(layers) as [LayerName, number | null][]) {
    if (score === null) continue;
    total += score * weights[name];
    weight += weights[name];
  }
  return weight === 0 ? 0 : Math.round(total / weight);
}

export interface DayScore {
  best: DeviceScore;
  devices: DeviceScore[];
  /** Every device's flags, once per kind. */
  flags: DayFlag[];
  displaySteps: number;
}

/**
 * A user's day across their devices. Never added together — the same walk
 * is counted by every phone in the pocket — the day is the best verified
 * device's; every device's flags are kept, so a rooted second phone is on
 * the record whichever phone pays.
 */
export function scoreDay(devices: DeviceInput[], history: HistoryDay[], now: Date, config: AppConfig): DayScore {
  const scored = devices.map(device => scoreDevice(device, history, now, config));
  const best = scored.reduce((a, b) =>
    b.verifiedSteps > a.verifiedSteps || (b.verifiedSteps === a.verifiedSteps && b.displaySteps > a.displaySteps) ? b : a,
  );
  const seen = new Set<string>();
  const flags: DayFlag[] = [];
  for (const device of [best, ...scored.filter(s => s !== best)]) {
    for (const f of device.flags) {
      if (seen.has(f.kind)) continue;
      seen.add(f.kind);
      flags.push(f);
    }
  }
  return { best, devices: scored, flags, displaySteps: Math.max(...scored.map(s => s.displaySteps)) };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
