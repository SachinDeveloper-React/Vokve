/**
 * `toApiError` is the one place the server's error body is read, and every
 * screen's error handling depends on what it extracts: the stable code, the
 * details a screen branches on, and a message a user can read. These pin
 * that mapping so a server change surfaces here rather than as a screen
 * showing "That request could not be completed" for a code it should know.
 *
 * @format
 */

import { AxiosError, AxiosHeaders } from 'axios';
import { ApiError, toApiError } from '../src/services/api/errors';

const response = (status: number, data: unknown) =>
  new AxiosError('boom', String(status), { headers: new AxiosHeaders() }, null, {
    status,
    statusText: '',
    data,
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

const serverBody = (code: string, message: string, details: unknown = null) => ({
  error: { code, message, details },
});

describe('toApiError', () => {
  test('reads the server body: code, message and details', () => {
    const error = toApiError(
      response(422, serverBody('OTP_INVALID', 'That code is not right.', { attemptsRemaining: 2 })),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('validation');
    expect(error.code).toBe('OTP_INVALID');
    expect(error.message).toBe('That code is not right.');
    expect(error.attemptsRemaining).toBe(2);
    expect(error.status).toBe(422);
  });

  test('falls back to its own copy when the body is not the server shape', () => {
    const error = toApiError(response(500, '<html>Bad gateway</html>'));
    expect(error.kind).toBe('server');
    expect(error.code).toBeNull();
    expect(error.message).toMatch(/our side/);
    expect(error.details).toBeNull();
  });

  test('maps the status codes the app branches on', () => {
    expect(toApiError(response(401, null)).kind).toBe('unauthorized');
    expect(toApiError(response(403, null)).kind).toBe('forbidden');
    expect(toApiError(response(426, null)).kind).toBe('upgrade_required');
    expect(toApiError(response(428, null)).kind).toBe('device_not_registered');
    expect(toApiError(response(429, null)).kind).toBe('rate_limited');
    expect(toApiError(response(503, null)).kind).toBe('server');
  });

  test('a 422 with per-field details exposes them by the form path', () => {
    const error = toApiError(
      response(422, serverBody('VALIDATION_FAILED', 'Check the highlighted fields.', {
        email: 'That email address is already registered.',
        'phone.number': 'That phone number is already registered.',
        _: 'ignored',
      })),
    );
    expect(error.fieldErrors).toEqual({
      email: 'That email address is already registered.',
      'phone.number': 'That phone number is already registered.',
    });
  });

  test('field errors are empty for anything but a validation failure', () => {
    const error = toApiError(response(403, serverBody('TOO_MANY_DEVICES', 'Too many devices.', { email: 'x' })));
    expect(error.fieldErrors).toEqual({});
  });

  test('a 429 carries how long to wait', () => {
    const error = toApiError(
      response(429, serverBody('OTP_RESEND_TOO_SOON', 'Wait.', { retryAfterSeconds: 17.2 })),
    );
    expect(error.retryAfterSeconds).toBe(18);
    expect(toApiError(response(429, serverBody('RATE_LIMITED', 'Wait.'))).retryAfterSeconds).toBeNull();
  });

  test('knows which OTP failures mean the challenge is finished', () => {
    const dead = ['OTP_EXPIRED', 'OTP_NOT_FOUND', 'OTP_TOO_MANY_ATTEMPTS'];
    for (const code of dead) {
      expect(toApiError(response(410, serverBody(code, 'x'))).isOtpChallengeDead).toBe(true);
    }
    expect(toApiError(response(422, serverBody('OTP_INVALID', 'x'))).isOtpChallengeDead).toBe(false);
    expect(toApiError(response(429, serverBody('OTP_RESEND_TOO_SOON', 'x'))).isOtpChallengeDead).toBe(false);
  });

  test('transport failures are retryable and have no code', () => {
    const noResponse = new AxiosError('Network Error', 'ERR_NETWORK');
    const timeout = new AxiosError('timeout', 'ECONNABORTED');
    expect(toApiError(noResponse).kind).toBe('network');
    expect(toApiError(noResponse).isRetryable).toBe(true);
    expect(toApiError(timeout).kind).toBe('timeout');
    expect(toApiError(timeout).code).toBeNull();
    expect(toApiError(response(422, null)).isRetryable).toBe(false);
  });

  test('passes an ApiError through untouched and wraps anything else', () => {
    const original = new ApiError('validation', 'unexpected', null, null, null);
    expect(toApiError(original)).toBe(original);
    expect(toApiError(new Error('kaboom')).kind).toBe('unknown');
    expect(toApiError('kaboom').message).toMatch(/unexpected/i);
  });
});
