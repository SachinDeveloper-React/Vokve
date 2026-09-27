import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { accountApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type {
  AccountDeletion,
  PrivacySettings,
  ProfileSummary,
} from '../types/models';
import { logger } from '../utils/logger';
import { mmkvStorage } from './index';

/** How old a synced profile may be before opening the account tab fetches it again. */
export const PROFILE_STALE_AFTER_MS = 60_000;

interface AccountState {
  /** What the account screen draws; null before the first sync. */
  profile: ProfileSummary | null;
  /** The member's data choices; null before the privacy screen has asked. */
  privacy: PrivacySettings | null;
  /** Where a scheduled deletion stands; null before it has been asked for. */
  deletion: AccountDeletion | null;
  syncedAt: string | null;
  isSyncing: boolean;
  /** Line by line: a switch being written, so its row can hold still. */
  savingPrivacy: (keyof PrivacySettings)[];
  syncError: string | null;

  hydrateFromServer: () => Promise<void>;
  refreshIfStale: () => Promise<void>;
  loadPrivacy: () => Promise<void>;
  /**
   * Flips one switch: it moves at once, and moves back if the server
   * refuses. Throws the `ApiError` so the screen can word the refusal.
   */
  setPrivacy: <K extends keyof PrivacySettings>(
    key: K,
    value: PrivacySettings[K],
  ) => Promise<void>;
  loadDeletion: () => Promise<void>;
  /** Replaces what the store holds after a deletion is scheduled or cancelled. */
  setDeletion: (deletion: AccountDeletion) => void;
  reset: () => void;
}

/**
 * Who the member is to the app: the profile the account screen paints and
 * the choices they have made about their data (RULES P4, P6, P7).
 *
 * The profile is a cache of `GET /me/profile`, persisted so the account tab
 * paints its level, streak and badges the instant it opens and corrects
 * itself a moment later. It is never written to locally — every figure on
 * it is the server's arithmetic over rows the client does not hold, and a
 * client that adjusted its own level would be inventing one.
 *
 * Privacy and the deletion are fetched on demand rather than on sign-in:
 * they belong to one screen each, and neither is worth a request on every
 * launch.
 */
export const useAccountStore = create<AccountState>()(
  persist(
    (set, get) => ({
      profile: null,
      privacy: null,
      deletion: null,
      syncedAt: null,
      isSyncing: false,
      savingPrivacy: [],
      syncError: null,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true, syncError: null });
        try {
          const profile = await accountApi.profile();
          set({
            profile,
            syncedAt: new Date().toISOString(),
            isSyncing: false,
          });
        } catch (error) {
          const apiError = toApiError(error);
          logger.warn('accountStore', 'Profile sync failed', apiError);
          set({ isSyncing: false, syncError: apiError.message });
        }
      },

      refreshIfStale: async () => {
        const { syncedAt, isSyncing, hydrateFromServer } = get();
        if (isSyncing) {
          return;
        }
        const age = syncedAt
          ? Date.now() - new Date(syncedAt).getTime()
          : Infinity;
        if (age < PROFILE_STALE_AFTER_MS) {
          return;
        }
        await hydrateFromServer();
      },

      loadPrivacy: async () => {
        try {
          set({ privacy: await accountApi.privacy() });
        } catch (error) {
          logger.warn('accountStore', 'Privacy load failed', toApiError(error));
        }
      },

      setPrivacy: async (key, value) => {
        const before = get().privacy;
        if (!before) {
          return;
        }
        set(state => ({
          privacy: { ...before, [key]: value },
          savingPrivacy: [...state.savingPrivacy, key],
        }));
        try {
          const saved = await accountApi.updatePrivacy({ [key]: value });
          set(state => ({
            privacy: saved,
            savingPrivacy: state.savingPrivacy.filter(entry => entry !== key),
          }));
        } catch (error) {
          set(state => ({
            privacy: before,
            savingPrivacy: state.savingPrivacy.filter(entry => entry !== key),
          }));
          throw toApiError(error);
        }
      },

      loadDeletion: async () => {
        try {
          set({ deletion: await accountApi.deletion() });
        } catch (error) {
          logger.warn(
            'accountStore',
            'Deletion status failed',
            toApiError(error),
          );
        }
      },

      setDeletion: deletion => set({ deletion }),

      reset: () =>
        set({
          profile: null,
          privacy: null,
          deletion: null,
          syncedAt: null,
          isSyncing: false,
          savingPrivacy: [],
          syncError: null,
        }),
    }),
    {
      name: 'vokve.account',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      // Privacy and the deletion are not persisted: they are consent and a
      // countdown, and a stale copy of either is worse than a blank screen
      // for the second it takes to fetch them.
      partialize: state => ({
        profile: state.profile,
        syncedAt: state.syncedAt,
      }),
    },
  ),
);

export const useProfileSummary = () => useAccountStore(s => s.profile);
export const usePrivacySettings = () => useAccountStore(s => s.privacy);
export const useAccountDeletion = () => useAccountStore(s => s.deletion);
export const useIsPrivacySaving = (key: keyof PrivacySettings) =>
  useAccountStore(s => s.savingPrivacy.includes(key));
/** True while a deletion is scheduled and can still be called off. */
export const useIsDeletionScheduled = () =>
  useAccountStore(s => s.deletion?.scheduledAt != null);
