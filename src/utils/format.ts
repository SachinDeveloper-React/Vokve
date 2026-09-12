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
  return formatGrouped(value);
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
