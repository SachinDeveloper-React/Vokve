import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { seedCoinTransactions } from '../constants/seedData';
import { walletApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import { logger } from '../utils/logger';
import type { CoinSource, CoinTransaction } from '../types/models';
import { mmkvStorage } from './index';

/**
 * How many ledger rows are kept on the device. The wallet shows a history, not
 * an archive: everything older lives on the server once the API exists, and an
 * unbounded array here would grow the persisted blob forever.
 */
const MAX_LEDGER_ENTRIES = 50;

/**
 * How long coins survive without the user earning any (RULES E9).
 *
 * The window resets on every credit rather than running from when each coin
 * was earned: a per-coin expiry would need the wallet to explain which slice
 * of a balance lapses when, and the rule the screen actually states — stay
 * active and nothing expires — is the one a user can act on.
 *
 * The server's `expiryWindowDays` is the figure in force; this is only what
 * the seeded, never-synced wallet counts against.
 */
export const COIN_EXPIRY_WINDOW_DAYS = 90;

/** Days-before-expiry at which the wallet raises its voice (RULES E10), until the server says otherwise. */
export const COIN_EXPIRY_WARN_DAYS: readonly number[] = [14, 3];

const MS_PER_DAY = 86_400_000;

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

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Coins in hand: every movement in the ledger, added up. */
function balanceOf(transactions: CoinTransaction[]): number {
  return transactions.reduce((sum, entry) => sum + entry.amount, 0);
}

/** Only the credits — spending must not reduce a lifetime total. */
function earnedOf(transactions: CoinTransaction[]): number {
  return transactions.reduce(
    (sum, entry) => (entry.amount > 0 ? sum + entry.amount : sum),
    0,
  );
}

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
   * §5 Wallet). Null until the first sync, when the hooks below fall back to
   * working them out from the ledger on the device — which is right for the
   * seeded wallet and wrong for a real one, whose ledger here is only the
   * newest fifty rows.
   */
  monthSummary: MonthlyCoinSummary | null;
  expiryDaysLeft: number | null;
  /** ISO-8601 moment the coins lapse; null when there is nothing to expire, or before a sync. */
  expiresAt: string | null;
  /** The window and warn thresholds in force on the server; null before a sync. */
  expiryWindowDays: number | null;
  expiryWarnDays: number[] | null;
  /** When the server last confirmed these figures; null while still seeded. */
  syncedAt: string | null;
  isSyncing: boolean;
  /**
   * Why the last sync failed, for the screen to say so. Cleared by the next
   * one that succeeds; the cached figures stand in the meantime.
   */
  syncError: string | null;

  /**
   * Replaces the seeded figures with the server's. The server is the ledger
   * (BACKEND.md §8); this store is its cache, and `earn`/`spend` below only
   * keep the screens responsive between syncs.
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

  earn: (amount: number, title: string, source?: CoinSource) => void;
  /**
   * Spends coins if there are enough, and reports whether it happened. The
   * caller needs the answer to tell the user why nothing changed, so this
   * returns a boolean rather than throwing on the ordinary "not enough coins"
   * case.
   */
  spend: (amount: number, title: string, source?: CoinSource) => boolean;
  reset: () => void;
}

/**
 * The coin wallet.
 *
 * Balance and lifetime total are stored as numbers rather than recomputed from
 * the ledger on every read, because the ledger is trimmed: once the oldest
 * rows are dropped, the surviving ones no longer add up to what the user
 * actually holds. Every mutation writes all three together, so they cannot
 * drift apart.
 */
