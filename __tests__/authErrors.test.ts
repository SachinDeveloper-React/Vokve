/**
 * How an auth failure is framed on screen. The server's message is always
 * kept; these check the framing around it — attempts left, wait times, and
 * the title that tells a user to reach for a new code instead of a new digit.
 *
 * @format
 */

import { ApiError } from '../src/services/api/errors';
import { describeAuthError, describeOtpError } from '../src/utils/authErrors';

const error = (kind: ApiError['kind'], code: string | null, message: string, details: unknown = null) =>
  new ApiError(kind, message, null, details, code);

describe('describeOtpError', () => {
  test('a wrong code says how many tries are left', () => {
    const one = describeOtpError(error('validation', 'OTP_INVALID', 'Not right.', { attemptsRemaining: 1 }));
    expect(one.title).toBe('That code did not work');
    expect(one.message).toBe('Not right. You have 1 attempt left.');
    const three = describeOtpError(error('validation', 'OTP_INVALID', 'Not right.', { attemptsRemaining: 3 }));
    expect(three.message).toBe('Not right. You have 3 attempts left.');
  });

  test('a dead challenge points at the resend', () => {
    for (const code of ['OTP_EXPIRED', 'OTP_TOO_MANY_ATTEMPTS', 'OTP_NOT_FOUND']) {
      const notice = describeOtpError(error('not_found', code, 'Gone.'));
      expect(notice.title).toMatch(/can't be used/);
      expect(notice.message).toBe('Gone. Request a new one below.');
    }
  });

  test('a cooldown says how long, in words', () => {
    expect(describeOtpError(error('rate_limited', 'OTP_RESEND_TOO_SOON', 'Wait.', { retryAfterSeconds: 25 })).message)
      .toBe('Wait. Try again in 25 seconds.');
    expect(describeOtpError(error('rate_limited', 'OTP_RESEND_LIMIT', 'Wait.', { retryAfterSeconds: 150 })).message)
      .toBe('Wait. Try again in 3 minutes.');
    // A day-long wait is not worth a countdown sentence.
    expect(describeOtpError(error('rate_limited', 'OTP_DAILY_LIMIT', 'Tomorrow.', { retryAfterSeconds: 86400 })).message)
      .toBe('Tomorrow.');
  });

  test('no connection is named as such', () => {
    expect(describeOtpError(error('network', null, 'No connection.')).title).toBe('No connection');
  });
});

describe('describeAuthError', () => {
  test('a 422 with field errors points at the fields', () => {
    const notice = describeAuthError(error('validation', 'VALIDATION_FAILED', 'Check.', { email: 'Taken.' }), 'Could not sign up');
    expect(notice.title).toBe('Check the highlighted fields');
  });

  test('known refusals get a specific title, unknown ones the fallback', () => {
    expect(describeAuthError(error('forbidden', 'TOO_MANY_DEVICES', 'x'), 'F').title).toBe('Too many devices');
    expect(describeAuthError(error('forbidden', 'PHONE_NOT_VERIFIED', 'x'), 'F').title).toBe('Number not verified yet');
    expect(describeAuthError(error('server', null, 'x'), 'F').title).toBe('VOKVE is having trouble');
    expect(describeAuthError(error('unauthorized', 'INVALID_CREDENTIALS', 'x'), 'Could not sign you in').title).toBe('Could not sign you in');
  });
});
