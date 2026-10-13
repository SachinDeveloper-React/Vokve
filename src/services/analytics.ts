import { AppState, type AppStateStatus } from 'react-native';
import { getMMKV } from '../stores';
import type { AnalyticsEvent } from '../types/models';
import { logger } from '../utils/logger';
import { uuid } from '../utils/uuid';
import { telemetryApi } from './api/endpoints';
import { ApiError, toApiError } from './api/errors';
import { getDeviceId } from './device';

/**
 * What the member did, on its way to the server (`POST /events`, PRD ADV2).
 *
 * Every screen they open and every meaningful thing they do is queued here,
 * kept across launches, and sent in batches — never one request per tap. The
 * queue is the whole design:
 *
 *   - **Offline is normal.** Events are taken on a train and sent on wifi,
 *     so they carry their own `at` and the queue outlives the process.
 *   - **Nothing on screen waits for it.** `track` is synchronous and cannot
 *     throw; a flush that fails keeps the batch and tries again later.
 *   - **It is capped.** A phone that never reaches the server must not grow
 *     a file without bound, so the oldest events go first.
 *   - **Consent is honoured here as well as there.** The server drops the
 *     rows of a member who turned usage analytics off (RULES P7); this
 *     stops sending them at all, which also saves their data.
 */
const QUEUE_KEY = 'vokve.events.queue';
/** The most events kept while the server cannot be reached — roughly a long session's worth. */
const MAX_QUEUED = 300;
/** The most sent in one request; the server takes a hundred. */
const BATCH_SIZE = 50;
/** A queue this long is sent at once rather than waiting for the timer. */
const FLUSH_AT = 20;
/** How long a lone event waits for company. */
const FLUSH_AFTER_MS = 15_000;

let queue: AnalyticsEvent[] = [];
let loaded = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
let appStateSub: { remove: () => void } | null = null;

/** The app launch events are grouped by. A new one per sign-in, so a shared phone does not merge two members' visits. */
let sessionId = uuid();
/** Null while nobody is signed in: there is no account to attribute a row to. */
let currentUserId: string | null = null;
/** False only once the member's privacy settings say so (RULES P7). */
let allowed = true;

/** Where the member is now, and since when — what gives a screen view its dwell time. */
let currentScreen: { name: string; at: number } | null = null;

function storage() {
  try {
    return getMMKV();
  } catch (error) {
    // A build without the native module: the queue lives in memory only.
    logger.warn('analytics', 'No storage for the event queue', error);
    return null;
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const raw = storage()?.getString(QUEUE_KEY);
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      queue = parsed.filter(
        (event): event is AnalyticsEvent =>
          typeof event === 'object' &&
          event !== null &&
          typeof (event as AnalyticsEvent).name === 'string' &&
          typeof (event as AnalyticsEvent).at === 'string',
      );
    }
  } catch {
    // A half-written file is not worth recovering; the trail is not the product.
    queue = [];
  }
}

function persist(): void {
  const mmkv = storage();
  if (!mmkv) return;
  try {
    mmkv.set(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    logger.warn('analytics', 'Could not keep the event queue', error);
  }
}

/**
 * Queues one event. Never throws and never waits: a screen that cannot be
 * instrumented without a `try` around it would not be instrumented.
 */
export function track(
  name: string,
  props?: Record<string, string | number | boolean | null | undefined>,
): void {
  try {
    if (!allowed || !currentUserId) return;
    load();
    queue.push({
      name,
      at: new Date().toISOString(),
      sessionId,
      ...(props ? { props: clean(props) } : {}),
    });
    if (queue.length > MAX_QUEUED) {
      queue = queue.slice(queue.length - MAX_QUEUED);
    }
    persist();
    if (queue.length >= FLUSH_AT) {
      flushEvents();
    } else {
      scheduleFlush();
    }
  } catch (error) {
    logger.warn('analytics', `Could not track ${name}`, error);
  }
}

/**
 * The screen the member just opened, and how long they spent on the one
 * before it — the half of a screen view that says whether they read it or
 * passed through. `undefined` props are dropped rather than sent as null,
 * so a screen opened without parameters carries nothing extra.
 */
export function trackScreen(
  name: string,
  props?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (currentScreen?.name === name) return;
  const previous = currentScreen;
  currentScreen = { name, at: Date.now() };
  track('screen_view', {
    screen: name,
    ...(previous
      ? { from: previous.name, fromDurationMs: Date.now() - previous.at }
      : {}),
    ...props,
  });
}

/** Drops the keys nothing was passed for: `{ id: undefined }` is not a property. */
function clean(
  props: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushEvents();
  }, FLUSH_AFTER_MS);
}

