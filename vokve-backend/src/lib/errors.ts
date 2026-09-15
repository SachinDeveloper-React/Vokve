/**
 * The one error shape the client understands (BACKEND.md §3.3):
 * `{ error: { code, message, details } }`. `message` is rendered verbatim to
 * the user, so it is written for them; `code` is for the client's logic.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const Errors = {
  validation: (details: Record<string, unknown>) =>
    new ApiError(422, 'VALIDATION_FAILED', 'Check the highlighted fields.', details),
  unauthorized: () => new ApiError(401, 'UNAUTHORIZED', 'Please sign in again.'),
  forbidden: (code = 'FORBIDDEN', message = 'You cannot do that.') => new ApiError(403, code, message),
  notFound: (what = 'That') => new ApiError(404, 'NOT_FOUND', `${what} could not be found.`),
  conflict: (code: string, message: string, details?: Record<string, unknown>) =>
    new ApiError(409, code, message, details ?? null),
  deviceNotRegistered: () =>
    new ApiError(428, 'DEVICE_NOT_REGISTERED', 'This device needs to be registered before continuing.'),
  upgradeRequired: (storeUrl: string, minVersion: string) =>
    new ApiError(426, 'UPGRADE_REQUIRED', 'Please update VOKVE to continue.', { storeUrl, minVersion }),
  rateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a moment.', { retryAfterSeconds }),
};
