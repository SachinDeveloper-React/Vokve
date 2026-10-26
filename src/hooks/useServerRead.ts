import { useCallback, useEffect, useRef, useState } from 'react';
import { config } from '../constants/config';
import { toApiError } from '../services/api/errors';
import { mmkvStorage } from '../stores';
import { useLastStepSyncAt } from '../stores/stepsStore';
import { logger } from '../utils/logger';

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  /** Why the last read failed, worded for the user; null after a success. */
  error: string | null;
  /**
   * When what is on screen was fetched, ISO. Null while nothing has been
   * read yet. A screen showing figures offline has to be able to say how old
   * they are: "2,431 steps" with no date on it is a lie the moment the phone
   * loses the network.
   */
  cachedAt: string | null;
  /**
   * The data on screen came out of storage and this session has not managed
   * to refresh it. Not the same as `error`: a screen can be showing perfectly
   * usable figures from an hour ago *and* have a failed read behind them,
   * which is exactly the offline case.
   */
  isStale: boolean;
  reload: () => void;
}

/** One answer, with when it arrived. */
interface Entry {
  at: string;
  data: unknown;
}

const STORAGE_KEY = 'vokve.reads';

/**
 * The shape of the answers kept on disk.
 *
 * Stored with the blob and checked on the way in: an answer written by a
 * different build is **dropped rather than handed back**. A cache is the one
 * place in the app where yesterday's contract can reach today's code — the
 * schemas are parsed on the way *in*, so a field added to a response gets
 * its default on a fresh read and is simply *absent* from an answer written
 * before it existed. A screen that renders that field then crashes on a
 * payload nothing validated (`WeeklyResultsCard` did, on `perks.length`).
 *
 * The app's own version is the honest key for it: a contract change ships
 * with a build, so answers written by an earlier one are from an earlier
 * contract. The cost is one launch of spinners after an update, which is
 * what a different contract deserves. `SHAPE` is bumped by hand for the
 * other case — a contract that changed while the version did not, which is
 * every day in development.
 */
const SHAPE = 1;
const VERSION = `${config.appVersion}.${SHAPE}`;

interface Stored {
  version: string;
  answers: Record<string, Entry>;
}

/**
 * Answers kept past the end of the process, so the app opens on figures
 * rather than on "Couldn't load" (D-80).
 *
 * This used to be a plain in-memory `Map`, which covered the case it was
 * built for — a screen reopened a minute later paints what it showed last
 * time instead of a spinner — and nothing else. On a cold start it was
 * empty, so an app opened with no network had no figures at all for every
 * screen whose content is a server read: eleven of them, including the step
 * history, the health score and the leaderboard. The steps were on the
 * phone the whole time; the only reason they could not be shown is that the
 * answer about them had been thrown away on exit.
 *
 * So the map is backed by MMKV. In memory it is still the hot layer and
 * nothing reads storage twice; the write back is debounced, because several
 * screens' reads land in the same frame and each one would otherwise
 * serialise the lot.
 *
 * Bounded two ways, because this is a cache and not a database: the newest
 * `MAX_ENTRIES` answers are kept, and an entry whose JSON is bigger than
 * `MAX_ENTRY_BYTES` is held in memory for the session but never written —
 * a month of daily activity is worth showing again, not worth carrying
 * around for a week.
 */
const MAX_ENTRIES = 60;
const MAX_ENTRY_BYTES = 64 * 1024;
const WRITE_DEBOUNCE_MS = 400;

/** Null until the first read; loaded from storage once, then authoritative. */
let answers: Map<string, Entry> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The stored blob as entries — or nothing, which is every answer to the
 * question "can this be trusted?" except yes.
 *
 * Pulled out and exported because it is the whole of the version rule and
 * the only part of this cache that can be asked about without a renderer: a
 * blob from another build, the unversioned one an older build wrote, half a
 * write, or a value somebody edited by hand all have to read as an empty
 * cache rather than as a payload.
 */
