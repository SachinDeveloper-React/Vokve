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
 * How a failed sign-in or sign-up reads. Field-level problems are also handed
 * to the form (see `fieldErrors` on the error); this is the banner above it.
 *
 * A 422's own `message` is only "Check the highlighted fields." — the reason
 * lives in its details, one sentence per field. The banner repeats those
 * verbatim rather than pointing at the form: the user is already reading it,
 * and a banner that describes nothing is how "That phone number is already
 * registered." turned into an unexplained refusal.
 */
export function describeAuthError(error: ApiError, fallbackTitle: string): ErrorNotice {
  const refused = error.kind === 'validation' ? Object.values(error.fieldErrors) : [];
  if (refused.length > 0) {
    return { title: fallbackTitle, message: refused.join('\n') };
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
