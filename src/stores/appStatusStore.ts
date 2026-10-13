import { useMemo } from 'react';
import { create } from 'zustand';
import { setOnUpgradeRequired } from '../services/api/client';
import type { AppUpdate } from '../types/models';

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
}));

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
