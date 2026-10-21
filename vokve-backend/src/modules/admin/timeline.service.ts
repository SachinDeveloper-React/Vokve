import { z } from 'zod';
import { getConfig } from '../../config/remote.js';
import { isValidTimeZone, localMidnightUtc } from '../../lib/dates.js';
import { Errors } from '../../lib/errors.js';
import { DeviceDayModel } from '../activity/models.js';
import { DeviceModel } from '../devices/models.js';
import { UserModel } from '../identity/models.js';

/**
 * One member's day, minute by minute, with every phone that claimed each
 * minute and which one the day took (RULES A3, D-53).
 *
 * The rule itself is not new and is not decided here: a minute is credited
 * to the phone that counted the most in it, and the others' steps for that
 * minute are dropped, so a walk with two phones in the pocket counts once
 * while walks on different phones at different times both count. What was
 * missing is any way to *see* it. The day showed one number, the phones
 * showed others, and nothing said which minute went to whom — so an
 * operator asked "why is this day 8,000 when the phone says 11,000" had the
 * breakdown by device and nothing by time.
 *
 * Read-only, and it invents nothing: the rows come from each device-day's
 * stored `minuteSteps`, which is what the scoring itself reads. A day
 * stored before minutes were kept has none, and says so rather than
 * answering zero.
 */

export const timelineQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Only minutes more than one phone claimed — the overlaps on their own. */
  overlapsOnly: z.coerce.boolean().default(false),
  /** Minutes with no steps at all are left out either way; this caps the rest. */
  limit: z.coerce.number().int().min(1).max(1440).default(1440),
});
export type TimelineQuery = z.infer<typeof timelineQuery>;

const MINUTE_MS = 60_000;

/** The wall-clock pieces of an instant in a zone — what an operator reads. */
interface Parts {
  year: number;
  month: number;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
  second: number;
}

function partsIn(at: Date, timeZone: string): Parts {
  const fields = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((all, part) => {
      all[part.type] = part.value;
      return all;
    }, {});
  return {
    year: Number(fields.year),
    month: Number(fields.month),
    day: Number(fields.day),
    weekday: fields.weekday ?? '',
    // A zone can render midnight as `24`; the day it belongs to is this row's.
    hour: Number(fields.hour) % 24,
    minute: Number(fields.minute),
    second: Number(fields.second),
  };
}

