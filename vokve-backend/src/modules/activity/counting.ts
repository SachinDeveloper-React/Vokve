import { addDays, isValidTimeZone, localMidnightUtc } from '../../lib/dates.js';
import type { SignedSnapshot } from './snapshot.js';

/**
 * Counting starts at sign-in (D-56). A phone's step counter and Health
 * Connect both hold the whole day — the counter claims what it counted since
 * boot or while the app was signed out, and Health Connect has every app's
 * records from midnight — but only the steps taken while the account was
 * signed in on the phone are the account's. What the server holds for a
 * device-day is cut to that time before it is judged, so the dashboard, the
 * coins, the streak and the board all start from the sign-in.
 */

/** One stretch the account counted on an install: a sign-in to its sign-out, or still open. */
export interface CountingPeriod {
  from: Date;
  /** Null, or absent, while the account is still signed in there. */
  to?: Date | null;
}

/** Epoch-ms `[from, to)` spans, sorted and apart. */
export type CountingWindow = [number, number][];

const HOUR_MS = 3_600_000;

/**
 * The part of `day` — local to `timezone` — the account counted on the
 * install, or null when the whole day counts: a day one period covers end
 * to end, or an install that never kept periods and has no `installedAt`
 * either. A day no period touches is an empty window: the account was not
 * signed in on that phone, so none of it is theirs.
 *
 * **Counting starts at the sign-in, and nothing before it ever counts.** A
 * day that ends before the install's first period is an empty window, not a
 * whole one: a phone signed into today for the first time holds whatever
 * its sensor and Health Connect have had all week, and none of that was
 * walked for this account on this phone. This is what stops a fresh install
 * claiming `maxAgeDays` of history on its first sync.
 *
 * `installedAt` is the install's `firstSeenAt`, and it stands in for the
 * period an install with **none** has not had written yet. Registering and
 * recording the first sign-in are two writes, and an upload can land
 * between them: with nothing to go on, "no periods kept" reads as the whole
 * day, so that upload is handed a day the member walked before Vokve was
 * ever on the phone — and loses it again the moment the period appears, the
 * figure shown and then taken away. A phone cannot have counted for the
 * account before it registered, so the install day is cut there.
 *
 * An install row with neither a period nor a `firstSeenAt` is from before
 * either was kept, and is the one thing left as it was.
 */
export function countingWindow(
  periods: CountingPeriod[] | null | undefined,
  day: string,
  timezone: string,
  installedAt?: Date | null,
): CountingWindow | null {
  const zone = isValidTimeZone(timezone) ? timezone : 'UTC';
  const start = localMidnightUtc(day, zone).getTime();
  const end = localMidnightUtc(addDays(day, 1), zone).getTime();

  if (!periods || periods.length === 0) {
    // No period written. The install's own age is all there is to go on; a
    // row from before `firstSeenAt` was kept has not even that, and is
    // left exactly as it was.
    const floor = installedAt?.getTime();
    if (floor === undefined || !Number.isFinite(floor) || floor <= start) return null;
    return floor >= end ? [] : [[floor, end]];
  }
  const clipped = periods
    .map((period): [number, number] => [
      Math.max(period.from.getTime(), start),
      Math.min(period.to?.getTime() ?? Infinity, end),
    ])
    .filter(([from, to]) => from < to)
    .sort((a, b) => a[0] - b[0]);
  const window: CountingWindow = [];
  for (const [from, to] of clipped) {
    const last = window.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else window.push([from, to]);
  }
  return window.length === 1 && window[0][0] === start && window[0][1] === end ? null : window;
}

/**
 * A snapshot as if the phone had counted only inside `window`:
 *
 * - **The phone's own count** is the steps it timed in minutes inside the
 *   window. Steps it could not place are left out with the rest — recovered
 *   in one go, or parked untimed in the minute they arrived, which is where
 *   the backlog the counter hands over when it starts again lands, however
 *   long before the sign-in it was walked.
 * - **Each Health Connect app** keeps the share of its records inside the
 *   window, by their own times; without records, the share of its hours;
 *   without either, nothing — it cannot be told apart.
 * - **What the phone showed** is recounted from the same figures.
 *
 * `leftOut` is how many fewer steps the day shows for it.
 */
