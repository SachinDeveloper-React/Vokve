import { COUNTRIES } from '../constants/countries';
import type { UnitSystem } from '../types/models';

const KG_PER_LB = 0.45359237;
const CM_PER_INCH = 2.54;

/**
 * Weights are stored in kilograms everywhere and converted only for display.
 * Storing whatever unit the user happened to prefer at entry time makes every
 * later aggregation — weekly volume, personal bests — silently wrong.
 */
export function formatWeight(kg: number, units: UnitSystem): string {
  if (units === 'imperial') {
    return `${Math.round(kg / KG_PER_LB)} lb`;
  }
  return `${Number.isInteger(kg) ? kg : kg.toFixed(1)} kg`;
}

export function formatHeight(cm: number, units: UnitSystem): string {
  if (units === 'imperial') {
    const totalInches = Math.round(cm / CM_PER_INCH);
    return `${Math.floor(totalInches / 12)}'${totalInches % 12}"`;
  }
  return `${Math.round(cm)} cm`;
}

/** `4 520` kg of volume reads better than `4520`. */
export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/**
 * Groups a whole number into thousands — `7543` reads as `7,543`.
 *
 * Grouped by hand rather than through `toLocaleString`: the separator would
 * then follow the device locale while the rest of the app's copy stays in
 * English, so a figure could come back as `1.240` on one phone and `1,240` on
 * the next. The sign is preserved so a debit can be passed straight through.
 */
export function formatGrouped(value: number): string {
  const rounded = Math.round(value);
  const digits = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rounded < 0 ? `-${digits}` : digits;
}

/**
 * A coin figure. The same grouping, under the name the wallet reads by — every
 * coin figure in the app goes through this one call, so the currency's
 * formatting can change in a single edit.
 */