export const useCoinsStore = create<CoinsState>()(
  persist(
    (set, get) => ({
      balance: balanceOf(seedCoinTransactions),
      pending: 0,
      lifetimeEarned: earnedOf(seedCoinTransactions),
      transactions: seedCoinTransactions,
      dailyCap: 300,
      earnedToday: 0,
      remainingToday: 300,
      monthSummary: null,
      expiryDaysLeft: null,
      expiresAt: null,
      expiryWindowDays: null,
      expiryWarnDays: null,
      syncedAt: null,
      isSyncing: false,
      syncError: null,

      hydrateFromServer: async () => {
        if (get().isSyncing) {
          return;
        }
        set({ isSyncing: true });
        try {
          const [wallet, page] = await Promise.all([
            walletApi.get(),
            walletApi.transactions({ limit: MAX_LEDGER_ENTRIES }),
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

      earn: (amount, title, source = 'challenge') =>
        set(state => {
          const credit = Math.max(0, Math.round(amount));
          if (credit === 0) {
            return state;
          }

          const entry: CoinTransaction = {
            id: createId(),
            title,
            source,
            amount: credit,
            createdAt: new Date().toISOString(),
          };

          return {
            balance: state.balance + credit,
            lifetimeEarned: state.lifetimeEarned + credit,
            transactions: [entry, ...state.transactions].slice(
              0,
              MAX_LEDGER_ENTRIES,
            ),
            // The month figures are the server's; a local credit moves them
            // too, or the summary would lag the ledger it sits under.
            monthSummary: state.monthSummary && {
              earned: state.monthSummary.earned + credit,
              spent: state.monthSummary.spent,
              net: state.monthSummary.net + credit,
            },
          };
        }),

      spend: (amount, title, source = 'purchase') => {
        const debit = Math.max(0, Math.round(amount));
        let spent = false;

        set(state => {
          if (debit === 0 || debit > state.balance) {
            return state;
          }
          spent = true;

          const entry: CoinTransaction = {
            id: createId(),
            title,
            source,
            amount: -debit,
            createdAt: new Date().toISOString(),
          };

          return {
            balance: state.balance - debit,
            transactions: [entry, ...state.transactions].slice(
              0,
              MAX_LEDGER_ENTRIES,
            ),
            monthSummary: state.monthSummary && {
              earned: state.monthSummary.earned,
              spent: state.monthSummary.spent + debit,
              net: state.monthSummary.net - debit,
            },
          };
        });

        return spent;
      },

      reset: () =>
        set({
          balance: balanceOf(seedCoinTransactions),
          pending: 0,
          lifetimeEarned: earnedOf(seedCoinTransactions),
          transactions: seedCoinTransactions,
          dailyCap: 300,
          earnedToday: 0,
          remainingToday: 300,
          monthSummary: null,
          expiryDaysLeft: null,
          expiresAt: null,
          expiryWindowDays: null,
          expiryWarnDays: null,
          syncedAt: null,
          isSyncing: false,
          syncError: null,
        }),
    }),
    {
      name: 'vokve.coins',
      storage: createJSONStorage(() => mmkvStorage),
      version: 2,
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
export const useWalletSyncedAt = () => useCoinsStore(s => s.syncedAt);
export const useIsWalletSyncing = () => useCoinsStore(s => s.isSyncing);
export const useWalletSyncError = () => useCoinsStore(s => s.syncError);

/**
 * When the newest credit was made, from the ledger on the device — the seeded
 * wallet's stand-in for the server's `lastCreditAt`.
 */
function newestCreditAt(transactions: CoinTransaction[]): number | undefined {
  return transactions
    .filter(entry => entry.amount > 0)
    .map(entry => new Date(entry.createdAt).getTime())
    .filter(time => !Number.isNaN(time))
    .sort((a, b) => b - a)[0];
}

/**
 * Whole days left before an idle wallet's coins lapse, clamped to the window.
 *
 * Counted from the newest credit, so a user who earned today always sees the
 * full window. A wallet that has never earned has nothing to expire and
 * reports the full window too, rather than a countdown against coins it does
 * not hold.
 */
function expiryDaysLeft(transactions: CoinTransaction[]): number {
  const newestCredit = newestCreditAt(transactions);
  if (newestCredit === undefined) {
    return COIN_EXPIRY_WINDOW_DAYS;
  }

  const daysIdle = Math.floor((Date.now() - newestCredit) / MS_PER_DAY);
  return Math.min(
    COIN_EXPIRY_WINDOW_DAYS,
    Math.max(0, COIN_EXPIRY_WINDOW_DAYS - daysIdle),
  );
}

/** The moment the seeded wallet's coins would lapse, or null with nothing to lapse. */
function expiryMoment(transactions: CoinTransaction[]): string | null {
  const newestCredit = newestCreditAt(transactions);
  if (newestCredit === undefined || balanceOf(transactions) <= 0) {
    return null;
  }
  return new Date(
    newestCredit + COIN_EXPIRY_WINDOW_DAYS * MS_PER_DAY,
  ).toISOString();
}

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

/**
 * The current calendar month's movements, added up.
 *
 * Calendar month rather than a rolling 30 days: the figure is labelled "this
 * month" on screen, and a user checking it against their own sense of the
 * month would find a rolling window quietly disagreeing with them.
 */
function summarizeMonth(transactions: CoinTransaction[]): MonthlyCoinSummary {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  let earned = 0;
  let spent = 0;

  for (const entry of transactions) {
    const at = new Date(entry.createdAt);
    if (
      Number.isNaN(at.getTime()) ||
      at.getMonth() !== month ||
      at.getFullYear() !== year
    ) {
      continue;
    }

    if (entry.amount > 0) {
      earned += entry.amount;
    } else {
      spent += -entry.amount;
    }
  }

  return { earned, spent, net: earned - spent };
}

/**
 * Derived through `useMemo` over the ledger rather than inside the zustand
 * selector: a selector that built a fresh object on every call would never
 * compare equal to the last one, and the subscriber would re-render forever.
 */
export const useMonthlyCoinSummary = (): MonthlyCoinSummary => {
  const fromServer = useCoinsStore(s => s.monthSummary);
  const transactions = useCoinTransactions();
  return useMemo(
    () => fromServer ?? summarizeMonth(transactions),
    [fromServer, transactions],
  );
};

/**
 * Everything the expiry panel and its explainer say, from one place: the
 * server's figures once synced, the ledger's own arithmetic before.
 */
export const useCoinExpiry = (): CoinExpiry => {
  const balance = useCoinBalance();
  const transactions = useCoinTransactions();
  const synced = useCoinsStore(s => s.syncedAt !== null);
  const serverDaysLeft = useCoinsStore(s => s.expiryDaysLeft);
  const serverExpiresAt = useCoinsStore(s => s.expiresAt);
  const serverWindow = useCoinsStore(s => s.expiryWindowDays);
  const serverWarn = useCoinsStore(s => s.expiryWarnDays);

  return useMemo(() => {
    const daysLeft = serverDaysLeft ?? expiryDaysLeft(transactions);
    const expiresAt = synced ? serverExpiresAt : expiryMoment(transactions);
    const warnDays = serverWarn ?? COIN_EXPIRY_WARN_DAYS;
    return {
      daysLeft,
      expiresAt,
      windowDays: serverWindow ?? COIN_EXPIRY_WINDOW_DAYS,
      warnDays,
      urgency: urgencyOf(daysLeft, warnDays, balance > 0),
    };
  }, [
    balance,
    serverDaysLeft,
    serverExpiresAt,
    serverWarn,
    serverWindow,
    synced,
    transactions,
  ]);
};

export const useCoinExpiryDaysLeft = (): number => useCoinExpiry().daysLeft;
