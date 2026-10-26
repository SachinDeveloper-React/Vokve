/**
 * What happens when the app is opened with no network and a session already
 * on the phone.
 *
 * The complaint this answers: the app showed a connection screen, so a
 * member in a lift, on a train or in a basement gym could not see the steps
 * their own phone had just counted. The fix is that a session the server
 * cannot confirm is drawn from the stored snapshot instead — and the reason
 * that is safe is the other half tested here: the server is asked again, and
 * its answer still decides.
 *
 * @format
 */

import { ApiError } from '../src/services/api/errors';
import type { User } from '../src/types/models';

const mockAuthApi = { signOut: jest.fn().mockResolvedValue({ ok: true }) };
const mockUserApi = { me: jest.fn() };
const mockDeviceApi = { register: jest.fn() };

/**
 * Every other endpoint group. A restored session fills the same caches as a
 * confirmed one, and offline every one of those reads fails — which is the
 * state under test, not a problem with it.
 */
const mockOfflineGroup = () =>
  new Proxy(
    {},
    { get: () => () => Promise.reject(new ApiError('network', 'Offline.')) },
  );
const mockGroupNames = [
  'telemetryApi', 'walletApi', 'settingsApi', 'workoutApi', 'activityApi',
  'shopApi', 'wishlistApi', 'cartApi', 'checkoutApi', 'orderApi',
  'referralApi', 'streakApi', 'challengeApi', 'leaderboardApi',
  'hydrationApi', 'contentApi', 'nutritionApi', 'vitalsApi', 'addressApi',
  'notificationPreferencesApi', 'notificationApi', 'accountApi',
  'supportApi', 'appApi',
];

jest.mock('../src/services/api/endpoints', () => {
  const groups: Record<string, unknown> = {
    authApi: mockAuthApi,
    userApi: mockUserApi,
    deviceApi: mockDeviceApi,
  };
  for (const name of mockGroupNames) {
    groups[name] = mockOfflineGroup();
  }
  return groups;
});

const mockSecureStorage = {
  readTokens: jest.fn(),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  readUser: jest.fn(),
  saveUser: jest.fn().mockResolvedValue(undefined),
  clearUser: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/services/secureStorage', () => ({
  secureStorage: mockSecureStorage,
}));

const { useAuthStore } = require('../src/stores/authStore') as typeof import('../src/stores/authStore');
const { useOnboardingStore } = require('../src/stores/onboardingStore') as typeof import('../src/stores/onboardingStore');

const TOKENS = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 };
const MEMBER: User = {
  id: 'usr_1', name: 'Asha', email: 'asha@example.com', avatarUrl: null, heightCm: 164,
  weightKg: 58, dateOfBirth: null, phone: '+919876543210',
  profileCompletedAt: '2026-09-20T00:00:00Z', gender: 'female', goal: 'stay_active',
  activityLevel: 'moderate', units: 'metric', streakDays: 3, weeklyGoalWorkouts: 4,
  createdAt: null, country: 'IN', phoneVerifiedAt: '2026-09-14T00:00:00Z',
  emailVerifiedAt: null, trustTier: 'normal',
};
const noConnection = () => new ApiError('network', 'No connection.');
const revoked = () =>
  new ApiError('unauthorized', 'Please sign in again.', 401, null, 'UNAUTHORIZED');

beforeEach(() => {
  jest.clearAllMocks();
  mockDeviceApi.register.mockResolvedValue({
    deviceId: 'dev_1', trustTier: 'normal', mustUpgrade: false, minVersion: '1.0.0',
  });
  mockSecureStorage.readTokens.mockResolvedValue(TOKENS);
  mockSecureStorage.readUser.mockResolvedValue(null);
  // The phone has been through the permission screens for this account.
  useOnboardingStore.setState({ permissionsDoneFor: [MEMBER.id] });
  useAuthStore.setState({
    status: 'idle', user: null, pendingVerification: null, pendingReset: null,
    isSessionUnconfirmed: false, isSubmitting: false, error: null, notice: null,
  });
});

