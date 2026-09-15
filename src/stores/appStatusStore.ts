import { create } from 'zustand';
import { setOnUpgradeRequired } from '../services/api/client';

export interface UpgradeRequirement {
  /** Where to send the user — the platform's store listing. */
  storeUrl: string | null;
  minVersion: string | null;
  /** What the server said, verbatim — it is written for the user. */
  message: string;
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
}

/**
 * App-wide conditions that are nobody's screen in particular. Deliberately
 * not persisted: a retired build is retired on every launch, and the server
 * will say so again within the first request.
 */
export const useAppStatusStore = create<AppStatusState>(set => ({
  upgradeRequired: null,
  setUpgradeRequired: upgradeRequired => set({ upgradeRequired }),
}));

export const useUpgradeRequired = () =>
  useAppStatusStore(s => s.upgradeRequired);

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
