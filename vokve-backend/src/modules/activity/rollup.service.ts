import { isProduction } from '../../config/env.js';
import { getConfig } from '../../config/remote.js';
import type { DailyActivity } from '../../contracts/index.js';
import { isValidTimeZone, localDayOf } from '../../lib/dates.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { DeviceModel } from '../devices/models.js';
import { UserModel, UserSettingsModel } from '../identity/models.js';
import { FraudFlagModel } from '../integrity/models.js';
import { updateTrust } from '../integrity/trust.service.js';
import { evaluateChallenges } from '../challenges/service.js';
import { refreshLeaderboardScore } from '../leaderboard/service.js';
import { markEarned } from '../streak/service.js';
import { scoreDay, type DeviceInput, type DayFlag } from './layers.js';
import { ActivityDailyModel, DeviceDayModel } from './models.js';
import { creditStepsForDay, getDay } from './service.js';
import { hourFinder, type DeviceDayEvidence } from './snapshot.js';

/**
 * One user's day, scored from every device that sent it (ARCHITECTURE §5.3
 * steps 6–10): the day's figures into `activity_daily`, what the layers
 * found into `fraud_flags`, the trust score after it, and — only once
 * ⚙ `coins.steps.enabled` is on — the step coins into escrow.
 *
 * Run inline after each accepted snapshot, so the response carries the day
 * as it now stands; idempotent, so running it again changes nothing that
 * has not changed.
 */

/** Steps per epoch minute into twenty-four local hours, midnight first. */
function hoursOf(minutes: Map<number, number>, hourOf: (epochMs: number) => number): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const [at, steps] of minutes) hours[hourOf(at * 60_000)] += steps;
  return hours;
}

/** Metres per step from height (the tracker's own coefficient); 170 cm when unknown. */
const strideMetres = (heightCm: number | null | undefined) => ((heightCm ?? 170) * 0.414) / 100;
/** Kilocalories per kilogram per kilometre walked — the tracker's default. */
const KCAL_PER_KG_KM = 0.57;

export interface DeviceProof {
  key: DeviceInput['key'];
  play: DeviceInput['play'];
}

export interface RollupResult {
  day: DailyActivity;
  coinsHeld: number;
  releaseAfter: string | null;
  /** The day reached the step goal with this run and was earned for the streak. */
  streakEarned: boolean;
}

