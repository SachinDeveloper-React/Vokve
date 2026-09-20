import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewSort } from '../services/api/contracts';
import { shopApi } from '../services/api/endpoints';
import { toApiError } from '../services/api/errors';
import type { Review, ReviewSummary } from '../types/models';

export const REVIEWS_PAGE_SIZE = 10;

export interface Reviews {
  reviews: Review[];
  /** The stars, the count and the histogram; null before the first page. */
  summary: ReviewSummary | null;
  /** The reader's own review, if they have written one. */
  mine: Review | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
  refresh: () => void;
}

/**
 * An item's reviews, paged, with the summary that heads them (RULES R15).
 * The same shape as the catalogue hook — a changed sort starts over, a
 * late answer for the old sort is dropped, a failed page waits for an
 * explicit retry — for the same reasons.
 */
export function useReviews(
  itemId: string,
  sort: ReviewSort = 'recent',
  limit = REVIEWS_PAGE_SIZE,
): Reviews {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [mine, setMine] = useState<Review | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const id = (requestId.current += 1);
      const isFirst = cursor === null;
      if (isFirst) setLoading(true);
      else setLoadingMore(true);
      try {
        const page = await shopApi.reviews(itemId, {
          sort,
          cursor: cursor ?? undefined,
          limit,
        });
        if (id !== requestId.current) return;
        setReviews(current =>
          isFirst ? page.data : [...current, ...page.data],
        );
        setSummary(page.summary);
        setMine(page.mine);
        setNextCursor(page.nextCursor);
        setError(null);
      } catch (caught) {
        if (id !== requestId.current) return;
        setError(toApiError(caught).message);
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [itemId, limit, sort],
  );

  useEffect(() => {
    requestId.current += 1;
    setReviews([]);
    setNextCursor(null);
    setError(null);
    fetchPage(null);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (nextCursor === null || error !== null || isLoading || isLoadingMore)
      return;
    fetchPage(nextCursor);
  }, [error, fetchPage, isLoading, isLoadingMore, nextCursor]);

  const refresh = useCallback(() => fetchPage(null), [fetchPage]);
  const retry = useCallback(() => {
    setError(null);
    if (nextCursor !== null && reviews.length > 0) fetchPage(nextCursor);
    else fetchPage(null);
  }, [fetchPage, nextCursor, reviews.length]);

  return {
    reviews,
    summary,
    mine,
    isLoading,
    isLoadingMore,
    error,
    hasMore: nextCursor !== null,
    loadMore,
    retry,
    refresh,
  };
}