export function formatCoins(value: number): string {
  // Coins are decimal to three places on the server (D-27); whole numbers
  // stay whole, fractions show two places — "0.095" reads as "0.10".
  if (Number.isInteger(value)) {
    return formatGrouped(value);
  }
  const fixed = Math.abs(value).toFixed(2);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${grouped}.${fraction}`;
}

/** Seconds to `m:ss`, or `h:mm:ss` once a session passes an hour. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

export function formatRelativeDay(isoDate: string): string {
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) {
    return '';
  }

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  const dayDiff = Math.round(
    (startOfDay(new Date()) - startOfDay(then)) / 86_400_000,
  );

  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) return `${dayDiff} days ago`;

  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * The clock time a timestamp lands on — `10:30 AM`, `6:45 PM`.
 *
 * Written out rather than handed to `toLocaleTimeString`, for the same reason
 * `formatCoins` groups its own thousands: the device's locale would put a
 * 24-hour clock on some phones and a 12-hour one on others, in the middle of a
 * list whose headings ("Today", "Yesterday") are English either way.
 */
export function formatClockTime(isoDate: string): string {
  const at = new Date(isoDate);
  if (Number.isNaN(at.getTime())) {
    return '';
  }

  const hours = at.getHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  // Midnight and noon are the 12s: `0 % 12` and `12 % 12` are both 0.
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;

  return `${hour12}:${String(at.getMinutes()).padStart(2, '0')} ${suffix}`;
}

/**
 * A 24-hour `HH:mm` as the app writes clock times — `07:00` to `07:00 AM`.
 *
 * The sibling of `formatClockTime`, which takes a timestamp. A reminder has no
 * date to attach to: it is a time of day that recurs, so it is stored and
 * formatted as one. Anything unparseable is returned untouched rather than
 * rendered as `NaN:NaN AM`.
 */
export function formatTimeOfDay(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) {
    return hhmm;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return hhmm;
  }

  const suffix = hours < 12 ? 'AM' : 'PM';
  // Midnight and noon are the 12s: `0 % 12` and `12 % 12` are both 0.
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;

  return `${String(hour12).padStart(2, '0')}:${match[2]} ${suffix}`;
}

/**
 * Seconds to `mm:ss`, minutes padded — `01:45`, `00:27`.
 *
 * Distinct from `formatDuration`, which drops the leading zero because a
 * workout timer reads better as `1:45`. A countdown does not: an unpadded
 * minute makes the text reflow as it ticks past `10:00`, and a clock that
 * jitters sideways while the user watches it looks broken.
 */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

/**
 * Groups an E.164 number for display — `+919876543210` to `+91 98765 43210`.
 *
 * Grouping only, not real formatting: getting that right per country needs
 * libphonenumber's metadata, which is a megabyte the app has no other use for.
 * The dial code is split off by the longest match in `COUNTRIES` (longest
 * first, or `+1` would claim every `+1x` number), and the rest is chunked so
 * the reader can check it against the number they typed. Anything unrecognised
 * is returned untouched rather than mangled.
 */
export function formatPhoneNumber(e164: string): string {
  const match = COUNTRIES.map(country => country.dialCode)
    .filter(dialCode => e164.startsWith(dialCode))
    .sort((a, b) => b.length - a.length)[0];

  if (!match) {
    return e164;
  }

  const national = e164.slice(match.length);
  const grouped =
    national.length === 10
      ? `${national.slice(0, 5)} ${national.slice(5)}`
      : (national.match(/.{1,3}/g) ?? []).join(' ');

  return grouped ? `${match} ${grouped}` : match;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/**
 * A money figure from its minor units — `44900` paise reads as `₹449`,
 * `44950` as `₹449.50`. Whole amounts drop the paise: a shop that prices
 * in whole rupees would otherwise put `.00` after everything, which is
 * noise on a card. Grouped by hand for the same reason `formatGrouped` is.
 */
export function formatMoney(minor: number, currency = 'INR'): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const grouped = formatGrouped(whole);
  return fraction === 0
    ? `${sign}${symbol}${grouped}`
    : `${sign}${symbol}${grouped}.${String(fraction).padStart(2, '0')}`;
}

/** `29% off` from a list price and a selling price; null when there is no saving to name. */
export function formatDiscount(
  price: number,
  mrp: number | null,
): string | null {
  if (mrp === null || mrp <= price) return null;
  const pct = Math.round(((mrp - price) / mrp) * 100);
  return pct > 0 ? `${pct}% off` : null;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * `May 2025` from an ISO date — how a join date reads on a profile.
 *
 * Spelled out by hand rather than through `toLocaleDateString` for the same
 * reason the thousands separator is: the rest of the app's copy is English,
 * and a date that came back as "mai 2025" on one phone would be the only
 * translated string on the screen.
 */
export function formatMonthYear(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * A full date — `19 Sep 2026`. Written out for the same reason
 * `formatMonthYear` is: the device's locale would otherwise translate the
 * one date on an otherwise English receipt.
 */
export function formatDayMonthYear(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * A delivery window as one line — `23 – 26 Sep 2026`, or
 * `28 Sep – 2 Oct 2026` when it crosses a month. The parts both ends share
 * are said once: a member reading when their parcel lands should not have
 * to notice that "Sep" appears twice.
 */
export function formatDayRange(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '';
  if (from.getTime() === to.getTime()) return formatDayMonthYear(fromIso);
  const sameYear = from.getFullYear() === to.getFullYear();
  const sameMonth = sameYear && from.getMonth() === to.getMonth();
  const head = sameMonth
    ? String(from.getDate())
    : sameYear
    ? `${from.getDate()} ${MONTHS[from.getMonth()]}`
    : formatDayMonthYear(fromIso);
  return `${head} – ${formatDayMonthYear(toIso)}`;
}

/** `in 12 days` / `today` / `tomorrow` — how a deadline reads in a sentence. */
export function formatDaysUntil(isoDate: string): string {
  const target = new Date(isoDate);
  if (Number.isNaN(target.getTime())) return '';
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round(
    (startOfDay(target) - startOfDay(new Date())) / 86_400_000,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
