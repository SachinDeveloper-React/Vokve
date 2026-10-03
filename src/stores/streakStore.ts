import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { streakApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { StreakSummary } from '../types/models';
import { logger } from '../utils/logger';
import { uuid } from '../utils/uuid';
import { useCoinsStore } from './coinsStore';
import { mmkvStorage } from './index';

/** How old a synced streak may be before opening a screen fetches it again. */
export const STREAK_STALE_AFTER_MS = 60_000;

/**
 * What a freeze or a restore came to. A refusal carries the server's code
 * (`NO_FREEZES_LEFT`, `STREAK_ALREADY_COVERED`, `NOTHING_TO_RESTORE`,
 * `INSUFFICIENT_COINS`) and its message, which is written for the user.
 */
export type StreakActionResult =
  | { ok: true }
  | { ok: false; code: string | null; message: string };

interface StreakState {
  /** The last `GET /streak`; null until the first sync. */
  summary: StreakSummary | null;
  syncedAt: string | null;
  isSyncing: boolean;
  /** Why the last sync failed; cleared by the next one that succeeds. */
  syncError: string | null;
  /** The tool in flight, so its row can wait rather than be pressed twice. */
  pendingAction: 'freeze' | 'restore' | null;

  hydrateFromServer: () => Promise<void>;
  /** `hydrateFromServer`, unless the streak is fresher than `STREAK_STALE_AFTER_MS`. */
  refreshIfStale: () => Promise<void>;
  /** Spends a freeze on today. The server refuses, with nothing spent, when it cannot help. */
  freezeToday: () => Promise<StreakActionResult>;
  /**
   * Bridges the last gap for coins. The server debits and protects in one
   * transaction, so a refusal has charged nothing.
   */
  restore: () => Promise<StreakActionResult>;
  reset: () => void;
}

const EMPTY_STREAK = {
  summary: null,
  syncedAt: null,
} satisfies Partial<StreakState>;

/**
 * The streak, as the server counts it (RULES §S).
 *
 * A cache of one call. Which days count, the two figures, the freezes, the
 * restore and what it costs are all decided on the server — the days come
 * from workouts and verified steps it has seen, and a restore is paid for
 * there in the same transaction that protects the days. Nothing here works a
 * streak out or charges for one.
 */
export const useStreakStore = create<StreakState>()(
  persist(
    (set, get) => ({
      ...EMPTY_STREAK,
      isSyncing: false,
      syncError: null,
      pendingAction: null,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true });
        try {
          const summary = await streakApi.get();
          set({
            summary,
            syncedAt: new Date().toISOString(),
            isSyncing: false,
            syncError: null,
          });
        } catch (error) {
          const apiError = toApiError(error);
          logger.warn('streakStore', 'Streak sync failed', apiError);
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
        if (age < STREAK_STALE_AFTER_MS) {
          return;
        }
        await hydrateFromServer();
      },

      freezeToday: async () => {
        if (get().pendingAction !== null) {
          return { ok: false, code: 'IN_PROGRESS', message: 'One moment…' };
        }
        set({ pendingAction: 'freeze' });
        try {
          const summary = await streakApi.freeze({ idempotencyKey: uuid() });
          set({
            summary,
            syncedAt: new Date().toISOString(),
            pendingAction: null,
          });
          return { ok: true };
        } catch (error) {
          const apiError = toApiError(error);
          set({ pendingAction: null });
          // A refusal means the cached streak was behind the server's; the
          // next look should be at the server's.
          if (apiError.status !== null) {
            get().hydrateFromServer();
          }
          return { ok: false, code: apiError.code, message: apiError.message };
        }
      },

      restore: async () => {
        if (get().pendingAction !== null) {
          return { ok: false, code: 'IN_PROGRESS', message: 'One moment…' };
        }
        set({ pendingAction: 'restore' });
        try {
          const result = await streakApi.restore({ idempotencyKey: uuid() });
          set({
            summary: result.streak,
            syncedAt: new Date().toISOString(),
            pendingAction: null,
          });
          // The wallet's balance is the server's answer, at once; the
          // ledger row follows on the sync.
          useCoinsStore.setState({ balance: result.balance });
          useCoinsStore.getState().hydrateFromServer();
          return { ok: true };
        } catch (error) {
          const apiError = toApiError(error);
          set({ pendingAction: null });
          // A refusal means the cached streak was behind the server's; the
          // next look should be at the server's.
          if (apiError.status !== null) {
            get().hydrateFromServer();
          }
          return { ok: false, code: apiError.code, message: apiError.message };
        }
      },

      reset: () =>
        set({
          ...EMPTY_STREAK,
          isSyncing: false,
          syncError: null,
          pendingAction: null,
        }),
    }),
    {
      name: 'vokve.streak',
      storage: createJSONStorage(() => mmkvStorage),
      // v2: the server's summary. A v1 store held the device's own day lists
      // — the placeholder streak — and is dropped.
      version: 2,
      migrate: () => EMPTY_STREAK,
      partialize: state => ({
        summary: state.summary,
        syncedAt: state.syncedAt,
      }),
    },
  ),
);

export const useStreakSummary = () => useStreakStore(s => s.summary);

/** The current run, or null before the first sync — never a made-up zero. */
export const useCurrentStreak = (): number | null =>
  useStreakStore(s => s.summary?.currentStreak ?? null);
