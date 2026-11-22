import { AppIcon, type SetIconOutcome } from 'vokve-app-icon';
import { getMMKV } from '../stores';
import type { AppIconDecision } from '../types/models';
import { logger } from '../utils/logger';
import { appApi, deviceApi } from './api/endpoints';
import { toApiError } from './api/errors';
import { getDeviceId } from './device';

/**
 * The launcher icon (RULES DV13).
 *
 * The server names two keys — the everyday icon and, around a festival, a
 * festive one — and this shows the one that applies, if the build carries
 * it. Every icon is inside the build (neither OS will put a downloaded
 * picture on the home screen), so a key a newer server knows and this build
 * does not is simply skipped, and the phone keeps its base icon.
 *
 * Each OS has its own way of changing it, and both are in `vokve-app-icon`:
 * on iOS the change is made at once and the system tells the member so in
 * its own alert; on Android it is made when the member next leaves the app,
 * because swapping the launcher entry while the app is in front can close it.
 */

const FESTIVE_KEY = 'vokve.appIcon.festive';
/** The last icon the server was told about, as `deviceId:key`, so it is told once. */
const REPORTED_KEY = 'vokve.appIcon.reported';

/** Whether this phone shows festive icons. On unless the member turned it off. */
export function areFestiveIconsOn(): boolean {
  try {
    return getMMKV().getBoolean(FESTIVE_KEY) ?? true;
  } catch {
    return true;
  }
}

export function setFestiveIconsOn(on: boolean): void {
  try {
    getMMKV().set(FESTIVE_KEY, on);
  } catch (error) {
    logger.warn('appIcon', 'Could not remember the festive icon choice', error);
  }
}

/** Whether this build can change its icon at all — the setting is hidden where it cannot. */
export const canChangeAppIcon = (): boolean => AppIcon !== null;

/**
 * The key to ask for, or null to leave the icon as it is. Festive first when
 * the member allows it and the build has it; then the base; and where the
 * build has neither, nothing — better the icon it has than a guess.
 */
export function chooseIcon(
  decision: AppIconDecision,
  available: readonly string[],
  festiveOn: boolean,
): string | null {
  if (festiveOn && decision.festive && available.includes(decision.festive)) {
    return decision.festive;
  }
  return available.includes(decision.base) ? decision.base : null;
}

export type AppIconSync =
  | { status: 'unsupported' }
  | { status: 'offline' | 'failed'; icon: string | null }
  | { status: SetIconOutcome; icon: string };

let inFlight: Promise<AppIconSync> | null = null;

/**
 * Asks the server which icon to show and shows it. Safe to call as often as
 * the app likes — on launch, on every foreground, after the member flips
 * the festive switch: concurrent calls share one run, and asking for the
 * icon already showing changes nothing (and on iOS shows no alert).
 */
export function syncAppIcon(): Promise<AppIconSync> {
  if (!inFlight) {
    inFlight = run().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function run(): Promise<AppIconSync> {
  if (!AppIcon) return { status: 'unsupported' };

  let state;
  try {
    state = await AppIcon.getState();
  } catch (error) {
    logger.warn('appIcon', 'Could not read the launcher icon', error);
    return { status: 'failed', icon: null };
  }
  if (!state.supported) return { status: 'unsupported' };

  let decision: AppIconDecision;
  try {
    decision = await appApi.icon();
  } catch (error) {
    // Offline: the icon stays as it is, and the next foreground asks again.
    logger.debug('appIcon', 'Icon check skipped', toApiError(error));
    await report(state.current);
    return { status: 'offline', icon: state.current };
  }

  const want = chooseIcon(decision, state.available, areFestiveIconsOn());
  // Asking for what is showing still matters on Android when something else
  // is pending: it cancels the swap the member has since turned off.
  if (!want || (want === state.current && state.pending === null)) {
    await report(state.current);
    return { status: 'unchanged', icon: state.current };
  }

  let outcome: SetIconOutcome;
  try {
    outcome = await AppIcon.setIcon(want);
  } catch (error) {
    // iOS refuses while the app is not in front, and occasionally while a
    // system alert is up; the next foreground tries again.
    logger.warn('appIcon', `Could not switch the icon to ${want}`, error);
    await report(state.current);
    return { status: 'failed', icon: state.current };
  }
  await report(outcome === 'applied' ? want : state.current);
  return { status: outcome, icon: outcome === 'pending' ? state.current : want };
}

/**
 * Tells the server which icon this install shows, once per change, so the
 * panel can say how far a festive icon has reached. Best-effort: signed out
 * there is no device to say it for, and a failure is said again next time.
 */
async function report(current: string): Promise<void> {
  const deviceId = getDeviceId();
  if (!deviceId || !current) return;
  const marker = `${deviceId}:${current}`;
  try {
    if (getMMKV().getString(REPORTED_KEY) === marker) return;
    await deviceApi.setAppIcon(deviceId, current);
    getMMKV().set(REPORTED_KEY, marker);
  } catch (error) {
    logger.debug('appIcon', 'Could not report the icon', toApiError(error));
  }
}
