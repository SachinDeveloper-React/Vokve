import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { walletApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import { logger } from '../utils/logger';
import type { CoinTransaction, EarnRule } from '../types/models';
import { mmkvStorage } from './index';

/**
 * How many ledger rows are kept on the device. The wallet shows a history, not
 * an archive: everything older lives on the server, and an unbounded array
 * here would grow the persisted blob forever.
 */
const MAX_LEDGER_ENTRIES = 50;

/**
 * How old a synced wallet may be before opening the screen fetches it again.
 *
 * Coins move when the server verifies steps or pays a workout, neither of
 * which the app sees happen — so a tab that only refreshed on sign-in would
 * show yesterday's balance all day. A minute is short enough that the figure
 * is current whenever the user looks and long enough that flicking between
 * tabs does not fire a request each time.
 */
export const WALLET_STALE_AFTER_MS = 60_000;

export interface MonthlyCoinSummary {
  /** Coins credited this calendar month. */
  earned: number;
  /** Coins spent this calendar month, as a positive figure. */
  spent: number;
  /** What the month left behind — earned minus spent, and so signed. */
  net: number;
}

interface CoinsState {
  balance: number;
  /** Step coins the server is holding pending verification. Not spendable. */
  pending: number;
  /** Every coin ever earned. Unaffected by spending. */
  lifetimeEarned: number;
  /** Newest first. Capped at `MAX_LEDGER_ENTRIES`. */
  transactions: CoinTransaction[];
  /** The hard per-day ceiling and where today stands against it (RULES E8). */
  dailyCap: number;
  earnedToday: number;
  remainingToday: number;
  /**
   * The server's own month figures and expiry countdown (RULES E12, BACKEND.md
   * §5 Wallet). Null until the first sync. Never worked out on the device:
   * the ledger here is only the newest fifty rows.
   */
  monthSummary: MonthlyCoinSummary | null;
  expiryDaysLeft: number | null;
  /** ISO-8601 moment the coins lapse; null when there is nothing to expire, or before a sync. */
  expiresAt: string | null;
  /** The window and warn thresholds in force on the server; null before a sync. */
  expiryWindowDays: number | null;
  expiryWarnDays: number[] | null;
  /**
   * The rate card, as the server serves it (RULES E14) — never written into
   * the app, because the rates are config the owner can change. Null until
   * the first sync.
   */
  earnRules: EarnRule[] | null;
  /** The price from which a redemption asks for a code first (RULES O8); null before a sync. */
  stepUpThreshold: number | null;
  /**
   * When the server last confirmed these figures; null until it first has.
   * Until then every figure above is a placeholder, and the wallet says it
   * is loading rather than showing them.
   */
  syncedAt: string | null;
  isSyncing: boolean;
  /**
   * Why the last sync failed, for the screen to say so. Cleared by the next
   * one that succeeds; the cached figures stand in the meantime.
   */
  syncError: string | null;

  /**
   * Replaces the figures with the server's. The server is the ledger
   * (BACKEND.md §8) and this store is its cache: coins are only ever minted
   * there (RULES E6), so nothing on the device adds to a balance.
   *
   * Resolves either way: a failed sync is recorded on `syncError`, not thrown,
   * because every caller — sign-in, a pull-to-refresh — has the same answer
   * to it, which is to keep showing what it has.
   */
  hydrateFromServer: () => Promise<void>;
  /**
   * `hydrateFromServer`, unless the figures are newer than
   * `WALLET_STALE_AFTER_MS` or a sync is already in flight. What the wallet
   * calls when it comes into view.
   */
  refreshIfStale: () => Promise<void>;

  reset: () => void;
}

/** Every figure before the first sync: nothing claimed, nothing to show. */
const EMPTY_WALLET = {
  balance: 0,
  pending: 0,
  lifetimeEarned: 0,
  transactions: [] as CoinTransaction[],
  dailyCap: 0,
  earnedToday: 0,
  remainingToday: 0,
  monthSummary: null,
  expiryDaysLeft: null,
  expiresAt: null,
  expiryWindowDays: null,
  expiryWarnDays: null,
  earnRules: null,
  stepUpThreshold: null,
  syncedAt: null,
} satisfies Partial<CoinsState>;

/**
 * The coin wallet.
 *
 * Balance and lifetime total are stored as numbers rather than recomputed from
 * the ledger on every read, because the ledger is trimmed: once the oldest
 * rows are dropped, the surviving ones no longer add up to what the user
 * actually holds. Every sync writes all three together, so they cannot drift
 * apart — and nothing on the device writes them otherwise: coins are minted
 * and spent on the server (RULES E6, D1), which answers with the balance.
 */
export const useCoinsStore = create<CoinsState>()(
  persist(
    (set, get) => ({
      ...EMPTY_WALLET,
      isSyncing: false,
      syncError: null,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true });
        try {
          const [wallet, page, earnRules] = await Promise.all([
            walletApi.get(),
            walletApi.transactions({ limit: MAX_LEDGER_ENTRIES }),
            walletApi.earnRules(),
          ]);
          set({
            balance: wallet.balance,
            pending: wallet.pending,
            lifetimeEarned: wallet.lifetimeEarned,
            transactions: page.data.slice(0, MAX_LEDGER_ENTRIES),
            dailyCap: wallet.dailyCap,
            earnedToday: wallet.earnedToday,
            remainingToday: wallet.remainingToday,
            monthSummary: wallet.monthSummary,
            expiryDaysLeft: wallet.expiryDaysLeft,
            expiresAt: wallet.expiresAt,
            expiryWindowDays: wallet.expiryWindowDays,
            expiryWarnDays: wallet.expiryWarnDays,
            earnRules,
            stepUpThreshold: wallet.stepUpThreshold,
            syncedAt: new Date().toISOString(),
            isSyncing: false,
            syncError: null,
          });
        } catch (error) {
          // Offline or not signed in: the cached figures stand until the next sync.
          const apiError = toApiError(error);
          logger.warn('coinsStore', 'Wallet sync failed', apiError);
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
        if (age < WALLET_STALE_AFTER_MS) {
          return;
        }
        await hydrateFromServer();
      },

      reset: () => set({ ...EMPTY_WALLET, isSyncing: false, syncError: null }),
    }),
    {
      name: 'vokve.coins',
      storage: createJSONStorage(() => mmkvStorage),
      // v3: the placeholder wallet is gone. A stored wallet that never synced
      // was that placeholder, and is dropped; a synced one is the server's.
      version: 3,
      migrate: persisted => {
        const stored = persisted as Partial<CoinsState> | null;
        return stored?.syncedAt ? stored : EMPTY_WALLET;
      },
      partialize: state => ({
        balance: state.balance,
        pending: state.pending,
        lifetimeEarned: state.lifetimeEarned,
        transactions: state.transactions,
        dailyCap: state.dailyCap,
        earnedToday: state.earnedToday,
        remainingToday: state.remainingToday,
        monthSummary: state.monthSummary,
        expiryDaysLeft: state.expiryDaysLeft,
        expiresAt: state.expiresAt,
        expiryWindowDays: state.expiryWindowDays,
        expiryWarnDays: state.expiryWarnDays,
        earnRules: state.earnRules,
        stepUpThreshold: state.stepUpThreshold,
        syncedAt: state.syncedAt,
      }),
    },
  ),
);

