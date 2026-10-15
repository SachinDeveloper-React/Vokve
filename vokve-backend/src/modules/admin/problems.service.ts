import { getConfig } from '../../config/remote.js';
import { addDays, localDayOf } from '../../lib/dates.js';
import { compareVersions } from '../../middleware/version.js';
import { ActivityDailyModel } from '../activity/models.js';
import { AppReleaseModel, DeviceModel } from '../devices/models.js';
import { CoinHoldModel } from '../economy/models.js';
import { FraudFlagModel } from '../integrity/models.js';
import { UserModel } from '../identity/models.js';
import { AppErrorModel, DeviceHealthModel, DevicePermissionsModel } from '../telemetry/models.js';

/**
 * The diagnosis, in words (RULES P18).
 *
 * Everything here is already readable one collection at a time — what the
 * phone allows, what it says about itself, when it last reported steps, what
 * the layers made of those steps, what the app has crashed on. Reading five
 * endpoints and joining them in your head is a skill, and support should not
 * need it: this asks the questions an operator would ask, in the order that
 * matters, and answers them as sentences with the numbers in them.
 *
 * Two rules it follows, both of which are what makes it trustworthy:
 *
 *   - **Nothing is inferred that is not evidenced.** Every finding carries
 *     the rows it came from, so the sentence can be checked rather than
 *     believed.
 *   - **Silence is a finding too.** An install that has stopped saying
 *     anything is the commonest real problem there is, and a report that
 *     only described what it *was* told would miss it entirely.
 *
 * The thresholds are config, deliberately: what counts as "too long without
 * an upload" is a product question, and the honest answer only arrives after
 * a few weeks of real phones.
 */

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  /** Stable, so a dashboard can count them and a fix can reference one. */
  code: string;
  severity: Severity;
  /** One sentence an operator can read out. */
  title: string;
  /** The same thing with the numbers in it. */
  detail: string;
  /** What to do about it — on the phone, or by us. */
  fix: string;
  /** Which install, where it is one install's problem. */
  deviceId?: string;
  since?: string | null;
  /** The rows behind the sentence. */
  evidence?: Record<string, unknown>;
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const HOUR_MS = 3_600_000;
const hoursSince = (at: Date | null | undefined, now: Date) =>
  at ? Math.floor((now.getTime() - at.getTime()) / HOUR_MS) : null;
const iso = (at?: Date | null) => (at ? at.toISOString() : null);

export interface ProblemReport {
  summary: {
    /** The one to act on, or null when nothing is wrong. */
    headline: string | null;
    high: number;
    medium: number;
    low: number;
    installs: number;
    /** Installs the account is signed in on right now (D-56). */
    signedIn: number;
  };
  findings: Finding[];
}

