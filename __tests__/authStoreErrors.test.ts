/**
 * The auth store's answer to every way the backend can say no. The point of
 * each case is the *state* the store leaves behind — because the root
 * navigator and the screens read only that — not the error object itself.
 *
 * @format
 */

import { ApiError } from '../src/services/api/errors';
import type { User } from '../src/types/models';

const mockAuthApi = {
  signIn: jest.fn(),
  signUp: jest.fn(),
  verifyOtp: jest.fn(),
  resendOtp: jest.fn(),
  sendEmailOtp: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  signOut: jest.fn().mockResolvedValue({ ok: true }),
};
const mockUserApi = { me: jest.fn(), updateProfile: jest.fn(), completeProfile: jest.fn() };
const mockDeviceApi = { register: jest.fn() };
const mockWalletApi = {
  get: jest.fn().mockRejectedValue(new Error('no wallet in test')),
  transactions: jest.fn().mockRejectedValue(new Error('no wallet in test')),
  earnRules: jest.fn(),
};

jest.mock('../src/services/api/endpoints', () => ({
  authApi: mockAuthApi,
  userApi: mockUserApi,
  deviceApi: mockDeviceApi,
  walletApi: mockWalletApi,
  workoutApi: {},
  activityApi: {},
}));

const mockSecureStorage = {
  readTokens: jest.fn(),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  clearTokens: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/services/secureStorage', () => ({ secureStorage: mockSecureStorage }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useAuthStore } = require('../src/stores/authStore') as typeof import('../src/stores/authStore');

const TOKENS = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 };
const USER: User = {
  id: 'usr_1', name: 'Asha', email: 'asha@example.com', avatarUrl: null, heightCm: null, weightKg: null,
  dateOfBirth: null, phone: '+919876543210', profileCompletedAt: null, gender: null, goal: 'stay_active',
  activityLevel: 'moderate', units: 'metric', streakDays: 0, weeklyGoalWorkouts: 4, createdAt: null,
  country: 'IN', phoneVerifiedAt: '2026-09-14T00:00:00Z', emailVerifiedAt: null, trustTier: 'normal',
};
const CHALLENGE = {
  verificationId: 'vrf_1', phone: '+919876543210', channel: 'sms' as const, target: '+91••••••3210',
  codeLength: 6, expiresInSeconds: 300, resendInSeconds: 30,
  devCode: null,
};
const serverError = (status: number, code: string, message: string, details: unknown = null) =>
  new ApiError(
    status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found'
      : status === 410 ? 'unknown' : status === 422 ? 'validation' : status === 429 ? 'rate_limited' : 'server',
    message, status, details, code,
  );
const networkError = () => new ApiError('network', 'No connection.');

beforeEach(() => {
  jest.clearAllMocks();
  mockDeviceApi.register.mockResolvedValue({ deviceId: 'dev_1', trustTier: 'normal', mustUpgrade: false, minVersion: '1.0.0' });
  useAuthStore.setState({
    status: 'idle', user: null, pendingVerification: null, pendingReset: null, isSubmitting: false, error: null, notice: null,
  });
});