/** `2026-10-18T14:32:00+05:30` — the instant as that phone's owner saw it. */
function isoIn(at: Date, timeZone: string, parts: Parts): string {
  const offsetMinutes = Math.round(
    (Date.parse(
      `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` +
        `T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}Z`,
    ) -
      at.getTime()) /
      MINUTE_MS,
  );
  const sign = offsetMinutes < 0 ? '-' : '+';
  const size = Math.abs(offsetMinutes);
  const stamp =
    `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` +
    `T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;
  return `${stamp}${sign}${String(Math.floor(size / 60)).padStart(2, '0')}:${String(size % 60).padStart(2, '0')}`;
}

interface Claim {
  deviceId: string;
  name: string;
  steps: number;
  /** Steps the phone timed into this minute, and ones it could only park in it. */
  timedSteps: number;
  untimedSteps: number;
  picked: boolean;
}

export interface TimelineRow {
  at: string;
  epochMs: number;
  parts: Parts;
  /** What the day took for this minute: the highest claim on it. */
  steps: number;
  /** The phone it was taken from; null where nobody claimed the minute. */
  pickedDeviceId: string | null;
  /** Steps dropped here because another phone claimed the same minute. */
  rejectedSteps: number;
  /** More than one phone claimed it. */
  overlap: boolean;
  claims: Claim[];
}

export interface TimelineRun {
  from: string;
  to: string;
  fromParts: Parts;
  epochMs: number;
  /** How many minutes the run covers — contiguous, so this is also its length. */
  minutes: number;
  steps: number;
  rejectedSteps: number;
  pickedDeviceId: string | null;
  overlap: boolean;
  /** Every phone that claimed any minute of the run, the picked one included. */
  deviceIds: string[];
}

/**
 * The same minutes as stretches of walking rather than as a list.
 *
 * A real day is a few hundred rows, and nobody reads a few hundred rows: what
 * an operator wants is "09:00–09:12, this phone, 1,240 steps, 800 of the
 * other one's dropped". A run is minutes that are **contiguous in time** and
 * agree on both the phone they went to and whether anybody else was
 * claiming them — contiguous, because minutes with no steps are not in the
 * list at all, and joining across them would hide a twenty-minute sit-down
 * inside one innocent-looking row.
 */
function runsOf(rows: TimelineRow[]): TimelineRun[] {
  const runs: TimelineRun[] = [];
  let last: TimelineRow | null = null;
  for (const row of rows) {
    const run = runs.at(-1);
    const joins =
      run !== undefined &&
      last !== null &&
      row.epochMs === last.epochMs + MINUTE_MS &&
      row.pickedDeviceId === run.pickedDeviceId &&
      row.overlap === run.overlap;
    if (joins) {
      run.to = row.at;
      run.minutes += 1;
      run.steps += row.steps;
      run.rejectedSteps += row.rejectedSteps;
      for (const claim of row.claims) {
        if (!run.deviceIds.includes(claim.deviceId)) run.deviceIds.push(claim.deviceId);
      }
    } else {
      runs.push({
        from: row.at,
        to: row.at,
        fromParts: row.parts,
        epochMs: row.epochMs,
        minutes: 1,
        steps: row.steps,
        rejectedSteps: row.rejectedSteps,
        pickedDeviceId: row.pickedDeviceId,
        overlap: row.overlap,
        deviceIds: row.claims.map(claim => claim.deviceId),
      });
    }
    last = row;
  }
  return runs;
}

export async function stepsTimeline(userId: string, query: TimelineQuery) {
  const user = await UserModel.findById(userId).select({ timezone: 1 }).lean();
  if (!user) throw Errors.notFound('That member');
  const config = await getConfig();
  const zone = user.timezone && isValidTimeZone(user.timezone) ? user.timezone : config.locale.timezone;

  const [allDays, devices] = await Promise.all([
    DeviceDayModel.find({ userId, localDay: query.date }).lean(),
    DeviceModel.find({ userId }, { info: 1, counting: 1, firstSeenAt: 1 }).lean(),
  ]);

  const nameOf = new Map(
    devices.map(device => [
      device._id,
      [device.info?.brand, device.info?.model].filter(Boolean).join(' ').trim() || 'Phone',
    ]),
  );

  // A phone an operator rejected by hand (D-88) is not evidence any more,
  // and the day was re-scored without it — so it is left out of the minutes
  // too, and carried separately with the reason, which is the only place a
  // screen can explain why its steps are nowhere in the rows.
  const deviceDays = allDays.filter(day => !day.rejected);

  // Every claim on every minute, the phones' own figures as they were sent.
  const byMinute = new Map<number, Claim[]>();
  const noMinutes: string[] = [];
  for (const day of deviceDays) {
    const evidence = day.evidence as {
      minuteSteps?: [number, number, number][];
      deviceSteps?: number;
    };
    const minutes = evidence?.minuteSteps;
    if (!minutes) {
      // Stored before minutes were kept, or a phone that keeps none. Its day
      // is real and cannot be placed in time, which is worth saying plainly.
      noMinutes.push(day.deviceId);
      continue;
    }
    for (const [minute, timedSteps, untimedSteps] of minutes) {
      const steps = timedSteps + untimedSteps;
      if (steps <= 0) continue;
      const at = minute * MINUTE_MS;
      const claims = byMinute.get(at) ?? [];
      claims.push({
        deviceId: day.deviceId,
        name: nameOf.get(day.deviceId) ?? 'Phone',
        steps,
        timedSteps,
        untimedSteps,
        picked: false,
      });
      byMinute.set(at, claims);
    }
  }

  const perDevice = new Map<string, { counted: number; rejected: number; minutes: number }>();
  const bump = (deviceId: string, counted: number, rejected: number) => {
    const row = perDevice.get(deviceId) ?? { counted: 0, rejected: 0, minutes: 0 };
    row.counted += counted;
    row.rejected += rejected;
    row.minutes += 1;
    perDevice.set(deviceId, row);
  };

  const all: TimelineRow[] = [];
  let counted = 0;
  let rejected = 0;
  let overlapMinutes = 0;
  for (const [epochMs, claims] of [...byMinute.entries()].sort(([a], [b]) => a - b)) {
    // The highest claim takes the minute. A tie goes to the phone whose id
    // sorts first, so the same day always reads the same way.
    const winner = claims.reduce((best, claim) =>
      claim.steps > best.steps || (claim.steps === best.steps && claim.deviceId < best.deviceId) ? claim : best,
    );
    winner.picked = true;
    const dropped = claims.reduce((sum, claim) => sum + (claim.picked ? 0 : claim.steps), 0);
    for (const claim of claims) bump(claim.deviceId, claim.picked ? claim.steps : 0, claim.picked ? 0 : claim.steps);
    counted += winner.steps;
    rejected += dropped;
    const overlap = claims.length > 1;
    if (overlap) overlapMinutes += 1;

    const at = new Date(epochMs);
    const parts = partsIn(at, zone);
    all.push({
      at: isoIn(at, zone, parts),
      epochMs,
      parts,
      steps: winner.steps,
      pickedDeviceId: winner.deviceId,
      rejectedSteps: dropped,
      overlap,
      claims: claims.sort((a, b) => b.steps - a.steps),
    });
  }

  const shown = query.overlapsOnly ? all.filter(row => row.overlap) : all;
  const rows = shown.slice(0, query.limit);
  // Over the whole filtered day, not the page: a run cut in half by a page
  // boundary would read as two walks.
  const runs = runsOf(shown);

  // The same minutes rolled up, so a day can be read before it is read
  // minute by minute.
  const dayStart = localMidnightUtc(query.date, zone).getTime();
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const from = dayStart + hour * 3_600_000;
    const inHour = all.filter(row => row.epochMs >= from && row.epochMs < from + 3_600_000);
    return {
      hour,
      steps: inHour.reduce((sum, row) => sum + row.steps, 0),
      rejectedSteps: inHour.reduce((sum, row) => sum + row.rejectedSteps, 0),
      minutes: inHour.length,
      overlapMinutes: inHour.filter(row => row.overlap).length,
      devices: [...new Set(inHour.map(row => row.pickedDeviceId))].filter(Boolean),
    };
  });

  return {
    userId,
    localDay: query.date,
    timezone: zone,
    /** What the minutes add up to — the day's own total is scored separately. */
    totals: {
      steps: counted,
      rejectedSteps: rejected,
      minutes: all.length,
      overlapMinutes,
      devices: deviceDays.length,
      /** Phones an operator took out of this day. */
      rejectedDevices: allDays.length - deviceDays.length,
    },
    devices: allDays.map(day => {
      const evidence = day.evidence as { deviceSteps?: number; minuteSteps?: unknown[] };
      const tally = perDevice.get(day.deviceId);
      const device = devices.find(row => row._id === day.deviceId);
      return {
        deviceId: day.deviceId,
        name: nameOf.get(day.deviceId) ?? 'Phone',
        /** Everything this phone's own sensor counted for the day. */
        deviceSteps: evidence?.deviceSteps ?? 0,
        /** Of that, what the minutes gave it and what another phone took. */
        countedSteps: tally?.counted ?? 0,
        rejectedSteps: tally?.rejected ?? 0,
        minutesClaimed: tally?.minutes ?? 0,
        /** No minute-level evidence at all: nothing here can be placed in time. */
        minutesKept: Boolean(evidence?.minuteSteps),
        /** An operator took this phone's day out of the count (D-88). */
        rejected: Boolean(day.rejected),
        rejectedAt: day.rejected?.at?.toISOString() ?? null,
        rejectedBy: day.rejected?.by ?? null,
        rejectedNote: day.rejected?.note ?? null,
        firstSeenAt: device?.firstSeenAt?.toISOString() ?? null,
        counting: (device?.counting ?? []).map(period => ({
          from: period.from?.toISOString() ?? null,
          to: period.to?.toISOString() ?? null,
        })),
      };
    }),
    /** Device-days whose steps carry no minutes, so they are absent from `rows`. */
    withoutMinutes: noMinutes,
    hours,
    runs,
    rows,
    truncated: shown.length > rows.length,
  };
}
