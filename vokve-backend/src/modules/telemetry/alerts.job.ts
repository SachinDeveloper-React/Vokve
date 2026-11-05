import { getConfig } from '../../config/remote.js';
import { raiseAlert } from '../../lib/alerts.js';
import { logger } from '../../lib/logger.js';
import { DeviceModel } from '../devices/models.js';
import { AppErrorModel, DeviceHealthModel } from './models.js';

/**
 * The hourly read of whether the app is working, for everyone (RULES P17).
 *
 * Every figure here was already answerable from the panel. What the panel
 * cannot do is notice: a step tracker that an OEM update starts killing, a
 * release that crashes on one Android version, a push channel whose
 * certificate quietly expired — none of them announce themselves, and the
 * members they are failing do not file tickets, they walk, lose their days
 * and leave. This is the part that makes somebody look.
 *
 * Five checks, and each one is a question support actually gets asked, read
 * across the fleet instead of one member at a time. Each has its own
 * cooldown in `raiseAlert`, so a problem that lasts a week is one alarm an
 * hour at worst, not one a minute.
 *
 * Shares, with a floor under them. A threshold written as a count stops
 * meaning anything the moment the fleet doubles, and a share taken over
 * four installs is noise with a decimal point on it.
 */
const HOUR_MS = 3_600_000;

export interface AlertSweep {
  /** Checks that found something wrong. */
  raised: number;
  /** Of those, the ones that were still within another alarm's cooldown. */
  quiet: number;
  /** Checks that could not run — too few installs to mean anything. */
  skipped: number;
}

const NOTHING: AlertSweep = { raised: 0, quiet: 0, skipped: 0 };

const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);
const percent = (value: number) => `${Math.round(value * 100)}%`;