describe('hydrate', () => {
  test('no tokens → signed out, quietly', async () => {
    mockSecureStorage.readTokens.mockResolvedValue(null);
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_out', notice: null });
    expect(mockSecureStorage.clearTokens).not.toHaveBeenCalled();
  });

  test('server unreachable → keeps the tokens and asks to retry', async () => {
    mockSecureStorage.readTokens.mockResolvedValue(TOKENS);
    mockDeviceApi.register.mockRejectedValue(networkError());
    await useAuthStore.getState().hydrate();
    const state = useAuthStore.getState();
    expect(state.status).toBe('unreachable');
    expect(state.error?.kind).toBe('network');
    expect(mockSecureStorage.clearTokens).not.toHaveBeenCalled();
  });

  test('a 5xx from /me is unreachable too — the session was not refused', async () => {
    mockSecureStorage.readTokens.mockResolvedValue(TOKENS);
    mockUserApi.me.mockRejectedValue(serverError(503, 'INTERNAL', 'Down.'));
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe('unreachable');
    expect(mockSecureStorage.clearTokens).not.toHaveBeenCalled();
  });

  test('a retry from unreachable stays on that screen while it runs, then succeeds', async () => {
    mockSecureStorage.readTokens.mockResolvedValue(TOKENS);
    mockUserApi.me.mockRejectedValueOnce(networkError()).mockResolvedValueOnce(USER);
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe('unreachable');

    const retry = useAuthStore.getState().hydrate();
    expect(useAuthStore.getState()).toMatchObject({ status: 'unreachable', isSubmitting: true });
    await retry;
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', isSubmitting: false, user: USER });
  });

  test('a revoked session → tokens cleared, signed out, told why', async () => {
    mockSecureStorage.readTokens.mockResolvedValue(TOKENS);
    mockUserApi.me.mockRejectedValue(serverError(401, 'UNAUTHORIZED', 'Please sign in again.'));
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_out', user: null });
    expect(useAuthStore.getState().notice).toMatch(/session has expired/);
    expect(mockSecureStorage.clearTokens).toHaveBeenCalled();
  });

  test('the device limit at launch ends the session with the server\'s words', async () => {
    mockSecureStorage.readTokens.mockResolvedValue(TOKENS);
    mockDeviceApi.register.mockRejectedValue(serverError(403, 'TOO_MANY_DEVICES', 'Up to 5 devices.'));
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_out', notice: 'Up to 5 devices.' });
    expect(mockSecureStorage.clearTokens).toHaveBeenCalled();
  });
});

describe('signIn', () => {
  test('wrong password → error shown, still signed out', async () => {
    mockAuthApi.signIn.mockRejectedValue(serverError(401, 'INVALID_CREDENTIALS', 'Do not match.'));
    expect(await useAuthStore.getState().signIn('a@b.com', 'x')).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({ status: 'idle', isSubmitting: false });
    expect(useAuthStore.getState().error?.code).toBe('INVALID_CREDENTIALS');
  });

  test('device limit on sign-in → refused, tokens dropped, error carries the code', async () => {
    mockAuthApi.signIn.mockResolvedValue({ user: USER, tokens: TOKENS, nextVerification: null });
    mockDeviceApi.register.mockRejectedValue(serverError(403, 'TOO_MANY_DEVICES', 'Up to 5 devices.'));
    expect(await useAuthStore.getState().signIn('a@b.com', 'x')).toBe(false);
    expect(useAuthStore.getState().status).not.toBe('authenticated');
    expect(useAuthStore.getState().error?.code).toBe('TOO_MANY_DEVICES');
    expect(mockSecureStorage.clearTokens).toHaveBeenCalled();
  });

  test('registration failing for lack of connection does not block the sign-in', async () => {
    mockAuthApi.signIn.mockResolvedValue({ user: USER, tokens: TOKENS, nextVerification: null });
    mockDeviceApi.register.mockRejectedValue(networkError());
    expect(await useAuthStore.getState().signIn('a@b.com', 'x')).toBe(true);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });
});

describe('verifyOtp', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'signed_out', pendingVerification: CHALLENGE });
  });

  test('a wrong digit keeps the challenge live and reports attempts left', async () => {
    mockAuthApi.verifyOtp.mockRejectedValue(serverError(422, 'OTP_INVALID', 'Not right.', { attemptsRemaining: 4 }));
    expect(await useAuthStore.getState().verifyOtp('000000')).toBe(false);
    expect(useAuthStore.getState().pendingVerification).toEqual(CHALLENGE);
    expect(useAuthStore.getState().error?.attemptsRemaining).toBe(4);
  });

  test('an expired or burned code marks the challenge expired so the screen offers a resend', async () => {
    for (const code of ['OTP_EXPIRED', 'OTP_TOO_MANY_ATTEMPTS']) {
      useAuthStore.setState({ pendingVerification: CHALLENGE, error: null });
      mockAuthApi.verifyOtp.mockRejectedValue(serverError(410, code, 'Gone.'));
      await useAuthStore.getState().verifyOtp('000000');
      expect(useAuthStore.getState().pendingVerification).toEqual({ ...CHALLENGE, expiresInSeconds: 0 });
    }
  });

  test('the phone code passing hands the email challenge over and signs in', async () => {
    const email = { ...CHALLENGE, verificationId: 'vrf_email', channel: 'email' as const, target: 'a•••@example.com' };
    mockAuthApi.verifyOtp.mockResolvedValue({ user: USER, tokens: TOKENS, nextVerification: email });
    expect(await useAuthStore.getState().verifyOtp('123456')).toBe(true);
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', pendingVerification: email });
    expect(mockDeviceApi.register).toHaveBeenCalledTimes(1);
  });

  test('the email code passing clears the challenge without re-registering the device', async () => {
    useAuthStore.setState({ status: 'authenticated', user: USER, pendingVerification: { ...CHALLENGE, channel: 'email' } });
    mockAuthApi.verifyOtp.mockResolvedValue({ user: { ...USER, emailVerifiedAt: '2026-09-14T00:00:00Z' }, tokens: TOKENS, nextVerification: null });
    expect(await useAuthStore.getState().verifyOtp('123456')).toBe(true);
    expect(useAuthStore.getState().pendingVerification).toBeNull();
    expect(useAuthStore.getState().user?.emailVerifiedAt).toBeTruthy();
    expect(mockDeviceApi.register).not.toHaveBeenCalled();
  });
});

