import { AppState } from 'react-native';
import {
  getCrashlytics,
  recordError,
  setAttributes,
  setUserId,
} from '@react-native-firebase/crashlytics';
import { getMMKV } from '../stores';
import type { AppError, AppErrorKind } from '../types/models';
import { logger, setLoggerErrorSink } from '../utils/logger';
import { telemetryApi } from './api/endpoints';
import { toApiError, type ApiError } from './api/errors';
import { getDeviceId } from './device';

/**
 * What went wrong, on its way to somewhere a person will see it (RULES P17).
 *
 * Two destinations, deliberately:
 *
 *   - **Crashlytics** gets the full, symbolicated picture, and is the only
 *     one that can report a *native* crash or an ANR — by the time those
 *     happen there is no JavaScript left to send anything. It is already
 *     collecting them (the Gradle plugin is applied); what was missing is
 *     who they happened to, which `setErrorIdentity` now says.
 *   - **Our own server** gets a short record of the same thing, grouped,
 *     so an operator reading an account sees its faults beside its steps,
 *     its permissions and its orders instead of in a separate console.
 *
 * Nothing here is analytics, and the usage-analytics switch does not silence
 * it (RULES P7, P17): an error is the record of the app failing somebody.
 * The queue is kept small and simple on purpose — errors are rare, and a
 * phone that is failing is not the place for clever machinery.
 */
const QUEUE_KEY = 'vokve.errors.queue';
/** The most kept while the server cannot be reached. A failing build fills this in seconds. */
const MAX_QUEUED = 25;
/** The most sent in one request; the server takes twenty. */
const BATCH_SIZE = 20;
/** Stacks are bounded by the contract; trimmed here so the queue is not fat either. */
const MAX_STACK = 4000;
const MAX_MESSAGE = 500;

let queue: AppError[] = [];
let loaded = false;
let flushing: Promise<void> | null = null;
let userId: string | null = null;
let sessionId: string | null = null;
let screen: string | null = null;
let appStateSub: { remove: () => void } | null = null;
/** True while a report is being sent, so a failure inside the sink cannot report itself. */
let reporting = false;

function storage() {
  try {
    return getMMKV();
  } catch {
    // A build without the native module: the queue lives in memory only.
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
        (error): error is AppError =>
          typeof error === 'object' &&
          error !== null &&
          typeof (error as AppError).message === 'string' &&
          typeof (error as AppError).at === 'string',
      );
    }
  } catch {
    queue = [];
  }
}