/**
 * Sends what is queued, oldest first, one batch at a time.
 *
 * A batch the server refuses *because of what it is* (a 4xx that is not a
 * rate limit) is dropped: it would be refused again on every launch for the
 * life of the install. Anything else — offline, a 5xx, a rate limit — keeps
 * the batch where it is for the next flush.
 */
export async function flushEvents(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    load();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    // No account or no registered device means nothing can be attributed:
    // the queue waits rather than being thrown away.
    while (queue.length > 0 && allowed && currentUserId && getDeviceId()) {
      const batch = queue.slice(0, BATCH_SIZE);
      try {
        await telemetryApi.sendEvents(batch);
      } catch (error) {
        const apiError = toApiError(error);
        if (isPermanent(apiError)) {
          logger.warn('analytics', `Dropped ${batch.length} events the server refused`, apiError);
        } else {
          logger.debug('analytics', 'Events kept for the next flush', apiError);
          return;
        }
      }
      queue = queue.slice(batch.length);
      persist();
    }
  })();
  try {
    await flushing;
  } finally {
    flushing = null;
  }
}

function isPermanent(error: ApiError): boolean {
  const status = error.status;
  return (
    typeof status === 'number' && status >= 400 && status < 500 && status !== 429
  );
}

/**
 * Who the trail belongs to. Called by the auth store on sign-in, on a
 * restored session, and with `null` on sign-out — the one thing analytics
 * needs from the session, handed over rather than imported, so the store
 * can track its own events without the two files importing each other.
 *
 * A sign-in starts a session of its own: the same phone passed to someone
 * else must not have their screens counted as the last member's visit.
 */
export function setAnalyticsIdentity(userId: string | null): void {
  if (currentUserId === userId) return;
  currentUserId = userId;
  currentScreen = null;
  if (!userId) {
    stopLifecycle();
    return;
  }
  sessionId = uuid();
  startLifecycle();
  track('app_open');
  flushEvents();
}

/**
 * Whether the member lets us keep a trail at all (RULES P7). The server is
 * the enforcement point; this is the courtesy of not sending it. Switching
 * it off drops whatever is still queued — keeping it would mean sending it
 * the moment they switched it back on.
 */
export function setAnalyticsAllowed(next: boolean): void {
  if (allowed === next) return;
  allowed = next;
  if (!next) {
    queue = [];
    loaded = true;
    persist();
  }
}

function startLifecycle(): void {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', onAppStateChange);
}

function stopLifecycle(): void {
  appStateSub?.remove();
  appStateSub = null;
  currentScreen = null;
}

/**
 * Going to the background is the one moment worth sending at: the member may
 * not open the app again for a day, and the OS may not let the process live
 * that long.
 */
function onAppStateChange(state: AppStateStatus): void {
  if (state === 'active') {
    flushEvents();
    return;
  }
  if (state === 'background' || state === 'inactive') {
    if (currentScreen) {
      track('app_background', {
        screen: currentScreen.name,
        screenDurationMs: Date.now() - currentScreen.at,
      });
      currentScreen = { name: currentScreen.name, at: Date.now() };
    }
    flushEvents();
  }
}

/** For tests: the queue as it stands, and a way back to a clean slate. */
export const analyticsInternals = {
  queued: () => {
    load();
    return [...queue];
  },
  reset: () => {
    queue = [];
    loaded = true;
    currentUserId = null;
    currentScreen = null;
    allowed = true;
    sessionId = uuid();
    stopLifecycle();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    storage()?.remove(QUEUE_KEY);
  },
};
