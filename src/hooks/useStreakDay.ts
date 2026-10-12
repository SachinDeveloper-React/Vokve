import { useCallback, useEffect, useRef, useState } from 'react';
import { streakApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import { useServerRead, type Loaded } from './useServerRead';
import type { StreakDayDetail, StreakDayEvent } from '../types/models';

/**
 * Rows per page of a day's log. Smaller than the record's page: one day holds
 * a few dozen rows at most, and the cards above the list are what the screen
 * is really about — the first page only has to fill the fold.
 */
export const STREAK_DAY_EVENTS_PAGE_SIZE = 20;

/**
 * One day of the streak (`GET /streak/day`), keyed by the day so paging to
 * yesterday is a different question with its own answer — and so the answer
 * already in hand is painted again when the user comes back to it.
 */
export function useStreakDay(date: string): Loaded<StreakDayDetail> {
  const read = useCallback(() => streakApi.day(date), [date]);
  return useServerRead(`streak-day:${date}`, read);
}

export interface StreakDayEvents {
  /** Every row fetched so far, newest first. */
  events: StreakDayEvent[];
  /** The first page is in flight and there is nothing to show yet. */
  isLoading: boolean;
  /** A later page is in flight. */
  isLoadingMore: boolean;
  /** Why the most recent request failed, or null. Cleared by the next success. */
  error: string | null;
  /** The server has rows beyond the last one here. */
  hasMore: boolean;
  /** Rows the day holds in all. */
  total: number;
  /** Fetches the next page, if there is one and nothing is in flight. */
  loadMore: () => void;
  /** Fetches the first page again and replaces everything. */
  refresh: () => void;
}

/**
 * A day's log, paged from the server (`GET /streak/day/events`).
 *
 * Screen state rather than a store, for the reason the record's is: it is
 * read-only, and the cursor is an offset into one particular day, so keeping
 * it between visits would hand a cursor for Tuesday to a list showing
 * Wednesday.
 *
 * Every response is checked against a request counter before it is applied,
 * so paging to another day while a page is in flight cannot splice that day's
 * rows onto this one's list.
 */
export function useStreakDayEvents(date: string): StreakDayEvents {
  const [events, setEvents] = useState<StreakDayEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [isLoading, setLoading] = useState(true);
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
      if (isFirst) setLoading(true);
      else setLoadingMore(true);

      try {
        const page = await streakApi.dayEvents(
          date,
          cursor ?? undefined,
          STREAK_DAY_EVENTS_PAGE_SIZE,
        );
        if (id !== requestId.current) {
          return;
        }
        setEvents(current => (isFirst ? page.data : [...current, ...page.data]));
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
    },
    [date],
  );

  // Another day is another list: drop what this one fetched and start again.
  useEffect(() => {
    requestId.current += 1;
    inFlight.current = false;
    setEvents([]);
    setNextCursor(null);
    setTotal(0);
    setError(null);
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
    events,
    isLoading,
    isLoadingMore,
    error,
    hasMore: nextCursor !== null,
    total,
    loadMore,
    refresh,
  };
}