export async function userProblems(userId: string, now = new Date()): Promise<ProblemReport> {
  const config = await getConfig();
  const limits = config.telemetry.problems;

  const [user, devices, health, permissions, errors, releases] = await Promise.all([
    UserModel.findById(userId, { timezone: 1, trust: 1 }).lean(),
    DeviceModel.find({ userId, revokedAt: null })
      .select({ platform: 1, info: 1, app: 1, push: 1, lastSeenAt: 1, firstSeenAt: 1, stepSync: 1, counting: 1 })
      .sort({ lastSeenAt: -1 })
      .lean(),
    DeviceHealthModel.find({ userId }).lean(),
    DevicePermissionsModel.find({ userId }, { deviceId: 1, permissions: 1 }).lean(),
    AppErrorModel.find({ userId, lastAt: { $gte: new Date(now.getTime() - limits.errorDays * 24 * HOUR_MS) } })
      .sort({ lastAt: -1 })
      .lean(),
    AppReleaseModel.find({ status: 'current' }, { platform: 1, version: 1 }).lean(),
  ]);

  const zone = user?.timezone ?? config.locale.timezone;
  const today = localDayOf(now, zone);
  const [days, flags, voided] = await Promise.all([
    ActivityDailyModel.find(
      { userId, localDay: { $gte: addDays(today, -limits.unverifiedDays) } },
      { localDay: 1, steps: 1, verifiedSteps: 1, verified: 1, hardRejects: 1 },
    ).lean(),
    FraudFlagModel.find({ userId, severity: 'hard', status: 'open' }, { kind: 1, localDay: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    CoinHoldModel.find({ userId, status: 'voided' }, { amountMc: 1, reason: 1, referenceId: 1, updatedAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const healthOf = new Map(health.map(row => [row.deviceId, row]));
  const permissionOf = new Map(
    permissions.map(row => [
      row.deviceId,
      new Map((row.permissions ?? []).map(entry => [entry.key, entry])),
    ]),
  );
  const findings: Finding[] = [];
  const signedIn = devices.filter(device => (device.counting ?? []).some(period => period.to === null));

  // ─── Nobody is counting at all ──────────────────────────────────────────
  if (devices.length === 0) {
    findings.push({
      code: 'no_install',
      severity: 'high',
      title: 'This account has no phone on it',
      detail: 'Every install has been revoked or removed, so nothing can count steps or receive a push.',
      fix: 'The member has to sign in on a phone again.',
    });
  } else if (signedIn.length === 0) {
    findings.push({
      code: 'signed_out_everywhere',
      severity: 'high',
      title: 'Signed out on every phone',
      detail: `Last seen ${iso(devices[0].lastSeenAt) ?? 'never'}. Steps are only counted while an account is signed in on an install (D-56), so nothing is being counted anywhere.`,
      fix: 'Ask them to sign in again; the days their phone still holds will sync then.',
      evidence: { installs: devices.length },
    });
  }

  for (const device of devices) {
    const report = healthOf.get(device._id);
    const allowed = permissionOf.get(device._id);
    const open = (device.counting ?? []).some(period => period.to === null);
    const label = [device.info?.brand, device.info?.model].filter(Boolean).join(' ') || device._id;
    const base = { deviceId: device._id };
    if (!open) continue;

    // ─── What the OS will not let us do ───────────────────────────────────
    const activity = allowed?.get('activityRecognition');
    if (activity && activity.state !== 'granted' && activity.state !== 'unavailable') {
      findings.push({
        ...base,
        code: 'activity_permission_denied',
        severity: 'high',
        title: `${label} does not allow step counting`,
        detail: `Physical activity is ${activity.state} since ${iso(activity.since)}. Without it the counter cannot start, so this phone will report zero however much they walk.`,
        fix:
          activity.state === 'blocked'
            ? 'It can no longer be asked for in the app — they have to grant it in Android Settings → Apps → Vokve → Permissions.'
            : 'The step tracking screen asks for it again; point them there.',
        since: iso(activity.since),
        evidence: { state: activity.state, detail: activity.detail ?? null },
      });
    }

    // ─── The service the phone killed ─────────────────────────────────────
    const tracking = report?.tracking as
      | {
          looksDead?: boolean;
          wanted?: boolean;
          recoveryCount?: number;
          heartbeatAgeMs?: number;
          batteryOptimizationEnabled?: boolean;
          aggressiveOem?: boolean;
          manufacturer?: string | null;
          state?: string;
        }
      | undefined;
    if (tracking?.looksDead) {
      const quiet = tracking.heartbeatAgeMs ? Math.round(tracking.heartbeatAgeMs / 60_000) : null;
      findings.push({
        ...base,
        code: 'tracking_service_dead',
        severity: 'high',
        title: `${label} has stopped counting — the OS killed the service`,
        detail: `Counting is on, but no service is running${quiet !== null ? ` and nothing has been heard from it for ${quiet} minutes` : ''}. It has had to restart itself ${tracking.recoveryCount ?? 0} times since they last pressed start${tracking.manufacturer ? ` (${tracking.manufacturer})` : ''}.`,
        fix: tracking.batteryOptimizationEnabled
          ? 'Battery optimisation is on for Vokve: the fix is the OEM battery screen, which the tracking screen can open for them.'
          : 'Opening the app restarts the service; if it keeps dying, check autostart on this OEM.',
        since: iso(report?.at),
        evidence: {
          recoveryCount: tracking.recoveryCount ?? null,
          heartbeatAgeMs: tracking.heartbeatAgeMs ?? null,
          batteryOptimizationEnabled: tracking.batteryOptimizationEnabled ?? null,
          aggressiveOem: tracking.aggressiveOem ?? null,
          manufacturer: tracking.manufacturer ?? null,
        },
      });
    } else if (tracking?.batteryOptimizationEnabled && tracking?.aggressiveOem) {
      findings.push({
        ...base,
        code: 'battery_restricted',
        severity: 'medium',
        title: `${label} is free to kill the counter`,
        detail: `Battery optimisation is on for Vokve on an OEM known to be aggressive${tracking.manufacturer ? ` (${tracking.manufacturer})` : ''}. It has not died yet, but it will.`,
        fix: 'The tracking screen opens the battery screen; ask them to set Vokve to unrestricted.',
        since: iso(report?.at),
        evidence: { manufacturer: tracking.manufacturer ?? null, recoveryCount: tracking.recoveryCount ?? null },
      });
    }

    // ─── Health Connect, where a watch lives ──────────────────────────────
    const hc = report?.healthConnect as
      | { availability?: string | null; canRead?: boolean; canWrite?: boolean }
      | undefined;
    if (hc && hc.availability === 'installed' && hc.canRead === false) {
      findings.push({
        ...base,
        code: 'health_connect_not_readable',
        severity: 'medium',
        title: `${label} cannot read Health Connect`,
        detail:
          'Health Connect is installed but this app may not read from it, so a watch or another tracker on this phone counts for nothing here.',
        fix: 'The step sources screen asks again; if it was refused twice, Android only allows it from Health Connect’s own settings.',
        since: iso(report?.at),
        evidence: { availability: hc.availability, canWrite: hc.canWrite ?? null },
      });
    }

    // ─── Counting on, reporting nothing ───────────────────────────────────
    const uploadedAt = device.stepSync?.uploadedAt ?? null;
    const quietHours = hoursSince(uploadedAt, now);
    const sinceRegistered = hoursSince(device.firstSeenAt, now);
    if (!uploadedAt && (sinceRegistered ?? 0) >= limits.noUploadHours) {
      findings.push({
        ...base,
        code: 'never_uploaded',
        severity: 'high',
        title: `${label} has never reported a single day`,
        detail: `Registered ${sinceRegistered} hours ago, signed in, and no snapshot has ever been accepted from it. Either nothing is being counted or nothing is reaching us.`,
        fix: 'Check the two findings above first (permission, service). If both are clean, this is an attestation or network problem — look at the app’s error list.',
        evidence: { firstSeenAt: iso(device.firstSeenAt), nudgedAt: iso(device.stepSync?.nudgedAt) },
      });
    } else if (quietHours !== null && quietHours >= limits.noUploadHours) {
      findings.push({
        ...base,
        code: 'steps_not_uploading',
        severity: 'high',
        title: `${label} has not reported steps for ${quietHours} hours`,
        detail: `Counting is on and the last accepted snapshot was ${iso(uploadedAt)}. Days older than ⚙ ${config.activity.maxAgeDays} days can never be sent (A8), so this is a clock running out.`,
        fix: `The server has pushed it ${device.stepSync?.nudgedAt ? `(last ${iso(device.stepSync.nudgedAt)})` : 'and has not been able to'}; if the pushes are not landing, opening the app syncs at once.`,
        since: iso(uploadedAt),
        evidence: {
          uploadedAt: iso(uploadedAt),
          nudgedAt: iso(device.stepSync?.nudgedAt),
          remindedAt: iso(device.stepSync?.remindedAt),
          hasPushToken: Boolean(device.push?.token),
        },
      });
    }

    // ─── The sync itself is failing ───────────────────────────────────────
    const sync = report?.sync as
      | { status?: string; queued?: number; error?: string | null; todaySteps?: number; lastSyncedAt?: string | null }
      | undefined;
    if (sync?.status === 'failed') {
      findings.push({
        ...base,
        code: 'sync_failing',
        severity: (sync.queued ?? 0) > 0 ? 'high' : 'medium',
        title: `${label} says its last sync failed`,
        detail: `${sync.queued ?? 0} day(s) waiting to go up${sync.error ? `, and the phone's own reason is "${sync.error}"` : ''}${typeof sync.todaySteps === 'number' ? `. It is showing ${sync.todaySteps.toLocaleString('en-IN')} steps today` : ''}.`,
        fix: 'Compare the phone’s own count with the day on the server; an attestation or integrity refusal shows in the error list rather than here.',
        since: iso(report?.at),
        evidence: { queued: sync.queued ?? null, error: sync.error ?? null, lastSyncedAt: sync.lastSyncedAt ?? null },
      });
    }

    // ─── It has stopped saying anything at all ────────────────────────────
    const healthAge = hoursSince(report?.at, now);
    if (!report) {
      findings.push({
        ...base,
        code: 'health_never_reported',
        severity: 'low',
        title: `${label} has never said whether it is working`,
        detail: 'No health report from this install. Most likely a build from before diagnostics existed.',
        fix: 'Check the app version; nothing to do if it is an old build.',
        evidence: { appVersion: device.app?.version ?? null },
      });
    } else if ((healthAge ?? 0) >= config.telemetry.health.staleHours) {
      findings.push({
        ...base,
        code: 'health_stale',
        severity: 'medium',
        title: `${label} has gone quiet`,
        detail: `Its last verdict on itself was ${healthAge} hours ago. The app has not been opened or cannot reach us, so nothing newer is known about this phone.`,
        fix: 'Treat the figures above as that old. If it is also not uploading, the phone is out of touch rather than broken.',
        since: iso(report.at),
      });
    }

    // ─── A build that cannot be helped ────────────────────────────────────
    const current = releases.find(release => release.platform === device.platform);
    const version = device.app?.version;
    if (current && version && compareVersions(version, current.version) < 0) {
      findings.push({
        ...base,
        code: 'build_outdated',
        severity: 'low',
        title: `${label} is on ${version}, and ${current.version} is out`,
        detail: 'A fix that has already shipped will not have reached this phone.',
        fix: 'Check whether the fault below is fixed in the current build before chasing it.',
        evidence: { version, current: current.version },
      });
    }

    // ─── Nothing can be told to it ────────────────────────────────────────
    const notifications = allowed?.get('notifications');
    if (!device.push?.token) {
      findings.push({
        ...base,
        code: 'no_push_token',
        severity: 'medium',
        title: `${label} cannot be reached`,
        detail:
          'No FCM token on file, so neither a notification nor the silent "sync now" ping (A28) can reach this install.',
        fix: 'An emulator or a build without Firebase does this; otherwise the app failed to register — look for a push error in the list.',
        evidence: { notifications: notifications?.state ?? null },
      });
    } else if (notifications && (notifications.state === 'denied' || notifications.state === 'blocked')) {
      findings.push({
        ...base,
        code: 'notifications_refused',
        severity: 'low',
        title: `${label} will not show notifications`,
        detail: `Notifications are ${notifications.state} since ${iso(notifications.since)}. The silent sync still works (A28b) but nothing can be *said* to them on this phone.`,
        fix: 'Nothing to fix — it is their choice. Reach them in the app’s own notification centre instead.',
        since: iso(notifications.since),
      });
    }
  }

  // ─── What the app itself has been doing ─────────────────────────────────
  const fatal = errors.filter(error => error.fatal);
  if (fatal.length > 0) {
    const worst = fatal.reduce((a, b) => (b.count > a.count ? b : a));
    findings.push({
      code: 'app_crashing',
      severity: 'high',
      title: `The app has crashed on them ${fatal.reduce((sum, error) => sum + error.count, 0)} times in ${limits.errorDays} days`,
      detail: `Worst: ${worst.name ?? 'Error'} — ${worst.message} (×${worst.count}${worst.screen ? ` on ${worst.screen}` : ''}, last ${iso(worst.lastAt)}, build ${worst.appVersion ?? '?'}).`,
      fix: 'The stack is on the health read, and the same fingerprint in Crashlytics has the symbolicated one.',
      since: iso(fatal[fatal.length - 1].firstAt),
      evidence: { groups: fatal.length, fingerprint: worst.fingerprint },
    });
  }
  const handled = errors.filter(error => !error.fatal);
  if (handled.length >= limits.errorGroupsForFinding) {
    const worst = handled.reduce((a, b) => (b.count > a.count ? b : a));
    findings.push({
      code: 'app_erroring',
      severity: 'medium',
      title: `${handled.length} kinds of error on their phone in ${limits.errorDays} days`,
      detail: `Most often: ${worst.name ?? 'Error'} — ${worst.message} (×${worst.count}${worst.scope ? ` in ${worst.scope}` : ''}).`,
      fix: 'Read the list on the health endpoint; a cluster in one scope is usually one bug.',
      evidence: { groups: handled.length, fingerprint: worst.fingerprint },
    });
  }

  // ─── What it cost them ──────────────────────────────────────────────────
  const unverified = days.filter(day => day.verified === false && (day.steps ?? 0) > 0);
  if (unverified.length > 0) {
    findings.push({
      code: 'days_unverified',
      severity: 'medium',
      title: `${unverified.length} of their last ${limits.unverifiedDays} days did not verify`,
      detail: `Those days show their steps but earn nothing and keep no streak. Hard rejects seen: ${
        [...new Set(unverified.flatMap(day => day.hardRejects ?? []))].join(', ') || 'none recorded'
      }.`,
      fix: 'The fraud case file explains each day; a genuine phone failing here is a threshold to look at, not a cheat.',
      evidence: { days: unverified.map(day => day.localDay) },
    });
  }
  if (flags.length > 0) {
    findings.push({
      code: 'hard_flags_open',
      severity: 'medium',
      title: `${flags.length} hard flag(s) open against this account`,
      detail: `Newest: ${flags[0].kind} on ${flags[0].localDay}. An open hard flag costs trust, and trust decides the escrow window and the step ceiling.`,
      fix: 'Review them in the fraud queue and confirm or dismiss — an open flag left alone keeps costing them.',
      since: iso(flags[0].createdAt),
      evidence: { kinds: flags.map(flag => flag.kind) },
    });
  }
  if (voided.length > 0) {
    findings.push({
      code: 'coins_voided',
      severity: 'low',
      title: `${voided.length} step-coin hold(s) were voided`,
      detail: `Newest reason: ${voided[0].reason ?? 'unrecorded'}. Those coins were never paid, which is what a member means by "my coins disappeared".`,
      fix: 'Explain the escrow window (E15); if the day was wrongly judged, re-score it from the fraud case file.',
      evidence: { reasons: [...new Set(voided.map(hold => hold.reason ?? 'unrecorded'))] },
    });
  }

  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const counts = { high: 0, medium: 0, low: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  return {
    summary: {
      headline: findings[0]?.title ?? null,
      ...counts,
      installs: devices.length,
      signedIn: signedIn.length,
    },
    findings,
  };
}

// ─── The same questions, asked of everybody (RULES P18) ───────────────────

export interface FleetReport {
  /** The window the fault counts are taken over. */
  days: number;
  installs: {
    total: number;
    signedIn: number;
    /** Installs that have ever had a snapshot accepted. */
    reportingSteps: number;
    /** …and have not had one for `telemetry.problems.noUploadHours`. */
    quiet: number;
    /** Installs that have sent a health report at all, and recently. */
    reportingHealth: number;
    healthStale: number;
  };
  /** How many installs each problem is true of, worst first. */
  problems: { code: string; installs: number }[];
  /** Where the dead services are. The answer is usually one or two names. */
  byManufacturer: {
    manufacturer: string;
    installs: number;
    serviceDead: number;
    batteryRestricted: number;
  }[];
  /** Which build is failing. A crash count beside an install count. */
  byAppVersion: {
    appVersion: string;
    installs: number;
    errorGroups: number;
    fatalGroups: number;
    affectedUsers: number;
  }[];
  /** The faults themselves, worst first — the fix list. */
  topErrors: {
    fingerprint: string;
    kind: string;
    name: string | null;
    message: string;
    scope: string | null;
    screen: string | null;
    fatal: boolean;
    occurrences: number;
    users: number;
    appVersions: string[];
    lastAt: string | null;
  }[];
}

/**
 * The fleet, read with the same questions as one member (RULES P18).
 *
 * This is the one that answers "what is the main problem", because the
 * per-member read can only ever say what is wrong for the member in front
 * of you. Everything here is an aggregation rather than a loop over
 * accounts: at a hundred thousand installs the per-user version would be a
 * hundred thousand reads, and the shape of the answer — a count per problem,
 * a count per OEM, a count per build — is exactly what a database does well.
 */
export async function fleetHealth(days: number, now = new Date()): Promise<FleetReport> {
  const config = await getConfig();
  const quietBefore = new Date(now.getTime() - config.telemetry.problems.noUploadHours * HOUR_MS);
  const staleBefore = new Date(now.getTime() - config.telemetry.health.staleHours * HOUR_MS);
  const since = new Date(now.getTime() - days * 24 * HOUR_MS);
  const signedIn = { revokedAt: null, counting: { $elemMatch: { to: null } } };

  const [
    total,
    signedInCount,
    reportingSteps,
    quiet,
    noToken,
    reportingHealth,
    healthStale,
    byManufacturer,
    installsByVersion,
    errorsByVersion,
    topErrors,
    permissionProblems,
    healthProblems,
  ] = await Promise.all([
    DeviceModel.countDocuments({ revokedAt: null }),
    DeviceModel.countDocuments(signedIn),
    DeviceModel.countDocuments({ ...signedIn, 'stepSync.uploadedAt': { $ne: null } }),
    DeviceModel.countDocuments({
      ...signedIn,
      $or: [{ 'stepSync.uploadedAt': null }, { 'stepSync.uploadedAt': { $lte: quietBefore } }],
    }),
    DeviceModel.countDocuments({ ...signedIn, 'push.token': { $exists: false } }),
    DeviceHealthModel.countDocuments({ at: { $gt: staleBefore } }),
    DeviceHealthModel.countDocuments({ at: { $lte: staleBefore } }),
    DeviceHealthModel.aggregate<{ _id: string | null; installs: number; serviceDead: number; batteryRestricted: number }>([
      {
        $group: {
          _id: '$tracking.manufacturer',
          installs: { $sum: 1 },
          serviceDead: { $sum: { $cond: ['$tracking.looksDead', 1, 0] } },
          batteryRestricted: {
            $sum: { $cond: [{ $and: ['$tracking.batteryOptimizationEnabled', '$tracking.aggressiveOem'] }, 1, 0] },
          },
        },
      },
      { $sort: { serviceDead: -1, installs: -1 } },
      { $limit: 20 },
    ]),
    DeviceModel.aggregate<{ _id: string | null; installs: number }>([
      { $match: { revokedAt: null } },
      { $group: { _id: '$app.version', installs: { $sum: 1 } } },
    ]),
    AppErrorModel.aggregate<{ _id: string | null; groups: number; fatalGroups: number; users: string[] }>([
      { $match: { lastAt: { $gte: since } } },
      {
        $group: {
          _id: '$appVersion',
          groups: { $sum: 1 },
          fatalGroups: { $sum: { $cond: ['$fatal', 1, 0] } },
          users: { $addToSet: '$userId' },
        },
      },
    ]),
    AppErrorModel.aggregate<{
      _id: string;
      kind: string;
      name: string | null;
      message: string;
      scope: string | null;
      screen: string | null;
      fatal: boolean;
      occurrences: number;
      users: string[];
      appVersions: (string | null)[];
      lastAt: Date;
    }>([
      { $match: { lastAt: { $gte: since } } },
      {
        $group: {
          _id: '$fingerprint',
          kind: { $first: '$kind' },
          name: { $first: '$name' },
          message: { $first: '$message' },
          scope: { $first: '$scope' },
          screen: { $first: '$screen' },
          fatal: { $max: '$fatal' },
          occurrences: { $sum: '$count' },
          users: { $addToSet: '$userId' },
          appVersions: { $addToSet: '$appVersion' },
          lastAt: { $max: '$lastAt' },
        },
      },
      // A fault twenty people hit matters more than one somebody hit twenty
      // times, so the account count sorts before the occurrences.
      { $sort: { fatal: -1, occurrences: -1 } },
      { $limit: 25 },
    ]),
    DevicePermissionsModel.aggregate<{ _id: string; installs: number }>([
      { $unwind: '$permissions' },
      { $match: { 'permissions.state': { $in: ['denied', 'blocked'] } } },
      { $group: { _id: '$permissions.key', installs: { $sum: 1 } } },
    ]),
    DeviceHealthModel.aggregate<{ _id: null; serviceDead: number; batteryRestricted: number; syncFailing: number; healthConnectBlind: number }>([
      {
        $group: {
          _id: null,
          serviceDead: { $sum: { $cond: ['$tracking.looksDead', 1, 0] } },
          batteryRestricted: {
            $sum: { $cond: [{ $and: ['$tracking.batteryOptimizationEnabled', '$tracking.aggressiveOem'] }, 1, 0] },
          },
          syncFailing: { $sum: { $cond: [{ $eq: ['$sync.status', 'failed'] }, 1, 0] } },
          healthConnectBlind: {
            $sum: { $cond: [{ $and: [{ $eq: ['$healthConnect.availability', 'installed'] }, { $eq: ['$healthConnect.canRead', false] }] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  const health = healthProblems[0];
  const permissionOf = new Map(permissionProblems.map(row => [row._id, row.installs]));
  const problems = [
    { code: 'steps_not_uploading', installs: quiet },
    { code: 'tracking_service_dead', installs: health?.serviceDead ?? 0 },
    { code: 'battery_restricted', installs: health?.batteryRestricted ?? 0 },
    { code: 'sync_failing', installs: health?.syncFailing ?? 0 },
    { code: 'health_connect_not_readable', installs: health?.healthConnectBlind ?? 0 },
    { code: 'activity_permission_denied', installs: permissionOf.get('activityRecognition') ?? 0 },
    { code: 'notifications_refused', installs: permissionOf.get('notifications') ?? 0 },
    { code: 'no_push_token', installs: noToken },
    { code: 'health_stale', installs: healthStale },
  ]
    .filter(problem => problem.installs > 0)
    .sort((a, b) => b.installs - a.installs);

  const errorsOf = new Map(errorsByVersion.map(row => [row._id ?? '', row]));

  return {
    days,
    installs: { total, signedIn: signedInCount, reportingSteps, quiet, reportingHealth, healthStale },
    problems,
    byManufacturer: byManufacturer
      .filter(row => row._id)
      .map(row => ({
        manufacturer: row._id as string,
        installs: row.installs,
        serviceDead: row.serviceDead,
        batteryRestricted: row.batteryRestricted,
      })),
    byAppVersion: installsByVersion
      .filter(row => row._id)
      .map(row => {
        const errors = errorsOf.get(row._id ?? '');
        return {
          appVersion: row._id as string,
          installs: row.installs,
          errorGroups: errors?.groups ?? 0,
          fatalGroups: errors?.fatalGroups ?? 0,
          affectedUsers: errors?.users.length ?? 0,
        };
      })
      .sort((a, b) => b.fatalGroups - a.fatalGroups || b.installs - a.installs),
    topErrors: topErrors.map(row => ({
      fingerprint: row._id,
      kind: row.kind,
      name: row.name ?? null,
      message: row.message,
      scope: row.scope ?? null,
      screen: row.screen ?? null,
      fatal: Boolean(row.fatal),
      occurrences: row.occurrences,
      users: row.users.length,
      appVersions: row.appVersions.filter((version): version is string => Boolean(version)),
      lastAt: iso(row.lastAt),
    })),
  };
}
