import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { seedCoinTransactions } from '../constants/seedData';
import type { CoinSource, CoinTransaction } from '../types/models';
import { mmkvStorage } from './index';

/**
 * How many ledger rows are kept on the device. The wallet shows a history, not
 * an archive: everything older lives on the server once the API exists, and an
 * unbounded array here would grow the persisted blob forever.
 */
const MAX_LEDGER_ENTRIES = 50;

/**
 * How long coins survive without the user earning any.
 *
 * The window resets on every credit rather than running from when each coin
 * was earned: a per-coin expiry would need the wallet to explain which slice
 * of a balance lapses when, and the rule the screen actually states — stay
 * active and nothing expires — is the one a user can act on.
 */
export const COIN_EXPIRY_WINDOW_DAYS = 90;

const MS_PER_DAY = 86_400_000;

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

interface CoinsState {
  balance: number;
  /** Every coin ever earned. Unaffected by spending. */
  lifetimeEarned: number;
  /** Newest first. Capped at `MAX_LEDGER_ENTRIES`. */
  transactions: CoinTransaction[];

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
    set => ({
      balance: balanceOf(seedCoinTransactions),
      lifetimeEarned: earnedOf(seedCoinTransactions),
      transactions: seedCoinTransactions,

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
          };
        });

        return spent;
      },

      reset: () =>
        set({
          balance: balanceOf(seedCoinTransactions),
          lifetimeEarned: earnedOf(seedCoinTransactions),
          transactions: seedCoinTransactions,
        }),
    }),
    {
      name: 'vokve.coins',
      storage: createJSONStorage(() => mmkvStorage),
      version: 1,
    },
  ),
);

export const useCoinBalance = () => useCoinsStore(s => s.balance);
export const useLifetimeEarned = () => useCoinsStore(s => s.lifetimeEarned);
export const useCoinTransactions = () => useCoinsStore(s => s.transactions);

/**
 * Whole days left before an idle wallet's coins lapse, clamped to the window.
 *
 * Counted from the newest credit, so a user who earned today always sees the
 * full window. A wallet that has never earned has nothing to expire and
 * reports the full window too, rather than a countdown against coins it does
 * not hold.
 */
function expiryDaysLeft(transactions: CoinTransaction[]): number {
  const newestCredit = transactions
    .filter(entry => entry.amount > 0)
    .map(entry => new Date(entry.createdAt).getTime())
    .filter(time => !Number.isNaN(time))
    .sort((a, b) => b - a)[0];

  if (newestCredit === undefined) {
    return COIN_EXPIRY_WINDOW_DAYS;
  }

  const daysIdle = Math.floor((Date.now() - newestCredit) / MS_PER_DAY);
  return Math.min(
    COIN_EXPIRY_WINDOW_DAYS,
    Math.max(0, COIN_EXPIRY_WINDOW_DAYS - daysIdle),
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
  const transactions = useCoinTransactions();
  return useMemo(() => summarizeMonth(transactions), [transactions]);
};

export const useCoinExpiryDaysLeft = (): number => {
  const transactions = useCoinTransactions();
  return useMemo(() => expiryDaysLeft(transactions), [transactions]);
};
