/**
 * Every launcher icon the app has ever shipped (RULES DV13).
 *
 * The same keys as the app's `assets/app-icons/catalog.json`. An icon has to
 * be *inside* a build to be shown — neither Android nor iOS lets an app put
 * a downloaded picture on the home screen — so this list is what the panel
 * may choose from, and a build that does not carry a key simply keeps the
 * base icon. Adding one is new art, a new build, and a line here; a key is
 * never removed once a build has shipped it (an Android phone showing it
 * would be left with no launcher entry), only retired.
 *
 * Kept apart from `appIcon.service` with no imports of its own, because the
 * config validator reads it and the service reads the config.
 */
export type AppIconKind = 'base' | 'festive';

export interface AppIconEntry {
  key: string;
  kind: AppIconKind;
  label: string;
  /** No longer offered in the panel; builds that carry it still show it if set. */
  retired?: boolean;
}

export const APP_ICONS: readonly AppIconEntry[] = [
  // Retired 2026-11-26 (D-117): the owner wanted no all-red icon, and its
  // art is now a copy of the white one. The key stays — builds carry it as
  // an Android alias and an iOS alternate — but the name says what it shows.
  { key: 'redfield', kind: 'base', label: 'Old red (now white)', retired: true },
  { key: 'classic', kind: 'base', label: 'Classic' },
  { key: 'night', kind: 'base', label: 'Night' },
  { key: 'christmas', kind: 'festive', label: 'Christmas' },
  { key: 'diwali', kind: 'festive', label: 'Diwali' },
  { key: 'eid', kind: 'festive', label: 'Eid' },
  { key: 'holi', kind: 'festive', label: 'Holi' },
  { key: 'independence', kind: 'festive', label: 'Independence Day' },
  { key: 'newyear', kind: 'festive', label: 'New Year 2027' },
];

/** The icon a fresh install shows, and the one the app falls back to. */
export const DEFAULT_APP_ICON = 'classic';

export const appIconKeys = (kind: AppIconKind): string[] =>
  APP_ICONS.filter(icon => icon.kind === kind).map(icon => icon.key);