export async function rollupDay(userId: string, localDay: string, now = new Date()): Promise<RollupResult> {
  const config = await getConfig();
  const [user, deviceDays, history] = await Promise.all([
    UserModel.findById(userId, { heightCm: 1, weightKg: 1, trust: 1 }).lean(),
    DeviceDayModel.find({ userId, localDay }).lean(),
    ActivityDailyModel.find({ userId, localDay: { $lt: localDay } }, { localDay: 1, pedometerSteps: 1 })
      .sort({ localDay: -1 }).limit(7).lean(),
  ]);
  if (deviceDays.length === 0) return { day: await getDay(userId, localDay), coinsHeld: 0, releaseAfter: null, streakEarned: false };

  const devices = await DeviceModel.find(
    { _id: { $in: deviceDays.map(d => d.deviceId) } },
    { installId: 1, vendorId: 1, firstSeenAt: 1, 'attestation.keyId': 1 },
  ).lean();
  const byId = new Map(devices.map(d => [d._id, d]));

  const inputs: DeviceInput[] = await Promise.all(
    deviceDays.map(async row => {
      const device = byId.get(row.deviceId);
      const proof = row.proof as DeviceProof;
      // The same install, vendor id or Keystore key on other accounts (A18).
      const [sharedAccounts, keySharedAccounts] = device
        ? await Promise.all([
            DeviceModel.distinct('userId', {
              userId: { $ne: userId },
              $or: [{ installId: device.installId }, ...(device.vendorId ? [{ vendorId: device.vendorId }] : [])],
            }).then(ids => ids.length),
            device.attestation?.keyId
              ? DeviceModel.distinct('userId', { userId: { $ne: userId }, 'attestation.keyId': device.attestation.keyId }).then(ids => ids.length)
              : Promise.resolve(0),
          ])
        : [0, 0];
      return {
        deviceId: row.deviceId,
        evidence: row.evidence as DeviceDayEvidence,
        key: proof?.key ?? null,
        play: proof?.play ?? null,
        sharedAccounts,
        keySharedAccounts,
        firstSeenAt: device?.firstSeenAt ?? null,
      };
    }),
  );

  const score = scoreDay(
    inputs,
    history.map(h => ({ localDay: h.localDay, pedometerSteps: h.pedometerSteps ?? null })),
    now,
    config,
  );
  const best = score.best;
  const bestEvidence = inputs.find(input => input.deviceId === best.deviceId)!.evidence;

  // Outside production, what each phone sent and what became of every
  // Health Connect app on it — enough to trace a watch that did not show.
  if (!isProduction) {
    logger.info(
      {
        userId,
        localDay,
        steps: score.displaySteps,
        verifiedSteps: score.verifiedSteps,
        phonesAdded: { steps: score.union.phones, verified: score.union.verified },
        devices: score.devices.map(device => {
          const evidence = inputs.find(input => input.deviceId === device.deviceId)!.evidence;
          return {
            deviceId: device.deviceId,
            phone: device.phone.counted,
            phoneShowed: evidence.resolved.usedExternal
              ? `${evidence.resolved.steps} from ${evidence.resolved.packageName}`
              : `${evidence.resolved.steps} from the phone`,
            healthConnect: evidence.sourcesStatus,
            sources: device.sources.map(s =>
              `${s.appName} (${s.packageName}): ${s.steps} steps, ${s.countable ?? '?'} countable` +
              ` [typed in ${s.manualSteps ?? '?'}, no recording method ${s.unknownMethodSteps ?? '?'}] → ${s.status}`),
            verifiedSteps: device.verifiedSteps,
            hard: device.hard,
          };
        }),
      },
      'activity.day_scored',
    );
  }
  // The phone that counted the most supplies the pedometer figure, kept for
  // the day-to-day checks (A17), which compare a phone with itself.
  const counting = inputs.reduce((a, b) => (b.evidence.deviceSteps > a.evidence.deviceSteps ? b : a)).evidence;

  // The other app the phone showed for the day, when it showed one the
  // server did not verify — a watch relayed with no recording method, say.
  // The day shows its count (A11), so its hours are the day's too.
  const shown = !best.winner && bestEvidence.resolved.usedExternal
    ? bestEvidence.sources.find(source => source.packageName === bestEvidence.resolved.packageName) ?? null
    : null;

  // Several phones whose minutes added up to more than any one of them
  // answered: the day is their union, and so are its hours (D-53).
  const phonesAdded = inputs.length > 1 &&
    score.union.phones > Math.max(...score.devices.map(device => device.displaySteps));

  // The hours of whichever source answered for the day: the phones' union
  // when it did, a watch's own split when it won or was shown and the
  // tracker had one, the counting phone's minutes else.
  const hourly = phonesAdded
    ? hoursOf(score.union.minutes, hourFinder(bestEvidence.timezone, bestEvidence.utcOffsetMinutes))
    : best.winner?.hourlySteps ?? shown?.hourlySteps ?? counting.hourly;

  const measured = best.winner && best.winner.distanceSource === 'health_connect' && best.winner.distance > 0;
  const distanceKm = measured
    ? best.winner!.distance / 1000
    : (score.displaySteps * strideMetres(user?.heightCm)) / 1000;
  const stepCalories = distanceKm * (user?.weightKg ?? 70) * KCAL_PER_KG_KM;

  await ActivityDailyModel.updateOne(
    { _id: `${userId}:${localDay}` },
    {
      $setOnInsert: { _id: `${userId}:${localDay}`, userId, localDay },
      $set: {
        steps: score.displaySteps,
        verifiedSteps: score.verifiedSteps,
        pedometerSteps: counting.deviceSteps,
        distanceKm: Math.round(distanceKm * 100) / 100,
        activeMinutes: Math.max(score.union.activeMinutes, counting.minutes.activeMinutes),
        stepCalories: Math.round(stepCalories * 10) / 10,
        hourly,
        source: best.source,
        verified: best.verified || score.verifiedSteps > 0,
        plausibility: best.plausibility,
        layers: best.layers,
        flags: score.flags.filter(f => f.severity !== 'info').map(f => f.kind),
        hardRejects: best.hard,
        deviceCount: inputs.length,
        breakdown: {
          bestDeviceId: best.deviceId,
          // The phones added minute by minute, for the sources page (D-53).
          union: { phones: score.union.phones, verified: score.union.verified, added: phonesAdded },
          devices: score.devices.map(device => {
            const input = inputs.find(i => i.deviceId === device.deviceId)!;
            return {
              deviceId: device.deviceId,
              phone: device.phone,
              candidate: device.candidate,
              source: device.source,
              winner: device.winner?.packageName ?? null,
              // What the phone itself showed, and from which other app if
              // not its own count — so the sources page can say why the day
              // shows more than verified.
              shown: {
                steps: input.evidence.resolved.steps,
                packageName: input.evidence.resolved.usedExternal ? input.evidence.resolved.packageName : null,
              },
              verified: device.verified,
              verifiedSteps: device.verifiedSteps,
              displaySteps: device.displaySteps,
              plausibility: device.plausibility,
              layers: device.layers,
              hard: device.hard,
              flags: device.flags.map(f => ({ kind: f.kind, layer: f.layer, severity: f.severity })),
              sources: device.sources,
              sourcesStatus: input.evidence.sourcesStatus,
              // Cut to the time the account was signed in on it (D-56).
              counting: input.evidence.counting ?? null,
              signedAt: input.evidence.signedAt,
              proof: { key: input.key, play: input.play },
            };
          }),
        },
        scoredAt: now,
      },
    },
    { upsert: true },
  );

  await recordFlags(userId, localDay, score.flags, now);
  if (best.hard.length > 0) {
    logger.info({ userId, localDay, hard: best.hard }, 'activity.day_unverified');
  }

  const zone = isValidTimeZone(bestEvidence.timezone) ? bestEvidence.timezone : config.locale.timezone;
  const today = localDayOf(now, zone);
  await updateTrust(userId, today, now).catch(err => logger.warn({ err, userId }, 'trust.update_failed'));

  // The day's own step coins first: they are what the day earned, and the
  // bonuses that follow from it — a milestone, a challenge — take what the
  // daily ceiling leaves rather than crowding the steps out of it (RULES E8).
  let coinsHeld = 0;
  let releaseAfter: Date | null = null;
  if (config.coins.steps.enabled && score.verifiedSteps > 0) {
    const tier = (await UserModel.findById(userId, { trust: 1 }).lean())?.trust?.tier ?? 'normal';
    const credit = await creditStepsForDay(userId, localDay, score.verifiedSteps, tier);
    if (credit.status === 'held') {
      coinsHeld = credit.granted;
      releaseAfter = credit.releaseAfter;
    }
  }

  // Verified steps at or above the user's own goal earn the day for the
  // streak, where ⚙ `streak.earnedBy.stepGoal` says they do (D-44). Verified
  // only: an unverified day shows its steps but keeps no streak.
  let streakEarned = false;
  if (config.streak.earnedBy.stepGoal && score.verifiedSteps > 0) {
    const goal = (await UserSettingsModel.findById(userId, { dailyStepGoal: 1 }).lean())?.dailyStepGoal ?? 10_000;
    if (score.verifiedSteps >= goal) {
      streakEarned = await markEarned(userId, localDay, 'steps', zone, { now }).catch(err => {
        logger.warn({ err, userId, localDay }, 'streak.mark_failed');
        return false;
      });
    }
  }

  // The day's figures may have taken a challenge to its goal (RULES C3, C4),
  // and they move the week's leaderboard score (RULES L3).
  await evaluateChallenges(userId, localDay, zone, now).catch(err => logger.warn({ err, userId, localDay }, 'challenges.evaluate_failed'));
  await refreshLeaderboardScore(userId, localDay, now).catch(err => logger.warn({ err, userId, localDay }, 'leaderboard.refresh_failed'));

  return { day: await getDay(userId, localDay), coinsHeld, releaseAfter: releaseAfter?.toISOString() ?? null, streakEarned };
}

/**
 * One row per (user, day, kind), upserted: a day scored again refreshes its
 * flags. A flag the day no longer earns stays as it was — the record of
 * what an earlier snapshot showed is not erased by a later one.
 */
async function recordFlags(userId: string, localDay: string, flags: DayFlag[], now: Date): Promise<void> {
  if (flags.length === 0) return;
  await FraudFlagModel.bulkWrite(
    flags.map(f => ({
      updateOne: {
        filter: { userId, localDay, kind: f.kind },
        update: {
          $setOnInsert: { _id: newId('flg'), userId, localDay, kind: f.kind, status: 'open' },
          $set: { layer: f.layer, severity: f.severity, deviceId: f.deviceId, details: f.details, lastSeenAt: now },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}
