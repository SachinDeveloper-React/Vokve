/**
 * Every way a session can end has to end it the same way.
 *
 * There are three: the user pressing Sign out, the server rejecting the
 * stored session at launch, and a refresh failing mid-session. Only the
 * first used to stop counting, so an automatic sign-out left the foreground
 * service running — the app showed the sign-in screen while the notification
 * went on counting steps for nobody.
 *
 * @format
 */

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
jest.mock('../src/services/api/endpoints', () => ({
  authApi: mockAuthApi,
  userApi: mockUserApi,
  deviceApi: mockDeviceApi,
  walletApi: {
    get: jest.fn().mockRejectedValue(new Error('no wallet in test')),
    transactions: jest.fn().mockRejectedValue(new Error('no wallet in test')),
    earnRules: jest.fn(),
  },
  workoutApi: {},
  activityApi: {},
}));

const mockSecureStorage = {
  readTokens: jest.fn(),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  // No snapshot of the member, so a session the server cannot confirm has
  // nothing to open the app on — which is what these tests are about. The
  // offline restore has its own file.
  readUser: jest.fn().mockResolvedValue(null),
  saveUser: jest.fn().mockResolvedValue(undefined),
  clearUser: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/services/secureStorage', () => ({ secureStorage: mockSecureStorage }));

// The two things an ending must do to the phone itself. A factory may only
// reach variables whose names begin with `mock`, which is why they do.
const mockStopSteps = jest.fn().mockResolvedValue(undefined);
const mockStopWhenSignedOut = jest.fn().mockResolvedValue(undefined);
const mockFlushSteps = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/services/steps', () => ({
  stopStepsForSignOut: mockStopSteps,
  stopStepsWhenSignedOut: mockStopWhenSignedOut,
  flushStepsForSignOut: mockFlushSteps,
}));

const mockCancelReminders = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/services/notifications', () => ({ cancelHydrationReminders: mockCancelReminders }));

const mockUnregisterPush = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/services/push', () => ({
  registerForPush: jest.fn(),
  unregisterFromPush: mockUnregisterPush,
}));

// The handler the API layer calls when a refresh fails: captured here,
// because it is the only way in to the third ending.
const mockExpiry: { handler: (() => void) | null } = { handler: null };
jest.mock('../src/services/api/client', () => ({
  ...jest.requireActual('../src/services/api/client'),
  setOnSessionExpired: (handler: (() => void) | null) => {
    mockExpiry.handler = handler;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ApiError } = require('../src/services/api/errors') as typeof import('../src/services/api/errors');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useAuthStore } = require('../src/stores/authStore') as typeof import('../src/stores/authStore');

const TOKENS = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 };
const rejected = () => new ApiError('unauthorized', 'Please sign in again.', 401, null, 'UNAUTHORIZED');

beforeEach(() => {
  jest.clearAllMocks();
  mockDeviceApi.register.mockResolvedValue({
    deviceId: 'dev_1', trustTier: 'normal', mustUpgrade: false, minVersion: '1.0.0',
  });
  mockSecureStorage.readTokens.mockResolvedValue(TOKENS);
  useAuthStore.setState({
    status: 'authenticated', user: null, pendingVerification: null, pendingReset: null,
    isSubmitting: false, error: null, notice: null,
  });
});

describe('every ending stops the counter', () => {
  test('the sign-out button', async () => {
    await useAuthStore.getState().signOut();
    expect(mockStopSteps).toHaveBeenCalledTimes(1);
    expect(mockCancelReminders).toHaveBeenCalledTimes(1);
    expect(mockSecureStorage.clearTokens).toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_out', user: null, notice: null });
  });

  /**
   * Counting stops at the sign-out (D-56), so the stretch since the last
   * sync is the account's and nothing else will ever send it. It has to go
   * up while the tokens still work — afterwards the only way out is this
   * same account signing back in on this same phone, and if they sign in on
   * another one the day shown there is missing this phone's tail for good.
   */
  test('sends what this phone walked before the tokens are cleared', async () => {
    const order: string[] = [];
    mockFlushSteps.mockImplementationOnce(async () => {
      order.push('flush');
    });
    mockSecureStorage.clearTokens.mockImplementationOnce(async () => {
      order.push('clearTokens');
    });

    await useAuthStore.getState().signOut();

    expect(mockFlushSteps).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['flush', 'clearTokens']);
  });

  test('a sync that will not finish still lets the user leave', async () => {
    mockFlushSteps.mockRejectedValueOnce(new Error('no network'));

    await expect(useAuthStore.getState().signOut()).resolves.toBeUndefined();

    expect(mockSecureStorage.clearTokens).toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_out' });
  });

  test('an ending the user did not ask for has no tokens to send with, so it does not try', async () => {
    // A refresh that failed mid-session: the tokens are already dead, so
    // there is nothing a sync could use and nothing to wait for.
    mockExpiry.handler?.();
    await new Promise(resolve => setImmediate(resolve));

    expect(mockStopSteps).toHaveBeenCalledTimes(1);
    expect(mockFlushSteps).not.toHaveBeenCalled();
  });

  test('a session the server rejects at launch', async () => {
    mockUserApi.me.mockRejectedValue(rejected());
    await useAuthStore.getState().hydrate();
    // The bug: this path cleared the tokens and left the service counting.
    expect(mockStopSteps).toHaveBeenCalledTimes(1);
    expect(mockCancelReminders).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_out', isSubmitting: false });
    expect(useAuthStore.getState().notice).toMatch(/session has expired/);
  });

  test('a refresh that fails mid-session', async () => {
    expect(mockExpiry.handler).toBeInstanceOf(Function);
    mockExpiry.handler?.();
    await new Promise(resolve => setImmediate(resolve));
    expect(mockStopSteps).toHaveBeenCalledTimes(1);
    expect(mockSecureStorage.clearTokens).toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_out', user: null });
    expect(useAuthStore.getState().notice).toMatch(/session has expired/);
  });

  test('every request in flight calling it at once ends the session once', async () => {
    mockExpiry.handler?.();
    mockExpiry.handler?.();
    mockExpiry.handler?.();
    await new Promise(resolve => setImmediate(resolve));
    expect(mockStopSteps).toHaveBeenCalledTimes(1);
  });

  test('counting that will not stop does not keep anybody signed in', async () => {
    mockStopSteps.mockRejectedValueOnce(new Error('the service would not die'));
    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState().status).toBe('signed_out');
    expect(mockSecureStorage.clearTokens).toHaveBeenCalled();
  });

  test('a launch with no session at all still asks the service to stop', async () => {
    // The repair path: a phone signed out before this shipped is still
    // counting, and nothing but a launch will ever ask it to stop.
    mockSecureStorage.readTokens.mockResolvedValue(null);
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe('signed_out');
    expect(mockStopWhenSignedOut).toHaveBeenCalledTimes(1);
    // Not the sign-out stop: that stamps the day, and a launch is not a
    // sign-out (D-56).
    expect(mockStopSteps).not.toHaveBeenCalled();
    expect(mockSecureStorage.clearTokens).not.toHaveBeenCalled();
  });

  test('a session nothing refused is left alone — a train tunnel is not a sign-out', async () => {
    mockUserApi.me.mockRejectedValue(new ApiError('network', 'No connection.'));
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe('unreachable');
    expect(mockStopSteps).not.toHaveBeenCalled();
    expect(mockSecureStorage.clearTokens).not.toHaveBeenCalled();
  });
});