export async function sweepFleetAlerts(now = new Date()): Promise<AlertSweep> {
  const config = await getConfig();
  const rules = config.telemetry.alerts;
  if (!rules.enabled) return NOTHING;

  const sweep: AlertSweep = { raised: 0, quiet: 0, skipped: 0 };
  const record = async (sent: Promise<boolean>) => {
    if (await sent) sweep.raised += 1;
    else sweep.quiet += 1;
  };

  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const dayAgo = new Date(now.getTime() - 24 * HOUR_MS);

  // ── 1. A build that has started crashing ────────────────────────────────
  //
  // Grouped by version rather than counted across the fleet, because that is
  // the shape of the decision it feeds: a crash wave is almost always one
  // release, and the answer is to stop its rollout.
  const waves = await AppErrorModel.aggregate<{ _id: string | null; fatals: number }>([
    { $match: { fatal: true, lastAt: { $gte: hourAgo } } },
    { $group: { _id: '$appVersion', fatals: { $sum: '$count' } } },
    { $match: { fatals: { $gte: rules.fatalErrorsPerVersion } } },
    { $sort: { fatals: -1 } },
    { $limit: 5 },
  ]);

  for (const wave of waves) {
    const version = wave._id ?? 'an unknown build';
    await record(
      raiseAlert({
        key: `telemetry.fatal_wave:${version}`,
        severity: 'critical',
        title: `App ${version} is crashing`,
        lines: [
          `${wave.fatals} fatal faults in the last hour, from ${version}.`,
          'If this build is still rolling out, halt it before the rest of the fleet takes it.',
        ],
        path: '/dashboard/diagnose',
      }),
    );
  }

  // ── 2. Step services being killed ───────────────────────────────────────
  //
  // Read from the installs that reported in the last day, not from every
  // install ever registered: a phone that has not spoken for a month has no
  // verdict on itself to offer, and counting it as healthy or as dead would
  // both be inventions.
  const reporting = await DeviceHealthModel.countDocuments({ at: { $gte: dayAgo } });
  if (reporting >= rules.minInstalls) {
    const dead = await DeviceHealthModel.countDocuments({
      at: { $gte: dayAgo },
      'tracking.looksDead': true,
    });
    const deadShare = share(dead, reporting);
    if (deadShare >= rules.deadTrackerShare) {
      await record(
        raiseAlert({
          key: 'telemetry.dead_trackers',
          severity: 'critical',
          title: 'Step services are being killed',
          lines: [
            `${dead} of ${reporting} reporting installs (${percent(deadShare)}) say their counter should be running and is not.`,
            'This is what a member means by "my steps stopped". Check whether it is one manufacturer or one app version.',
          ],
          path: '/dashboard/diagnose',
        }),
      );
    }

    // ── 3. Clocks that cannot be trusted ──────────────────────────────────
    //
    // A wrong clock makes a day land on the wrong date, a reminder ring at
    // the wrong hour, and a snapshot fall outside the ingest window — three
    // complaints that all look like server bugs from the server.
    const skewed = await DeviceHealthModel.countDocuments({
      at: { $gte: dayAgo },
      $or: [
        { 'clock.skewMs': { $gte: rules.clockSkewMs } },
        { 'clock.skewMs': { $lte: -rules.clockSkewMs } },
      ],
    });
    if (skewed >= rules.clockSkewInstalls) {
      await record(
        raiseAlert({
          key: 'telemetry.clock_skew',
          severity: 'warning',
          title: 'Phones are running on the wrong time',
          lines: [
            `${skewed} installs are more than ${Math.round(rules.clockSkewMs / 60_000)} minutes out from this server.`,
            'Their local days, their reminders and their step windows are all computed on that clock.',
          ],
          path: '/dashboard/diagnose',
        }),
      );
    }
  } else {
    sweep.skipped += 2;
  }

  // ── 4. Steps that have stopped arriving ─────────────────────────────────
  //
  // Only installs that are signed in and can be pushed: a signed-out phone
  // has no days of anybody's to send, and one with no token was never going
  // to be chased into sending them.
  const pushable = await DeviceModel.countDocuments({
    revokedAt: null,
    'push.token': { $type: 'string' },
    counting: { $elemMatch: { to: null } },
  });

  if (pushable >= rules.minInstalls) {
    const window = new Date(now.getTime() - config.activity.maxAgeDays * 24 * HOUR_MS);
    const stale = await DeviceModel.countDocuments({
      revokedAt: null,
      'push.token': { $type: 'string' },
      counting: { $elemMatch: { to: null } },
      $or: [{ 'stepSync.uploadedAt': null }, { 'stepSync.uploadedAt': { $lte: window } }],
    });
    const staleShare = share(stale, pushable);
    if (staleShare >= rules.staleSyncShare) {
      await record(
        raiseAlert({
          key: 'telemetry.stale_sync',
          severity: 'critical',
          title: 'Steps have stopped reaching the server',
          lines: [
            `${stale} of ${pushable} counting installs (${percent(staleShare)}) have sent nothing inside the ${config.activity.maxAgeDays}-day window.`,
            'Every day they stay silent is a day of real walking that can no longer be counted.',
          ],
          path: '/dashboard/diagnose',
        }),
      );
    }
  } else {
    sweep.skipped += 1;
  }

  // ── 5. A push channel that has stopped landing ──────────────────────────
  //
  // The check the receipt was built for. Counted over installs the server
  // pushed in the last six hours: of those, how many never said it arrived.
  // A channel whose certificate has expired or whose project has been
  // reconfigured fails exactly this way — every send accepted, nothing
  // delivered — and nothing else in the system would notice.
  const since = new Date(now.getTime() - 6 * HOUR_MS);
  const pushed = await DeviceModel.countDocuments({
    revokedAt: null,
    'stepSync.nudgedAt': { $gte: since },
  });

  if (pushed >= rules.minInstalls) {
    const silent = await DeviceModel.countDocuments({
      revokedAt: null,
      'stepSync.nudgedAt': { $gte: since },
      $or: [{ 'push.lastAckAt': null }, { $expr: { $lt: ['$push.lastAckAt', '$stepSync.nudgedAt'] } }],
    });
    const silentShare = share(silent, pushed);
    if (silentShare >= rules.undeliveredPushShare) {
      await record(
        raiseAlert({
          key: 'telemetry.undelivered_push',
          severity: 'critical',
          title: 'Pushes are being accepted but not delivered',
          lines: [
            `${silent} of ${pushed} installs pushed in the last six hours (${percent(silentShare)}) never acknowledged it.`,
            'The provider is taking the messages. Check the credentials and the certificate before assuming the phones are at fault.',
          ],
          path: '/dashboard/diagnose',
        }),
      );
    }
  } else {
    sweep.skipped += 1;
  }

  if (sweep.raised > 0 || sweep.quiet > 0) {
    logger.info({ ...sweep }, 'telemetry.alerts_swept');
  }
  return sweep;
}