describe('a launch with no network', () => {
  test('opens the app on the stored member instead of a retry screen', async () => {
    mockUserApi.me.mockRejectedValue(noConnection());
    mockSecureStorage.readUser.mockResolvedValue(MEMBER);

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      user: MEMBER,
      isSessionUnconfirmed: true,
      isSubmitting: false,
    });
    // The session was not refused, so nothing of it is thrown away.
    expect(mockSecureStorage.clearTokens).not.toHaveBeenCalled();
    expect(mockSecureStorage.clearUser).not.toHaveBeenCalled();
  });

  test('a server that is up but broken is restored the same way', async () => {
    mockUserApi.me.mockRejectedValue(
      new ApiError('server', 'Down.', 503, null, 'INTERNAL'),
    );
    mockSecureStorage.readUser.mockResolvedValue(MEMBER);

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().isSessionUnconfirmed).toBe(true);
  });

  test('with nothing stored it is still the retry screen', async () => {
    mockUserApi.me.mockRejectedValue(noConnection());

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'unreachable',
      user: null,
      isSessionUnconfirmed: false,
    });
    expect(useAuthStore.getState().error?.kind).toBe('network');
  });

  /**
   * Both of these end at a gate the member cannot pass offline — onboarding
   * and the step goal both finish with a request — so opening the app on
   * them would be a worse answer than saying there is no connection.
   */
  test('a snapshot the server never stamped as complete is not restored', async () => {
    mockUserApi.me.mockRejectedValue(noConnection());
    mockSecureStorage.readUser.mockResolvedValue({
      ...MEMBER,
      profileCompletedAt: null,
    });

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().status).toBe('unreachable');
  });

  test('a phone that has not been through the permission screens is not restored', async () => {
    mockUserApi.me.mockRejectedValue(noConnection());
    mockSecureStorage.readUser.mockResolvedValue(MEMBER);
    useOnboardingStore.setState({ permissionsDoneFor: [] });

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().status).toBe('unreachable');
  });
});

describe('the snapshot itself', () => {
  test('is written whenever the session\'s member changes', async () => {
    mockUserApi.me.mockResolvedValue(MEMBER);

    await useAuthStore.getState().hydrate();

    expect(mockSecureStorage.saveUser).toHaveBeenCalledWith(MEMBER);
    expect(useAuthStore.getState().isSessionUnconfirmed).toBe(false);
  });

  test('is forgotten when the session ends', async () => {
    mockUserApi.me.mockRejectedValue(revoked());

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().status).toBe('signed_out');
    expect(mockSecureStorage.clearTokens).toHaveBeenCalled();
    expect(mockSecureStorage.clearUser).toHaveBeenCalled();
  });

  test('is not read, or kept, when there are no tokens at all', async () => {
    mockSecureStorage.readTokens.mockResolvedValue(null);

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().status).toBe('signed_out');
    expect(mockSecureStorage.readUser).not.toHaveBeenCalled();
    expect(mockSecureStorage.clearUser).toHaveBeenCalled();
  });
});

describe('asking the server again', () => {
  test('keeps the app on screen while it runs, then confirms the session', async () => {
    mockUserApi.me
      .mockRejectedValueOnce(noConnection())
      .mockResolvedValueOnce({ ...MEMBER, streakDays: 4 });
    mockSecureStorage.readUser.mockResolvedValue(MEMBER);

    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().isSessionUnconfirmed).toBe(true);

    const again = useAuthStore.getState().hydrate();
    // Never the splash, and never the connection screen: the member is in
    // the app, and the retry is a spinner at most.
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      isSubmitting: true,
    });
    await again;

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      isSessionUnconfirmed: false,
      isSubmitting: false,
    });
    expect(useAuthStore.getState().user?.streakDays).toBe(4);
  });

  test('ends a session that was revoked while the phone was away', async () => {
    mockUserApi.me.mockRejectedValueOnce(noConnection()).mockRejectedValueOnce(revoked());
    mockSecureStorage.readUser.mockResolvedValue(MEMBER);

    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe('authenticated');

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'signed_out',
      user: null,
      isSessionUnconfirmed: false,
    });
    expect(useAuthStore.getState().notice).toMatch(/session has expired/);
    expect(mockSecureStorage.clearTokens).toHaveBeenCalled();
    expect(mockSecureStorage.clearUser).toHaveBeenCalled();
  });
});