export const useCoinBalance = () => useCoinsStore(s => s.balance);
export const usePendingCoins = () => useCoinsStore(s => s.pending);
export const useDailyCoinCap = () => useCoinsStore(s => s.dailyCap);
export const useCoinsEarnedToday = () => useCoinsStore(s => s.earnedToday);
export const useCoinsRemainingToday = () =>
  useCoinsStore(s => s.remainingToday);
export const useLifetimeEarned = () => useCoinsStore(s => s.lifetimeEarned);
export const useCoinTransactions = () => useCoinsStore(s => s.transactions);
export const useEarnRules = () => useCoinsStore(s => s.earnRules);
export const useStepUpThreshold = () => useCoinsStore(s => s.stepUpThreshold);
export const useWalletSyncedAt = () => useCoinsStore(s => s.syncedAt);
export const useIsWalletSyncing = () => useCoinsStore(s => s.isSyncing);
export const useWalletSyncError = () => useCoinsStore(s => s.syncError);

/**
 * How loudly the countdown should speak. `'soon'` from the outer warn
 * threshold, `'urgent'` from the inner one — the same days the server sends
 * its reminders on (RULES E10), so the panel and the push agree.
 */
export type CoinExpiryUrgency = 'safe' | 'soon' | 'urgent';

export interface CoinExpiry {
  daysLeft: number;
  /** ISO-8601, or null when there is nothing to expire. */
  expiresAt: string | null;
  windowDays: number;
  warnDays: readonly number[];
  urgency: CoinExpiryUrgency;
}

function urgencyOf(
  daysLeft: number,
  warnDays: readonly number[],
  hasCoins: boolean,
): CoinExpiryUrgency {
  if (!hasCoins || warnDays.length === 0) {
    return 'safe';
  }
  if (daysLeft <= Math.min(...warnDays)) {
    return 'urgent';
  }
  if (daysLeft <= Math.max(...warnDays)) {
    return 'soon';
  }
  return 'safe';
}

const NO_MONTH: MonthlyCoinSummary = { earned: 0, spent: 0, net: 0 };
const NO_WARN_DAYS: readonly number[] = [];

/** The server's figures for this calendar month (RULES E12); zeros before a sync. */
export const useMonthlyCoinSummary = (): MonthlyCoinSummary =>
  useCoinsStore(s => s.monthSummary) ?? NO_MONTH;

/**
 * Everything the expiry panel and its explainer say, from one place — the
 * server's countdown, window and warn days (RULES E9–E11). Before the first
 * sync there is nothing to count down, and the wallet does not draw it.
 *
 * Derived through `useMemo` rather than inside the zustand selector: a
 * selector that built a fresh object on every call would never compare
 * equal to the last one, and the subscriber would re-render forever.
 */
export const useCoinExpiry = (): CoinExpiry => {
  const balance = useCoinBalance();
  const daysLeft = useCoinsStore(s => s.expiryDaysLeft);
  const expiresAt = useCoinsStore(s => s.expiresAt);
  const windowDays = useCoinsStore(s => s.expiryWindowDays);
  const warnDays = useCoinsStore(s => s.expiryWarnDays) ?? NO_WARN_DAYS;

  return useMemo(() => {
    const days = daysLeft ?? windowDays ?? 0;
    return {
      daysLeft: days,
      expiresAt,
      windowDays: windowDays ?? 0,
      warnDays,
      urgency: urgencyOf(days, warnDays, balance > 0),
    };
  }, [balance, daysLeft, expiresAt, warnDays, windowDays]);
};

export const useCoinExpiryDaysLeft = (): number => useCoinExpiry().daysLeft;