export function entriesFromStored(
  raw: string | null | undefined,
): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  try {
    const blob = (raw ? JSON.parse(raw) : null) as Stored | null;
    const stored =
      blob !== null && typeof blob === 'object' && blob.version === VERSION
        ? blob.answers
        : null;
    for (const [key, entry] of Object.entries(stored ?? {})) {
      if (
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as Entry).at === 'string'
      ) {
        entries.set(key, entry as Entry);
      }
    }
  } catch (error) {
    // A half-written blob, a shape from an older build, no native module at
    // all: an unreadable cache is an empty one, never a failed launch.
    logger.warn('serverRead', 'Stored answers could not be read', error);
  }
  return entries;
}

function cache(): Map<string, Entry> {
  if (answers !== null) return answers;
  try {
    answers = entriesFromStored(mmkvStorage.getItem(STORAGE_KEY));
  } catch (error) {
    logger.warn('serverRead', 'Stored answers could not be read', error);
    answers = new Map();
  }
  return answers;
}

/** The newest answers, as JSON small enough to be worth keeping. */
function serialise(entries: Map<string, Entry>): string {
  const newest = [...entries.entries()]
    .sort((a, b) => b[1].at.localeCompare(a[1].at))
    .slice(0, MAX_ENTRIES);
  const keep: Record<string, Entry> = {};
  for (const [key, entry] of newest) {
    const json = JSON.stringify(entry);
    if (json !== undefined && json.length <= MAX_ENTRY_BYTES) keep[key] = entry;
  }
  return JSON.stringify({ version: VERSION, answers: keep } satisfies Stored);
}

function scheduleWrite(): void {
  if (writeTimer !== null) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      mmkvStorage.setItem(STORAGE_KEY, serialise(cache()));
    } catch (error) {
      // Storage full, or a value that will not serialise. The session's own
      // copy still works; only the memory of it past this run is lost.
      logger.warn('serverRead', 'Stored answers could not be written', error);
    }
  }, WRITE_DEBOUNCE_MS);
}

/**
 * Empties the cache, in memory and on the device.
 *
 * Called on sign-out: the next account must not open on the last one's
 * figures, and these answers outlive the process now, so forgetting the
 * stored half would be a leak between two people on one phone.
 */
export function clearServerReads(): void {
  answers = new Map();
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    mmkvStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    logger.warn('serverRead', 'Stored answers could not be cleared', error);
  }
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
 * A failed read never clears what is on screen. The error is reported beside
 * the data rather than instead of it, so a screen offline shows the last
 * figures with `isStale` set and lets the caller say how old they are —
 * where it used to show an empty state over figures the phone still had.
 *
 * A null key skips the read.
 */
export function useServerRead<T>(
  key: string | null,
  read: () => Promise<T>,
  refreshOn?: unknown,
): Loaded<T> {
  const remembered = key === null ? undefined : cache().get(key);
  const [state, setState] = useState<{
    data: T | null;
    cachedAt: string | null;
    fresh: boolean;
  }>(() => ({
    data: (remembered?.data as T | undefined) ?? null,
    cachedAt: remembered?.at ?? null,
    fresh: false,
  }));
  const [loading, setLoading] = useState(key !== null && state.data === null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const syncedAt = useLastStepSyncAt();
  const latest = useRef(0);
  const readRef = useRef(read);
  readRef.current = read;

  // A new key is a different question: its answer replaces the old one,
  // and the old one is not shown in the meantime.
  const shownKey = useRef<string | null>(
    key !== null && remembered !== undefined ? key : null,
  );

  useEffect(() => {
    if (key === null) {
      setLoading(false);
      return;
    }
    const request = (latest.current += 1);
    if (shownKey.current !== key) {
      const stored = cache().get(key);
      setState({
        data: (stored?.data as T | undefined) ?? null,
        cachedAt: stored?.at ?? null,
        fresh: false,
      });
      setLoading(stored === undefined);
      shownKey.current = stored === undefined ? null : key;
    }
    readRef
      .current()
      .then(result => {
        if (request !== latest.current) return;
        const at = new Date().toISOString();
        cache().set(key, { at, data: result });
        scheduleWrite();
        shownKey.current = key;
        setState({ data: result, cachedAt: at, fresh: true });
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
  return {
    data: state.data,
    loading,
    error,
    cachedAt: state.cachedAt,
    isStale: state.data !== null && !state.fresh,
    reload,
  };
}
