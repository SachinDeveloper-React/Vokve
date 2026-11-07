import { addDays, type IsoDate } from '../../lib/dates.js';
import { ChallengeDefinitionModel } from '../challenges/models.js';
import { periodOf } from '../challenges/service.js';
import { WorkoutModel } from '../training/models.js';

/**
 * Which day a row of the ledger is actually *for* (D-92).
 *
 * The ledger's own `createdAt` is when the coins were credited, and for
 * anything that reaches the server late the two are days apart: a phone
 * closes a day at local midnight and uploads it the next morning, a watch
 * backfills a fortnight, a leaderboard week is paid on the Monday after it.
 * So one evening's wallet could show four "check completed" rows in two
 * minutes, and nothing on the screen said they were four *different days*.
 * That is what this answers, in the one place both the member's history and
 * the operator's ledger read it from — a second copy of this would be free
 * to tell the two of them different stories about the same row.
 *
 * `null` for a row that is not about a day at all: an order, a referral, a
 * badge, an operator's adjustment. A streak milestone is one of those — it
 * is paid for a run of days, not on behalf of one.
 */
export interface EarnedPeriod {
  /** First local day the coins are for, `YYYY-MM-DD`. */
  start: IsoDate;
  /** Last local day; equal to `start` for a single day. */
  end: IsoDate;
  /** The line a screen draws, e.g. `For 2 Nov` or `For the week of 26 Oct`. */
  label: string;
}

export interface Ledgerish {
  _id: string;
  referenceType: string;
  referenceId: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2 Nov`, with the year only when it is not the one we are in. */
function niceDay(day: IsoDate, thisYear: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const short = `${date} ${MONTHS[month - 1]}`;
  return year === thisYear ? short : `${short} ${year}`;
}

function labelFor(start: IsoDate, end: IsoDate, thisYear: number): string {
  if (start === end) return `For ${niceDay(start, thisYear)}`;
  // A calendar month reads as the month, not as two dates a month apart.
  if (start.endsWith('-01') && start.slice(0, 7) === end.slice(0, 7)) {
    const [year, month] = start.split('-').map(Number);
    return `For ${MONTHS[month - 1]} ${year}`;
  }
  if (end === addDays(start, 6)) return `For the week of ${niceDay(start, thisYear)}`;
  return `For ${niceDay(start, thisYear)} – ${niceDay(end, thisYear)}`;
}

/** The part of a reference that is a day, or null. */
const dayIn = (value: string | undefined): IsoDate | null => (value && DAY.test(value) ? value : null);

/**
 * The period each row is for, keyed by row id. Two batched reads at most —
 * the challenges on the page, for their cadence, and the workouts on it, for
 * the day they were logged on — however many rows are asked about.
 */
export async function earnedPeriodsFor(rows: Ledgerish[], now = new Date()): Promise<Map<string, EarnedPeriod>> {
  const thisYear = now.getUTCFullYear();
  const out = new Map<string, EarnedPeriod>();

  // A reversal is about whatever it reverses: `reversal:<type>:<id>`.
  const resolved = rows.map(row => {
    if (row.referenceType !== 'adjustment' || !row.referenceId.startsWith('reversal:')) return row;
    const rest = row.referenceId.slice('reversal:'.length);
    const cut = rest.indexOf(':');
    return cut === -1 ? row : { _id: row._id, referenceType: rest.slice(0, cut), referenceId: rest.slice(cut + 1) };
  });

  const challengeIds = new Set<string>();
  const workoutIds = new Set<string>();
  for (const row of resolved) {
    if (row.referenceType === 'challenge') challengeIds.add(row.referenceId.slice(0, row.referenceId.lastIndexOf(':')));
    if (row.referenceType === 'workout') workoutIds.add(row.referenceId);
  }

  const [defs, workouts] = await Promise.all([
    challengeIds.size > 0
      ? ChallengeDefinitionModel.find({ _id: { $in: [...challengeIds] } }, { cadence: 1 }).lean()
      : Promise.resolve([]),
    workoutIds.size > 0 ? WorkoutModel.find({ _id: { $in: [...workoutIds] } }, { localDay: 1 }).lean() : Promise.resolve([]),
  ]);
  const cadences = new Map(defs.map(def => [def._id, def.cadence]));
  const workoutDays = new Map(workouts.map(workout => [workout._id, workout.localDay]));

  for (const row of resolved) {
    let span: { start: IsoDate; end: IsoDate } | null = null;

    switch (row.referenceType) {
      // `${localDay}:${units}` — the day the steps were walked on.
      case 'activity_day': {
        const day = dayIn(row.referenceId.split(':')[0]);
        if (day) span = { start: day, end: day };
        break;
      }
      // `${challengeId}:${periodStart}` — a daily challenge is one day, a
      // weekly or monthly one the period that day opens.
      case 'challenge': {
        const cut = row.referenceId.lastIndexOf(':');
        const start = dayIn(row.referenceId.slice(cut + 1));
        if (!start) break;
        const cadence = cadences.get(row.referenceId.slice(0, cut));
        span = cadence ? periodOf(cadence, start) : { start, end: start };
        break;
      }
      // `${weekStart}:${country}` — the week the place was won in.
      case 'leaderboard': {
        const start = dayIn(row.referenceId.split(':')[0]);
        if (start) span = { start, end: addDays(start, 6) };
        break;
      }
      // The last day of the run that was bought back.
      case 'streak_restore': {
        const day = dayIn(row.referenceId);
        if (day) span = { start: day, end: day };
        break;
      }
      case 'workout': {
        const day = dayIn(workoutDays.get(row.referenceId));
        if (day) span = { start: day, end: day };
        break;
      }
      default:
        break;
    }

    if (span) out.set(row._id, { ...span, label: labelFor(span.start, span.end, thisYear) });
  }

  return out;
}
