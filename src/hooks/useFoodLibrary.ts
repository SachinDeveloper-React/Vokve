import { useCallback, useEffect, useRef, useState } from 'react';
import { nutritionApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { FoodItem } from '../types/models';

/** Rows per page — the server's own ⚙ `nutrition.libraryPageSize`. */
export const FOOD_PAGE_SIZE = 20;

export interface FoodLibrary {
  /** Every row fetched so far, in the server's order. */
  items: FoodItem[];
  /** How many the whole query holds on the server; null before the first page. */
  total: number | null;
  /** The first page is in flight and there is nothing to show yet. */
  isLoading: boolean;
  isLoadingMore: boolean;
  /** Why the most recent request failed, or null. Cleared by the next success. */
  error: string | null;
  hasMore: boolean;
  /** Fetches the next page, if there is one and nothing is in flight. */
  loadMore: () => void;
  /** Asks again after a failure — the same page that did not arrive. */
  retry: () => void;
}

/**
 * The food library, a page at a time (`GET /foods/library`).
 *
 * Screen state rather than a store, for the reason the catalogue's is
 * (`useCatalogue`): a cursor only means something for the query it was issued
 * under, and a new term is a new list. An answer for a term the user has
 * already typed past is dropped, so "ban" then "banana" cannot leave the
 * banana list with the "ban" page appended to it.
 *
 * After a failed page it stops asking, so a list re-measuring its own footer
 * cannot hammer a dead network; only `retry` asks again.
 */
export function useFoodLibrary(query: string): FoodLibrary {
  const term = query.trim();
  const [items, setItems] = useState<FoodItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingFirst, setLoadingFirst] = useState(true);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestId = useRef(0);
  const inFlight = useRef(false);
  const latestTerm = useRef(term);
  latestTerm.current = term;

  const fetchPage = useCallback(async (cursor: string | null) => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    const id = (requestId.current += 1);
    const isFirst = cursor === null;
    if (isFirst) setLoadingFirst(true);
    else setLoadingMore(true);

    try {
      const page = await nutritionApi.foodLibrary({
        q: latestTerm.current.length > 0 ? latestTerm.current : undefined,
        cursor: cursor ?? undefined,
        limit: FOOD_PAGE_SIZE,
      });
      if (id !== requestId.current) {
        return;
      }
      setItems(current => (isFirst ? page.data : [...current, ...page.data]));
      setTotal(page.total);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (caught) {
      if (id !== requestId.current) {
        return;
      }
      setError(toApiError(caught).message);
    } finally {
      // A superseded request leaves the flags and the lock alone: they belong
      // to whichever request replaced it.
      if (id === requestId.current) {
        setLoadingFirst(false);
        setLoadingMore(false);
        inFlight.current = false;
      }
    }
  }, []);

  // A new term is a new list: drop what the old one fetched and start over.
  useEffect(() => {
    requestId.current += 1;
    inFlight.current = false;
    setItems([]);
    setTotal(null);
    setNextCursor(null);
    setError(null);
    setLoadingMore(false);
    fetchPage(null);
  }, [fetchPage, term]);

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

  const retry = useCallback(() => {
    setError(null);
    fetchPage(items.length > 0 ? nextCursor : null);
  }, [fetchPage, items.length, nextCursor]);

  return {
    items,
    total,
    isLoading: isLoadingFirst && items.length === 0,
    isLoadingMore,
    error,
    hasMore: nextCursor !== null,
    loadMore,
    retry,
  };
}
