import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { referralApi } from '../services/api/endpoints';
import { ApiError, toApiError } from '../services/api/errors';
import type { Referral, ReferralProgram } from '../types/models';
import { logger } from '../utils/logger';
import { mmkvStorage } from './index';

/** How old a synced programme may be before opening the screen fetches it again. */
export const REFERRAL_STALE_AFTER_MS = 60_000;

interface ReferralState {
  /** The last `GET /referrals/me`; null until the first sync. */
  program: ReferralProgram | null;
  /** Referrals beyond the programme's first page, once "View All" fetched them. */
  moreReferrals: Referral[];
  nextCursor: string | null;
  syncedAt: string | null;
  isSyncing: boolean;
  isLoadingMore: boolean;
  isApplying: boolean;

  hydrateFromServer: () => Promise<void>;
  refreshIfStale: () => Promise<void>;
  loadMore: () => Promise<void>;
  /**
   * Applies a friend's code (RULES F2). Resolves to the refreshed programme,
   * or throws the `ApiError` — its `code` is what the claim card words
   * (`REFERRAL_CODE_INVALID`, `REFERRAL_SELF`, `REFERRAL_ALREADY_APPLIED`,
   * `REFERRAL_WINDOW_CLOSED`).
   */
  apply: (code: string) => Promise<ReferralProgram>;
  reset: () => void;
}

/**
 * Referral & Earn (RULES §F): the user's code, what it has earned, who joined
 * on it, and the code they themselves joined on.
 *
 * A cache of one call. The reward amounts, the share text and the share
 * URL are all the server's (F3, F6) and nothing here invents them — the
 * seeded figures the screen used to show are gone, so before the first sync
 * the screen says it is loading rather than promising coins it cannot vouch
 * for.
 */
export const useReferralStore = create<ReferralState>()(
  persist(
    (set, get) => ({
      program: null,
      moreReferrals: [],
      nextCursor: null,
      syncedAt: null,
      isSyncing: false,
      isLoadingMore: false,
      isApplying: false,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true });
        try {
          const program = await referralApi.me();
          // The first page rides on the programme; a fresh sync starts the
          // "View All" pages over so the two cannot overlap.
          set({
            program,
            moreReferrals: [],
            nextCursor:
              program.referrals.length >= 20
                ? program.referrals[program.referrals.length - 1].id
                : null,
            syncedAt: new Date().toISOString(),
            isSyncing: false,
          });
        } catch (error) {
          logger.warn(
            'referralStore',
            'Referral sync failed',
            toApiError(error),
          );
          set({ isSyncing: false });
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
        if (age < REFERRAL_STALE_AFTER_MS) {
          return;
        }
        await hydrateFromServer();
      },

      loadMore: async () => {
        const { nextCursor, isLoadingMore, isSyncing } = get();
        if (nextCursor === null || isLoadingMore || isSyncing) {
          return;
        }
        set({ isLoadingMore: true });
        try {
          const page = await referralApi.list(nextCursor);
          set(state => ({
            moreReferrals: [...state.moreReferrals, ...page.data],
            nextCursor: page.nextCursor,
            isLoadingMore: false,
          }));
        } catch (error) {
          logger.warn(
            'referralStore',
            'Could not load more referrals',
            toApiError(error),
          );
          set({ isLoadingMore: false });
        }
      },

      apply: async code => {
        set({ isApplying: true });
        try {
          const program = await referralApi.apply(code);
          set({
            program,
            isApplying: false,
            syncedAt: new Date().toISOString(),
          });
          return program;
        } catch (error) {
          set({ isApplying: false });
          throw toApiError(error);
        }
      },

      reset: () =>
        set({
          program: null,
          moreReferrals: [],
          nextCursor: null,
          syncedAt: null,
          isSyncing: false,
          isLoadingMore: false,
          isApplying: false,
        }),
    }),
    {
      name: 'vokve.referrals',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
      partialize: state => ({
        program: state.program,
        syncedAt: state.syncedAt,
      }),
    },
  ),
);

export const useReferralProgram = () => useReferralStore(s => s.program);
export const useIsApplyingReferral = () => useReferralStore(s => s.isApplying);

/** Words a failed apply for the claim card. Anything unnamed keeps the server's message. */
export function describeReferralError(error: ApiError): {
  title: string;
  message: string;
} {
  switch (error.code) {
    case 'REFERRAL_CODE_INVALID':
      return {
        title: "That code doesn't match anyone",
        message: 'Check it with your friend and try again.',
      };
    case 'REFERRAL_SELF':
      return {
        title: "That's your own code",
        message: 'Share it with a friend instead — you earn when they join.',
      };
    case 'REFERRAL_ALREADY_APPLIED':
      return {
        title: 'Already joined on a code',
        message: 'A code can only be applied once.',
      };
    case 'REFERRAL_WINDOW_CLOSED':
      return { title: 'Too late to apply a code', message: error.message };
    default:
      return { title: "Couldn't apply that code", message: error.message };
  }
}
