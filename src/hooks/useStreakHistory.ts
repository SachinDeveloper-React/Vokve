import { useCallback, useEffect, useRef, useState } from 'react';
import { streakApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { StreakHistoryDay } from '../types/models';

/**
 * Days per page. A month at a time: the history is read against a calendar
 * the user has just scrolled, and a page that ended mid-month would make
 * them fetch again to finish reading one.
 */
export const STREAK_HISTORY_PAGE_SIZE = 31;

export interface StreakHistory {
  /** Every day fetched so far, newest first. */
  days: StreakHistoryDay[];
  /** The first page is in flight and there is nothing to show yet. */
  isLoading: boolean;
  /** A later page is in flight. */
  isLoadingMore: boolean;
  /** Why the most recent request failed, or null. Cleared by the next success. */
  error: string | null;
  /** The server has days beyond the last one here. */
  hasMore: boolean;
  /** Days on record from the first that ever counted to today. */
  total: number;
  /** Fetches the next page, if there is one and nothing is in flight. */
  loadMore: () => void;
  /** Fetches the first page again and replaces everything. */
  refresh: () => void;
}

/**
 * The streak's record, paged from the server (`GET /streak/history`).
 *
 * Screen state rather than a store: it is read-only, and a cursor only means
 * anything until the next day is earned, so keeping it between visits would
 * hand a stale one back to a list that had already moved on.
 *
 * Every response is checked against a request counter before it is applied,
 * so a refresh landing while a later page is in flight cannot splice the
 * older answer onto the newer list.
 */
export function useStreakHistory(): StreakHistory {
  const [days, setDays] = useState<StreakHistoryDay[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [isLoading, setLoading] = useState(true);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestId = useRef(0);
  const inFlight = useRef(false);

  const fetchPage = useCallback(async (cursor: string | null) => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    const id = (requestId.current += 1);
    const isFirst = cursor === null;
    if (isFirst) setLoading(true);
    else setLoadingMore(true);

    try {
      const page = await streakApi.history(
        cursor ?? undefined,
        STREAK_HISTORY_PAGE_SIZE,
      );
      if (id !== requestId.current) {
        return;
      }
      setDays(current => (isFirst ? page.data : [...current, ...page.data]));
      setNextCursor(page.nextCursor);
      setTotal(page.total);
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
        setLoading(false);
        setLoadingMore(false);
        inFlight.current = false;
      }
    }
  }, []);

  useEffect(() => {
    fetchPage(null);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (nextCursor === null || error !== null || isLoading || isLoadingMore) {
      return;
    }
    fetchPage(nextCursor);
  }, [error, fetchPage, isLoading, isLoadingMore, nextCursor]);

  const refresh = useCallback(() => {
    // A refresh outranks a page in flight: the counter bump makes the older
    // response a no-op, and the lock is released so the new request can go.
    requestId.current += 1;
    inFlight.current = false;
    setLoadingMore(false);
    fetchPage(null);
  }, [fetchPage]);

  return {
    days,
    isLoading,
    isLoadingMore,
    error,
    hasMore: nextCursor !== null,
    total,
    loadMore,
    refresh,
  };
}
