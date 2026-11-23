import { useMemo } from 'react';
import { create } from 'zustand';
import { setOnMaintenance, setOnUpgradeRequired } from '../services/api/client';
import type { AppStatus, AppUpdate } from '../types/models';

/** Maintenance as this phone knows it (RULES DV14) — the server's own words. */
export type MaintenanceNotice = AppStatus['maintenance'];

/** What the screen says when a refusal arrives without a title of its own. */
export const MAINTENANCE_DEFAULT_TITLE = "We'll be right back";

export interface UpgradeRequirement {
  /** Where to send the user — the platform's store listing. */
  storeUrl: string | null;
  minVersion: string | null;
  /** What the server said, verbatim — it is written for the user. */
  message: string;
  /** The server's heading and button, when it had one to give (`/app/update`). */
  title?: string;
  actionLabel?: string;
}

interface AppStatusState {
  /**
   * Set the moment any request answers 426. Nothing else in the app can
   * proceed past it: the API has retired this build, and every call would
   * fail the same way, so the root navigator shows one screen instead of
   * letting each of them fail in turn.
   */
  upgradeRequired: UpgradeRequirement | null;
  setUpgradeRequired: (requirement: UpgradeRequirement | null) => void;
  /**
   * The server's own verdict on this version (`GET /app/update`), read on
   * launch and on every return to the foreground.
   *
   * It arrives *before* a request is refused, which is the difference
   * between a member seeing "update to continue" and seeing something go
   * wrong: a `hard` verdict draws the same wall the 426 does, without
   * waiting for a call to fail.
   */
  update: AppUpdate | null;
  setUpdate: (update: AppUpdate | null) => void;
  /**
   * Maintenance (RULES DV14), from `GET /app/status` on launch, foreground
   * and every half minute while it lasts — or the moment any request is
   * refused with 503 `MAINTENANCE`, or answered with the tester's header.
   * Null when the app is not in maintenance.
   */
  maintenance: MaintenanceNotice | null;
  setMaintenance: (maintenance: MaintenanceNotice | null) => void;
  /**
   * "Team sign-in", pressed on the maintenance screen of a phone that is
   * signed out: the sign-in screens are shown behind it, so a tester can get
   * in. Anybody else who signs in is back on the screen at once.
   */
  maintenanceSignIn: boolean;
  setMaintenanceSignIn: (on: boolean) => void;
}

/**
 * App-wide conditions that are nobody's screen in particular. Deliberately
 * not persisted: a retired build is retired on every launch, and the server
 * will say so again within the first request.
 */
export const useAppStatusStore = create<AppStatusState>(set => ({
  upgradeRequired: null,
  setUpgradeRequired: upgradeRequired => set({ upgradeRequired }),
  update: null,
  setUpdate: update => set({ update }),
  maintenance: null,
  setMaintenance: maintenance =>
    set(
      maintenance
        ? { maintenance }
        : // Over: a team sign-in belongs to the maintenance it was for.
          { maintenance: null, maintenanceSignIn: false },
    ),
  maintenanceSignIn: false,
  setMaintenanceSignIn: maintenanceSignIn => set({ maintenanceSignIn }),
}));

/** The maintenance screen, for a member it keeps out; null for a tester or when there is none. */
export const useMaintenanceWall = (): MaintenanceNotice | null => {
  const maintenance = useAppStatusStore(s => s.maintenance);
  return maintenance?.active && !maintenance.bypass ? maintenance : null;
};

/** Whether this member is carrying on through maintenance — a tester, or staff — and so sees the strip. */
export const useMaintenanceBypass = (): boolean =>
  useAppStatusStore(s =>
    Boolean(s.maintenance?.active && s.maintenance.bypass),
  );

const sameNotice = (
  a: MaintenanceNotice | null,
  b: MaintenanceNotice,
): boolean =>
  a !== null &&
  a.active === b.active &&
  a.bypass === b.bypass &&
  a.title === b.title &&
  a.message === b.message &&
  a.endsAt === b.endsAt;

/** Takes what the server said about maintenance, leaving the store alone when nothing changed. */
export function noteMaintenance(next: MaintenanceNotice | null): void {
  const { maintenance, setMaintenance } = useAppStatusStore.getState();
  if (next === null || !next.active) {
    if (maintenance !== null) setMaintenance(null);
    return;
  }
  if (!sameNotice(maintenance, next)) setMaintenance(next);
}

// A refusal draws the screen with the words it carried; a let-through answer
// draws the strip, keeping whatever words are already known.
setOnMaintenance(signal => {
  const current = useAppStatusStore.getState().maintenance;
  if ('refused' in signal) {
    const { details, message } = signal.refused;
    noteMaintenance({
      active: true,
      bypass: false,
      title:
        typeof details?.title === 'string'
          ? details.title
          : MAINTENANCE_DEFAULT_TITLE,
      message,
      endsAt: typeof details?.endsAt === 'string' ? details.endsAt : null,
    });
    return;
  }
  noteMaintenance({
    active: true,
    bypass: true,
    title: current?.title ?? MAINTENANCE_DEFAULT_TITLE,
    message: current?.message ?? '',
    endsAt: current?.endsAt ?? null,
  });
});

/**
 * The wall, from whichever side said so first: a request refused with 426,
 * or the server's own verdict. One selector, because the screen is the same
 * either way and a build must not get past it because the two arrived in a
 * different order.
 */
export const useUpgradeRequired = (): UpgradeRequirement | null => {
  // Two plain selectors and a memo, never one selector that builds an
  // object: a selector returning a fresh object every call re-renders
  // forever, and the screen it feeds is the one nobody can get past.
  const refused = useAppStatusStore(s => s.upgradeRequired);
  const update = useAppStatusStore(s => s.update);
  return useMemo(() => {
    if (refused) return refused;
    if (update?.status !== 'hard') return null;
    return {
      storeUrl: update.storeUrl,
      minVersion: update.minVersion,
      message: update.message,
      title: update.title,
      actionLabel: update.actionLabel,
    };
  }, [refused, update]);
};

/** The knock, and nothing else — a hard verdict is the wall above, not a sheet. */
export const useSoftUpdate = (): AppUpdate | null =>
  useAppStatusStore(s => (s.update?.status === 'soft' ? s.update : null));

// The API layer cannot import this store without a cycle, so it calls back.
setOnUpgradeRequired(error => {
  const storeUrl = error.details?.storeUrl;
  const minVersion = error.details?.minVersion;
  useAppStatusStore.setState({
    upgradeRequired: {
      storeUrl: typeof storeUrl === 'string' ? storeUrl : null,
      minVersion: typeof minVersion === 'string' ? minVersion : null,
      message: error.message,
    },
  });
});
