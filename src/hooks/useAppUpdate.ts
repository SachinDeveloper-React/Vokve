import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { appApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import { getMMKV } from '../stores';
import { useAppStatusStore, useSoftUpdate } from '../stores/appStatusStore';
import type { AppUpdate } from '../types/models';
import { logger } from '../utils/logger';

/**
 * Asks the server what this build should do about its own version
 * (`GET /app/update`), on launch and on every return to the foreground —
 * which is when a member who has just updated from the store comes back,
 * and when one who has not should be asked again.
 *
 * A **hard** verdict draws the wall through `useUpgradeRequired`; this hook
 * only decides whether the **soft** knock is shown, and that is the whole
 * subtlety here: a prompt that appears on every launch is a prompt people
 * learn to dismiss without reading. So a "Later" is remembered against the
 * version it was about, for as long as the server says (`remindAfterHours`),
 * and a newer release than the one that was dismissed asks again at once.
 *
 * The check is not gated on a session: a build can be retired before anyone
 * signs in, and that member needs telling too.
 */
const DISMISSED_KEY = 'vokve.update.dismissed';
/** Checked at most this often, so a member flicking between apps is not a poll loop. */
const MIN_CHECK_INTERVAL_MS = 60_000;

interface Dismissal {
  /** The version that was dismissed, so a newer one is not covered by it. */
  version: string;
  at: number;
}

function readDismissal(): Dismissal | null {
  try {
    const raw = getMMKV().getString(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as Dismissal) : null;
  } catch {
    return null;
  }
}

function writeDismissal(dismissal: Dismissal): void {
  try {
    getMMKV().set(DISMISSED_KEY, JSON.stringify(dismissal));
  } catch (error) {
    logger.warn('useAppUpdate', 'Could not remember the dismissal', error);
  }
}

/** Whether a soft prompt for this version is still inside its quiet window. */
function isQuiet(update: AppUpdate, dismissal: Dismissal | null): boolean {
  if (!dismissal) return false;
  const target = update.latest?.version ?? update.minVersion;
  if (dismissal.version !== target) return false;
  const hours = update.remindAfterHours ?? 24;
  return Date.now() - dismissal.at < hours * 3_600_000;
}

export interface SoftUpdatePrompt {
  /** The verdict to draw, or null: nothing to say, or said recently enough. */
  update: AppUpdate | null;
  /** "Later": quiet for `remindAfterHours`, and only about this version. */
  dismiss: () => void;
}

export function useAppUpdate(): SoftUpdatePrompt {
  const soft = useSoftUpdate();
  const setUpdate = useAppStatusStore(s => s.setUpdate);
  const [dismissal, setDismissal] = useState<Dismissal | null>(readDismissal);

  useEffect(() => {
    let last = 0;
    let alive = true;

    const check = async () => {
      if (Date.now() - last < MIN_CHECK_INTERVAL_MS) return;
      last = Date.now();
      try {
        const update = await appApi.update();
        if (alive) setUpdate(update);
      } catch (error) {
        // Offline, or a server that cannot answer: the app carries on as it
        // is. A build that must be walled off will be refused by the next
        // request anyway (426), which draws the same screen.
        logger.debug('useAppUpdate', 'Update check skipped', toApiError(error));
      }
    };

    check();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') check();
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, [setUpdate]);

  const dismiss = useCallback(() => {
    if (!soft) return;
    const next = { version: soft.latest?.version ?? soft.minVersion, at: Date.now() };
    writeDismissal(next);
    setDismissal(next);
  }, [soft]);

  return { update: soft && !isQuiet(soft, dismissal) ? soft : null, dismiss };
}