function persist(): void {
  try {
    storage()?.set(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // The report is not worth a second failure.
  }
}

/** What Crashlytics is told, for a crash that happens later in the same session. */
function crashlytics() {
  try {
    return getCrashlytics();
  } catch {
    // No Firebase on this build.
    return null;
  }
}

export interface ReportInput {
  kind: AppErrorKind;
  /** The thrown thing, whatever it is: an Error, an ApiError, a string. */
  error?: unknown;
  /** Used when `error` carries no message of its own. */
  message?: string;
  /** Who was running — a screen, or a service's own scope. */
  scope?: string;
  /** It ended something: a screen replaced by the fallback, or the app. */
  fatal?: boolean;
  context?: Record<string, string | number | boolean | null | undefined>;
}

/**
 * Reports one fault. Never throws, never waits: a call site that needed a
 * `try` around its own error reporting would not report.
 */
export function reportError(input: ReportInput): void {
  if (reporting) return;
  reporting = true;
  try {
    const error = asError(input.error, input.message);
    const crash = crashlytics();
    if (crash) {
      // `jsErrorName` is what groups it in the console; the scope makes a
      // `TypeError` from the step service tell itself apart from one in the
      // shop.
      recordError(crash, error, input.scope ? `${input.scope}: ${error.name}` : error.name);
    }
    enqueue({
      kind: input.kind,
      name: error.name,
      message: error.message.slice(0, MAX_MESSAGE),
      scope: input.scope,
      screen: screen ?? undefined,
      stack: error.stack?.slice(0, MAX_STACK),
      fatal: input.fatal ?? false,
      at: new Date().toISOString(),
      sessionId: sessionId ?? undefined,
      context: clean(input.context),
    });
  } catch {
    // Reporting a failure must not become one.
  } finally {
    reporting = false;
  }
}

function enqueue(error: AppError): void {
  load();
  queue.push(error);
  if (queue.length > MAX_QUEUED) {
    // The oldest go: a fault that is still happening will report again.
    queue = queue.slice(queue.length - MAX_QUEUED);
  }
  persist();
  flushErrors();
}

/**
 * Sends what is queued. A batch the server refuses *for what it is* — a
 * 4xx that is not a rate limit — is dropped, because it would be refused
 * again on every launch; anything else keeps it for the next try.
 */
export async function flushErrors(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    load();
    while (queue.length > 0 && userId && getDeviceId()) {
      const batch = queue.slice(0, BATCH_SIZE);
      try {
        await telemetryApi.reportErrors(batch);
      } catch (thrown) {
        const apiError = toApiError(thrown);
        if (!isPermanent(apiError)) return;
        logger.debug('errors', `Dropped ${batch.length} reports the server refused`, apiError);
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
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
}

/**
 * Whose faults these are. Called by the auth store on sign-in, on a
 * restored session and with `null` on sign-out — handed over rather than
 * imported, so the store is not coupled to this and this is not coupled to
 * the store.
 *
 * The identity is what turns Crashlytics from a pile of anonymous stacks
 * into "this account crashed", which is the whole point of having it.
 */
export function setErrorIdentity(
  next: string | null,
  options: { sessionId?: string } = {},
): void {
  userId = next;
  sessionId = options.sessionId ?? sessionId;
  const crash = crashlytics();
  if (crash) {
    // Crashlytics keeps the last id it was given; an empty one on sign-out
    // is how it is cleared.
    setUserId(crash, next ?? '').catch(() => {});
  }
  if (!next) {
    appStateSub?.remove();
    appStateSub = null;
    return;
  }
  if (!appStateSub) {
    // A fault reported while the app was being killed is sent on the way
    // back in, which is the only chance the fatal ones get.
    appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') flushErrors();
    });
  }
  flushErrors();
}

/** The screen a fault is attributed to. Fed by the navigator's own tracking. */
export function setErrorScreen(name: string | null): void {
  screen = name;
  const crash = crashlytics();
  if (crash && name) {
    setAttributes(crash, { screen: name }).catch(() => {});
  }
}

/**
 * Starts forwarding every `logger.error` to both destinations.
 *
 * This is what makes the existing code report: the app already logs its
 * failures in all the places that matter — a sync that would not send, a
 * push that could not register, a payment that did not complete — and they
 * have only ever reached a console nobody reads. One sink, and they all
 * arrive, without a single call site changing.
 */
export function startErrorReporting(): () => void {
  setLoggerErrorSink((scopeName, message, data) => {
    reportError({
      kind: 'js',
      scope: scopeName,
      error: data,
      message,
      context: contextOf(data),
    });
  });
  return () => setLoggerErrorSink(null);
}

/** Whatever was thrown, as an `Error` with a usable name and message. */
function asError(thrown: unknown, fallback?: string): Error {
  if (thrown instanceof Error) {
    return thrown;
  }
  const error = new Error(
    fallback ??
      (typeof thrown === 'string' ? thrown : 'Something went wrong') ,
  );
  if (thrown && typeof thrown === 'object') {
    const named = thrown as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof named.name === 'string') error.name = named.name;
    if (!fallback && typeof named.message === 'string') error.message = named.message;
    if (typeof named.stack === 'string') error.stack = named.stack;
  }
  return error;
}

/** The parts of an API error worth keeping beside the message. */
function contextOf(data: unknown): ReportInput['context'] {
  if (!data || typeof data !== 'object') return undefined;
  const error = data as Partial<ApiError> & { status?: number };
  if (error.kind === undefined && error.status === undefined) return undefined;
  return { kind: error.kind, status: error.status, code: error.code };
}

function clean(
  context: ReportInput['context'],
): AppError['context'] | undefined {
  if (!context) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