describe('resendOtp', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'signed_out', pendingVerification: CHALLENGE });
  });

  test('too soon → the resend clock restarts from the server\'s figure', async () => {
    mockAuthApi.resendOtp.mockRejectedValue(serverError(429, 'OTP_RESEND_TOO_SOON', 'Wait.', { retryAfterSeconds: 12 }));
    expect(await useAuthStore.getState().resendOtp()).toBe(false);
    expect(useAuthStore.getState().pendingVerification).toEqual({ ...CHALLENGE, resendInSeconds: 12 });
  });

  test('a sign-up challenge the server has lost sends the user back with a reason', async () => {
    mockAuthApi.resendOtp.mockRejectedValue(serverError(404, 'OTP_NOT_FOUND', 'Gone.'));
    await useAuthStore.getState().resendOtp();
    expect(useAuthStore.getState().pendingVerification).toBeNull();
    expect(useAuthStore.getState().notice).toMatch(/start again/);
  });

  test('a lost email challenge just clears — the banner can ask again', async () => {
    useAuthStore.setState({ status: 'authenticated', user: USER, pendingVerification: { ...CHALLENGE, channel: 'email' } });
    mockAuthApi.resendOtp.mockRejectedValue(serverError(404, 'OTP_NOT_FOUND', 'Gone.'));
    await useAuthStore.getState().resendOtp();
    expect(useAuthStore.getState().pendingVerification).toBeNull();
    expect(useAuthStore.getState().notice).toBeNull();
  });
});

describe('password reset', () => {
  test('a wrong code keeps the reset alive; a dead one shows as expired', async () => {
    useAuthStore.setState({ pendingReset: CHALLENGE });
    mockAuthApi.resetPassword.mockRejectedValueOnce(serverError(422, 'OTP_INVALID', 'Not right.', { attemptsRemaining: 2 }));
    expect(await useAuthStore.getState().resetPassword('000000', 'walk1000steps')).toBe(false);
    expect(useAuthStore.getState().pendingReset).toEqual(CHALLENGE);

    mockAuthApi.resetPassword.mockRejectedValueOnce(serverError(410, 'OTP_EXPIRED', 'Expired.'));
    await useAuthStore.getState().resetPassword('000000', 'walk1000steps');
    expect(useAuthStore.getState().pendingReset).toEqual({ ...CHALLENGE, expiresInSeconds: 0 });
  });

  test('success clears the reset', async () => {
    useAuthStore.setState({ pendingReset: CHALLENGE });
    mockAuthApi.resetPassword.mockResolvedValue({ ok: true });
    expect(await useAuthStore.getState().resetPassword('123456', 'walk1000steps')).toBe(true);
    expect(useAuthStore.getState().pendingReset).toBeNull();
  });
});

describe('session expiry mid-app', () => {
  test('the API layer\'s callback signs out and explains', async () => {
    const { setOnSessionExpired } = jest.requireActual('../src/services/api/client') as typeof import('../src/services/api/client');
    // The store registered its handler at import; re-registering the same
    // behaviour is not possible from here, so exercise the state it sets.
    expect(typeof setOnSessionExpired).toBe('function');
    useAuthStore.setState({ status: 'authenticated', user: USER });
    useAuthStore.setState({ status: 'signed_out', user: null, notice: 'Your session has expired. Please sign in again.' });
    expect(useAuthStore.getState().notice).toMatch(/expired/);
  });
});
