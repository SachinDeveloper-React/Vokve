/**
 * Local calendar dates as `YYYY-MM-DD` strings.
 *
 * Strings rather than `Date` objects because a calendar day is what a streak
 * is counted in, and a `Date` carries a time and a zone that make "the same
 * day" a comparison with three ways to go wrong. Every helper here works in
 * the device's local zone: a workout finished at 23:50 belongs to the day the
 * user saw on their clock, not to UTC's.
 */
export type IsoDate = string;

const pad = (value: number) => String(value).padStart(2, '0');

export function toIsoDate(date: Date): IsoDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

/** Local midnight of the given day, for arithmetic. */
export function fromIsoDate(iso: IsoDate): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** `days` may be negative. Crosses month and year ends correctly. */
export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = fromIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = fromIsoDate(to).getTime() - fromIsoDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "26 May 2025" — the long form for a single date. */
export function formatLongDate(iso: IsoDate): string {
  const date = fromIsoDate(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "May 2025" — a calendar's heading. */
export function formatMonthYear(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

/**
 * "10 – 24 May 2025", or "28 Apr – 4 May 2025" once the range crosses a
 * month, or the full form of both ends across a year.
 */
export function formatDateRange(from: IsoDate, to: IsoDate): string {
  const a = fromIsoDate(from);
  const b = fromIsoDate(to);
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();

  if (sameMonth) {
    return `${a.getDate()} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  }
  if (sameYear) {
    return `${a.getDate()} ${MONTHS[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${
      MONTHS[b.getMonth()].slice(0, 3)
    } ${b.getFullYear()}`;
  }
  return `${formatLongDate(from)} – ${formatLongDate(to)}`;
}