export function cutToWindow(
  snapshot: SignedSnapshot,
  window: CountingWindow,
): { snapshot: SignedSnapshot; leftOut: number } {
  const inside = (at: number) => window.some(([from, to]) => at >= from && at < to);
  const overlap = (from: number, to: number) =>
    window.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(to, b) - Math.max(from, a)), 0);
  /** How much of a span lies inside the window, 0–1; an instant is in or out. */
  const share = (from: number, to: number) => (to > from ? overlap(from, to) / (to - from) : inside(from) ? 1 : 0);

  const minutes = snapshot.minutes
    ?.filter(minute => inside(minute.minuteStart))
    .map(minute => ({
      ...minute,
      untimedSteps: 0,
      chargingSteps: Math.min(minute.chargingSteps, minute.steps),
      stillSteps: Math.min(minute.stillSteps, minute.steps),
      vehicleSteps: Math.min(minute.vehicleSteps, minute.steps),
    }));
  const deviceSteps = (minutes ?? []).reduce((sum, minute) => sum + minute.steps, 0);
  const suspectSteps =
    snapshot.deviceSteps > 0 ? Math.min(deviceSteps, Math.round((snapshot.suspectSteps * deviceSteps) / snapshot.deviceSteps)) : 0;

  // Each app's records inside the window, by their own times.
  const records = snapshot.healthConnectRecords;
  const byApp = new Map<string, { steps: number; manual: number; unknown: number; distance: number }>();
  if (records && !records.truncated) {
    for (const record of records.records) {
      const part = share(record.startTime, record.endTime);
      const app = byApp.get(record.packageName) ?? { steps: 0, manual: 0, unknown: 0, distance: 0 };
      const type = record.recordType ?? (record.count !== undefined ? 'steps' : 'distance');
      if (type === 'steps') {
        const steps = (record.count ?? 0) * part;
        app.steps += steps;
        if (record.recordingMethod === 'manual') app.manual += steps;
        if (record.recordingMethod === 'unknown') app.unknown += steps;
      } else {
        app.distance += (record.distanceMeters ?? 0) * part;
      }
      byApp.set(record.packageName, app);
    }
  }

  const dayStart = localMidnightUtc(
    snapshot.date,
    isValidTimeZone(snapshot.clock.timezone) ? snapshot.clock.timezone : 'UTC',
  ).getTime();
  const hourShares = Array.from({ length: 24 }, (_, hour) =>
    share(dayStart + hour * HOUR_MS, dayStart + (hour + 1) * HOUR_MS),
  );

  const sources = snapshot.sources.map(source => {
    const hoursKnown = source.hourlySteps.length === 24 && source.hourlySteps.every(inHour => inHour >= 0);
    const fromRecords = byApp.get(source.packageName);
    const steps = fromRecords
      ? fromRecords.steps
      : hoursKnown
        ? source.hourlySteps.reduce((sum, inHour, hour) => sum + inHour * hourShares[hour], 0)
        : 0;
    const part = source.steps > 0 ? steps / source.steps : 0;
    // Not computed stays not computed: the split cannot be made up here.
    const split = (all: number, fromApp: number | undefined) =>
      all < 0 ? all : Math.round(fromApp ?? all * part);
    return {
      ...source,
      steps: Math.round(steps),
      manualSteps: split(source.manualSteps, fromRecords?.manual),
      unknownMethodSteps: split(source.unknownMethodSteps, fromRecords?.unknown),
      distance: fromRecords && fromRecords.distance > 0 ? fromRecords.distance : source.distance * part,
      hourlySteps: hoursKnown
        ? source.hourlySteps.map((inHour, hour) => Math.round(inHour * hourShares[hour]))
        : source.hourlySteps,
    };
  });

  const shown = snapshot.resolved.usedExternal
    ? sources.find(source => source.packageName === snapshot.resolved.packageName)
    : undefined;
  const manualStepsExcluded = shown && snapshot.resolved.manualStepsExcluded > 0 ? Math.max(0, shown.manualSteps) : 0;
  const resolvedSteps = shown ? Math.max(0, shown.steps - manualStepsExcluded) : deviceSteps;

  const before = Math.max(snapshot.resolved.steps, snapshot.deviceSteps);
  const after = Math.max(resolvedSteps, deviceSteps);
  return {
    snapshot: {
      ...snapshot,
      deviceSteps,
      recoveredSteps: 0,
      suspectSteps,
      sources,
      resolved: { ...snapshot.resolved, steps: resolvedSteps, manualStepsExcluded },
      minutes,
      motionWindows: snapshot.motionWindows?.filter(motion => inside(motion.startedAt)),
    },
    leftOut: Math.max(0, Math.round(before - after)),
  };
}
