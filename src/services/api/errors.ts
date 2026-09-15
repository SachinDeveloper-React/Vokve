import axios from 'axios';

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'rate_limited'
  /** 426 — this build is retired; the details carry the store URL. */
  | 'upgrade_required'
  /** 428 — the server does not know this install; register and retry. */
  | 'device_not_registered'
  | 'server'
  | 'unknown';

/**
 * The stable codes the server sends in `error.code` (BACKEND.md §3.3). Only
 * the ones a screen branches on are named here; anything else still arrives
 * as a plain string and is shown with its message.
 */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_CREDENTIALS'
  | 'PHONE_NOT_VERIFIED'
  | 'EMAIL_NOT_VERIFIED'
  | 'ALREADY_REGISTERED'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_NOT_FOUND'
  | 'OTP_TOO_MANY_ATTEMPTS'
  | 'OTP_WRONG_PURPOSE'
  | 'OTP_RESEND_TOO_SOON'
  | 'OTP_RESEND_LIMIT'
  | 'OTP_DAILY_LIMIT'
  | 'RATE_LIMITED'
  | 'TOO_MANY_DEVICES'
  | 'DEVICE_NOT_REGISTERED'
  | 'UPGRADE_REQUIRED'
  | 'INSUFFICIENT_COINS'
  | 'UNAUTHORIZED'
  | (string & {});

/**
 * The server's error body, exactly as it is written (BACKEND.md §3.3). Kept
 * as a type here so the parser below is the only place that knows the shape.
 */
interface ServerErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
}

/**
 * Every failure that leaves the API layer is one of these, so screens can
 * branch on `kind` or `code` instead of digging through axios internals or
 * guessing at status codes.
 *
 * `message` is always something a user can read. The server writes its own
 * (BACKEND.md §3.3) and that wins; the fallbacks here cover transport
 * failures and a server that answered with no body.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** The server's stable code, or null for transport failures. */
  readonly code: ApiErrorCode | null;
  /** The server's `details` object, or null. Field errors, retry timing, shortfalls. */
  readonly details: Record<string, unknown> | null;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    details: unknown = null,
    code: ApiErrorCode | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.details = isRecord(details) ? details : null;
  }

  /** Transport failures are worth retrying; a rejected request never is. */
  get isRetryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }

  /** How long the server asked us to wait, when it said (429s do). */
  get retryAfterSeconds(): number | null {
    const value = this.details?.retryAfterSeconds;
    return typeof value === 'number' && value >= 0 ? Math.ceil(value) : null;
  }

  /** Wrong OTP attempts the server will still accept, when it said. */
  get attemptsRemaining(): number | null {
    const value = this.details?.attemptsRemaining;
    return typeof value === 'number' ? value : null;
  }

  /**
   * Field-level messages from a 422, keyed by the field path the server used
   * — the same paths the forms use (`email`, `phone.number`), so a screen can
   * hand them straight to react-hook-form's `setError`.
   */
  get fieldErrors(): Record<string, string> {
    if (this.kind !== 'validation' || !this.details) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [field, message] of Object.entries(this.details)) {
      if (typeof message === 'string' && field !== '_') {
        out[field] = message;
      }
    }
    return out;
  }

  /**
   * Whether the OTP challenge behind this error is finished with — expired,
   * burned by too many attempts, or gone — so the only way forward is a new
   * code. A plain wrong digit is not this: that challenge is still live.
   */
  get isOtpChallengeDead(): boolean {
    return (
      this.code === 'OTP_EXPIRED' ||
      this.code === 'OTP_NOT_FOUND' ||
      this.code === 'OTP_TOO_MANY_ATTEMPTS'
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return 'You do not have access to this.';
    case 404:
      return 'We could not find what you were looking for.';
    case 409:
      return 'That conflicts with something that already exists.';
    case 422:
      return 'Some of the details you entered are not valid.';
    case 426:
      return 'Please update VOKVE to continue.';
    case 428:
      return 'This device needs to be registered. Trying again…';
    case 429:
      return 'Too many attempts. Please wait a moment and try again.';
    default:
      return status >= 500
        ? 'Something went wrong on our side. Please try again.'
        : 'That request could not be completed.';
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 422) return 'validation';
  if (status === 426) return 'upgrade_required';
  if (status === 428) return 'device_not_registered';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Pulls the server's `{ error: { code, message, details } }` out of a response body, tolerating anything else. */
function parseServerError(data: unknown): { code: ApiErrorCode | null; message: string | null; details: unknown } {
  const body = data as ServerErrorBody | null | undefined;
  const error = body && isRecord(body) && isRecord(body.error) ? body.error : null;
  return {
    code: error && typeof error.code === 'string' ? (error.code as ApiErrorCode) : null,
    message: error && typeof error.message === 'string' && error.message.length > 0 ? error.message : null,
    details: error ? error.details ?? null : null,
  };
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ApiError('timeout', 'The request took too long. Check your connection and try again.');
    }
    if (!error.response) {
      return new ApiError(
        'network',
        'No connection. Check your internet and try again.',
      );
    }

    const { status, data } = error.response;
    const server = parseServerError(data);
    return new ApiError(
      kindForStatus(status),
      server.message ?? messageForStatus(status),
      status,
      server.details,
      server.code,
    );
  }

  return new ApiError(
    'unknown',
    error instanceof Error ? error.message : 'An unexpected error occurred.',
  );
}
