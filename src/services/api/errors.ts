import axios from 'axios';

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'server'
  | 'unknown';

/**
 * Every failure that leaves the API layer is one of these, so screens can
 * branch on `kind` instead of digging through axios internals or guessing at
 * status codes.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly details: unknown;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null = null,
    details: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.details = details;
  }

  /** True when retrying the same request could plausibly succeed. */
  get isRetryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}

function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return 'You do not have access to this.';
    case 404:
      return 'We could not find what you were looking for.';
    case 422:
      return 'Some of the details you entered are not valid.';
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
  if (status >= 500) return 'server';
  return 'unknown';
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') {
      return new ApiError('timeout', 'The request took too long. Try again.');
    }
    if (!error.response) {
      return new ApiError(
        'network',
        'No connection. Check your internet and try again.',
      );
    }

    const { status, data } = error.response;
    return new ApiError(
      kindForStatus(status),
      messageForStatus(status),
      status,
      data,
    );
  }

  return new ApiError(
    'unknown',
    error instanceof Error ? error.message : 'An unexpected error occurred.',
  );
}
