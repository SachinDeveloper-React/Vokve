import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from '../services/api/errors';
import { useLastStepSyncAt } from '../stores/stepsStore';

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  /** Why the last read failed, worded for the user; null after a success. */
  error: string | null;
  reload: () => void;
}

/**
 * The last answer to each question, for the moment a screen opens again:
 * it paints what it showed last time while it asks again, rather than a
 * spinner over a screen the user has seen a minute ago. Memory only, and
 * emptied on sign-out — the next account must not see this one's figures.
 */
const lastAnswers = new Map<string, unknown>();

export function clearServerReads(): void {
  lastAnswers.clear();
}

/**
 * Reads something from the server, again whenever `key` changes and
 * whenever a step sync lands — so a screen showing the server's figures
 * moves with the walk. Answers that arrive out of order are dropped: only
 * the newest request's answer is shown.
 *
 * `refreshOn` asks again whenever it changes, keeping the current answer on
 * screen meanwhile — for figures that follow something the user just did,
 * like the water stats after a drink.
 *
 * A null key skips the read.
 */
export function useServerRead<T>(
  key: string | null,
  read: () => Promise<T>,
  refreshOn?: unknown,
): Loaded<T> {
  const [data, setData] = useState<T | null>(() =>
    key === null ? null : (lastAnswers.get(key) as T | undefined) ?? null,
  );
  const [loading, setLoading] = useState(key !== null && data === null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const syncedAt = useLastStepSyncAt();
  const latest = useRef(0);
  const readRef = useRef(read);
  readRef.current = read;

  // A new key is a different question: its answer replaces the old one,
  // and the old one is not shown in the meantime.
  const shownKey = useRef<string | null>(
    key !== null && lastAnswers.has(key) ? key : null,
  );

  useEffect(() => {
    if (key === null) {
      setLoading(false);
      return;
    }
    const request = (latest.current += 1);
    if (shownKey.current !== key) {
      const remembered = lastAnswers.get(key) as T | undefined;
      setData(remembered ?? null);
      setLoading(remembered === undefined);
      shownKey.current = remembered === undefined ? null : key;
    }
    readRef
      .current()
      .then(result => {
        if (request !== latest.current) return;
        lastAnswers.set(key, result);
        shownKey.current = key;
        setData(result);
        setError(null);
      })
      .catch(failure => {
        if (request !== latest.current) return;
        setError(toApiError(failure).message);
      })
      .finally(() => {
        if (request === latest.current) setLoading(false);
      });
  }, [key, syncedAt, attempt, refreshOn]);

  const reload = useCallback(() => setAttempt(n => n + 1), []);
  return { data, loading, error, reload };
}
