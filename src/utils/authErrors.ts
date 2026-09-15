import type { ApiError } from '../services/api/errors';

export interface ErrorNotice {
  title: string;
  message: string;
}

/**
 * How an OTP failure reads on screen.
 *
 * The server's message is always the body; what changes is the framing. A
 * wrong digit with attempts left is an invitation to try again, and says
 * how many tries remain. A challenge the server is done with — expired,
 * burned, gone — is a different situation, and the title says so, because
 * the only useful control left is "send a new code" and the user should be
 * looking for it rather than retyping.
 */
export function describeOtpError(error: ApiError): ErrorNotice {
  if (error.isOtpChallengeDead) {
    return {
      title: "That code can't be used any more",
      message: `${error.message} Request a new one below.`,
    };
  }

  if (error.code === 'OTP_INVALID') {
    const left = error.attemptsRemaining;
    const suffix =
      left === null
        ? ''
        : left === 1
          ? ' You have 1 attempt left.'
          : ` You have ${left} attempts left.`;
    return { title: 'That code did not work', message: `${error.message}${suffix}` };
  }

  if (error.kind === 'rate_limited') {
    const wait = error.retryAfterSeconds;
    return {
      title: 'Please wait a moment',
      message:
        wait !== null && wait > 0 && wait < 3600
          ? `${error.message} Try again in ${formatWait(wait)}.`
          : error.message,
    };
  }

  if (error.isRetryable) {
    return { title: 'No connection', message: error.message };
  }

  return { title: 'Something went wrong', message: error.message };
}

/** "45 seconds" / "2 minutes" — for a sentence, not a clock. */
function formatWait(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * How a failed sign-in or sign-up reads. Field-level problems are handed to
 * the form separately (see `fieldErrors` on the error); this is the banner
 * above it, which for a 422 only needs to point at the fields.
 */
export function describeAuthError(error: ApiError, fallbackTitle: string): ErrorNotice {
  if (error.kind === 'validation' && Object.keys(error.fieldErrors).length > 0) {
    return { title: 'Check the highlighted fields', message: error.message };
  }
  if (error.code === 'TOO_MANY_DEVICES') {
    return { title: 'Too many devices', message: error.message };
  }
  if (error.code === 'PHONE_NOT_VERIFIED') {
    return { title: 'Number not verified yet', message: error.message };
  }
  if (error.kind === 'rate_limited') {
    return describeOtpError(error);
  }
  if (error.isRetryable) {
    return { title: 'No connection', message: error.message };
  }
  if (error.kind === 'server') {
    return { title: 'VOKVE is having trouble', message: error.message };
  }
  return { title: fallbackTitle, message: error.message };
}
