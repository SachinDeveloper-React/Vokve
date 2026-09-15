import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoinDayGroup } from '../components/wallet/CoinDayGroupCard';
import { walletApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import { useCoinsStore } from '../stores/coinsStore';
import type { CoinSource, CoinTransaction } from '../types/models';
import { toIsoDate } from '../utils/date';
import { formatRelativeDay } from '../utils/format';

/**
 * Rows per page. Larger than the server's default of 20: a day of steps,
 * a workout and a streak bonus is three rows, so twenty is barely a week, and
 * a page that ends mid-scroll on the first flick reads as a stutter.
 */
export const COIN_HISTORY_PAGE_SIZE = 30;

export interface CoinHistory {
  /** Every row fetched so far, newest first. */
  transactions: CoinTransaction[];
  /** The first page is in flight and there is nothing to show yet. */
  isLoading: boolean;
  /** The first page is in flight over rows already on screen. */
  isRefreshing: boolean;
  /** A later page is in flight. */
  isLoadingMore: boolean;
  /** Why the most recent request failed, or null. Cleared by the next success. */
  error: string | null;
  /** The server has rows beyond the last one here. */
  hasMore: boolean;
  /**
   * Fetches the next page, if there is one, nothing is in flight, and the
   * last request did not fail. What the list's end-reached hook calls — and
   * why it stops after a failure: a list re-measures itself whenever its
   * footer changes, so an end-reached that retried on its own would ask the
   * server again the moment it said no, for as long as the network was down.
   */
  loadMore: () => void;
  /** Asks again after a failure — the same page that did not arrive. */
  retry: () => void;
  /** Fetches the first page again and replaces everything. */
  refresh: () => void;
}

/**
 * The full coin ledger, paged from the server, under one source filter.
 *
 * Screen state rather than a store: the history is read-only and the cursor
 * only means something for the filter it was issued under, so persisting it
 * would either hand a stale cursor to the wrong query or need a cache keyed
 * by every filter. The coin store keeps the newest fifty rows for the wallet;
 * this hook starts from that cache when unfiltered so the screen paints
 * before the network answers, and replaces it with the server's page.
 *
 * Every response is checked against a request counter before it is applied:
 * changing the filter while a page is in flight would otherwise splice steps
 * rows into a purchases list.
 */
export function useCoinHistory(source: CoinSource | null): CoinHistory {
  // Read once rather than subscribed: the cache is a starting point, and a
  // wallet sync landing mid-scroll must not replace the pages fetched here.
  const [transactions, setTransactions] = useState<CoinTransaction[]>(() =>
    source === null ? useCoinsStore.getState().transactions : [],
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingFirst, setLoadingFirst] = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestId = useRef(0);
  const inFlight = useRef(false);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      const id = (requestId.current += 1);
      const isFirst = cursor === null;
      if (isFirst) setLoadingFirst(true);
      else setLoadingMore(true);

      try {
        const page = await walletApi.transactions({
          cursor: cursor ?? undefined,
          limit: COIN_HISTORY_PAGE_SIZE,
          source: source ?? undefined,
        });
        if (id !== requestId.current) {
          return;
        }
        setTransactions(current =>
          isFirst ? page.data : [...current, ...page.data],
        );
        setNextCursor(page.nextCursor);
        setError(null);
      } catch (caught) {
        if (id !== requestId.current) {
          return;
        }
        setError(toApiError(caught).message);
      } finally {
        // A superseded request leaves the flags and the lock alone: they
        // belong to whichever request replaced it.
        if (id === requestId.current) {
          setLoadingFirst(false);
          setLoadingMore(false);
          inFlight.current = false;
        }
      }
    },
    [source],
  );

  // A new filter is a new list: drop what the old one fetched — seeding again
  // from the cache when the filter is off — and start from the top.
  useEffect(() => {
    requestId.current += 1;
    inFlight.current = false;
    setTransactions(
      source === null ? useCoinsStore.getState().transactions : [],
    );
    setNextCursor(null);
    setError(null);
    fetchPage(null);
  }, [fetchPage, source]);

  const loadMore = useCallback(() => {
    if (
      nextCursor === null ||
      error !== null ||
      isLoadingFirst ||
      isLoadingMore
    ) {
      return;
    }
    fetchPage(nextCursor);
  }, [error, fetchPage, isLoadingFirst, isLoadingMore, nextCursor]);

  const refresh = useCallback(() => {
    // A refresh outranks a page in flight: the counter bump makes the older
    // response a no-op, and the lock is released so the new request can go.
    requestId.current += 1;
    inFlight.current = false;
    setLoadingMore(false);
    fetchPage(null);
  }, [fetchPage]);

  // Which page failed is what the cursor says: a cursor means a later page
  // did not arrive, none means the first did not — or that only the cache
  // is showing, which the same first-page fetch puts right.
  const retry = useCallback(() => {
    setError(null);
    if (nextCursor !== null && transactions.length > 0) {
      fetchPage(nextCursor);
      return;
    }
    refresh();
  }, [fetchPage, nextCursor, refresh, transactions.length]);

  return {
    transactions,
    isLoading: isLoadingFirst && transactions.length === 0,
    isRefreshing: isLoadingFirst && transactions.length > 0,
    isLoadingMore,
    error,
    hasMore: nextCursor !== null,
    loadMore,
    retry,
    refresh,
  };
}

/**
 * Splits a newest-first ledger into day sections, in the order the rows came.
 *
 * Trusts the server's order rather than sorting: the ledger is paged by id,
 * and a sort here would reorder rows across pages the server had already
 * placed. Rows with an unreadable timestamp are dropped — a heading of "" is
 * worse than a missing row, and the server never sends one.
 */
export function groupCoinTransactionsByDay(
  transactions: CoinTransaction[],
): CoinDayGroup[] {
  const groups: CoinDayGroup[] = [];
  const byDate = new Map<string, CoinDayGroup>();

  for (const entry of transactions) {
    const at = new Date(entry.createdAt);
    if (Number.isNaN(at.getTime())) {
      continue;
    }

    const date = toIsoDate(at);
    let group = byDate.get(date);
    if (group === undefined) {
      group = {
        date,
        title: formatRelativeDay(entry.createdAt),
        transactions: [],
        net: 0,
      };
      byDate.set(date, group);
      groups.push(group);
    }

    group.transactions.push(entry);
    group.net += entry.amount;
  }

  return groups;
}
