import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShopItemsQuery } from '../services/api/contracts';
import { shopApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { ShopItem } from '../types/models';

/** Rows per page: two columns of cards, ten rows deep, before the next fetch. */
export const CATALOGUE_PAGE_SIZE = 20;

export interface Catalogue {
  /** Every row fetched so far, in the server's order. */
  items: ShopItem[];
  /** How many the whole query holds on the server; null before the first page. */
  total: number | null;
  /** The first page is in flight and there is nothing to show yet. */
  isLoading: boolean;
  /** The first page is in flight over rows already on screen. */
  isRefreshing: boolean;
  isLoadingMore: boolean;
  /** Why the most recent request failed, or null. Cleared by the next success. */
  error: string | null;
  hasMore: boolean;
  /** Fetches the next page, if there is one, nothing is in flight, and the last request did not fail. */
  loadMore: () => void;
  /** Asks again after a failure — the same page that did not arrive. */
  retry: () => void;
  /** Fetches the first page again and replaces everything. */
  refresh: () => void;
}

/** The query without its cursor — what identifies a list, as a stable string. */
function keyOf(query: ShopItemsQuery): string {
  const rest: Record<string, unknown> = { ...query };
  delete rest.cursor;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/**
 * A page of the catalogue — a category, the deals, a search — fetched from
 * the server and paged as the user scrolls. `enabled` false holds it empty
 * without a request, for a search screen whose field is still blank.
 *
 * Screen state rather than a store, for the same reasons the coin history
 * is: the cursor only means something for the query it was issued under,
 * and every screen that browses has its own query. A change to the query
 * starts a fresh list; a response for a query the user has already left is
 * dropped, so typing "sho" then "shorts" cannot leave the shorts list with
 * the "sho" page appended to it. After a failed page the end-reached hook
 * stops asking — a list re-measuring its footer would otherwise retry
 * against a dead network for as long as it was dead — and only `retry`
 * asks again.
 */
export function useCatalogue(query: ShopItemsQuery, enabled = true): Catalogue {
  const key = keyOf(query);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingFirst, setLoadingFirst] = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestId = useRef(0);
  const inFlight = useRef(false);
  // The latest query, read at fetch time so a page-2 request built from
  // stale closure state cannot carry a filter the user has changed since.
  const latest = useRef(query);
  latest.current = query;

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
      const page = await shopApi.items({
        ...latest.current,
        cursor: cursor ?? undefined,
        limit: CATALOGUE_PAGE_SIZE,
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
      // A superseded request leaves the flags and the lock alone: they
      // belong to whichever request replaced it.
      if (id === requestId.current) {
        setLoadingFirst(false);
        setLoadingMore(false);
        inFlight.current = false;
      }
    }
  }, []);

  // A new query is a new list: drop what the old one fetched and start over.
  // Disabled — a search screen with nothing typed — it stays empty and asks
  // for nothing; the first keystroke enables it.
  useEffect(() => {
    requestId.current += 1;
    inFlight.current = false;
    setItems([]);
    setTotal(null);
    setNextCursor(null);
    setError(null);
    setLoadingFirst(false);
    setLoadingMore(false);
    if (enabled) {
      fetchPage(null);
    }
  }, [enabled, fetchPage, key]);

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
    requestId.current += 1;
    inFlight.current = false;
    setLoadingMore(false);
    fetchPage(null);
  }, [fetchPage]);

  const retry = useCallback(() => {
    setError(null);
    if (nextCursor !== null && items.length > 0) {
      fetchPage(nextCursor);
      return;
    }
    refresh();
  }, [fetchPage, items.length, nextCursor, refresh]);

  return {
    items,
    total,
    isLoading: isLoadingFirst && items.length === 0,
    isRefreshing: isLoadingFirst && items.length > 0,
    isLoadingMore,
    error,
    hasMore: nextCursor !== null,
    loadMore,
    retry,
    refresh,
  };
}
