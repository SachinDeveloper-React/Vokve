/**
 * "New to VOKVE?" — what the app does when Google or Apple names nobody
 * the server knows (RULES O15).
 *
 * The case it exists for: a member with an email account presses "Sign in
 * with Apple" on a new phone and hides their address. The relay address
 * matches nothing, and before this the server quietly made a second, empty
 * account. Now the store holds the identity and asks; either answer ends
 * with one account per person.
 *
 * @format
 */

import { appleAuth } from '@invertase/react-native-apple-authentication';
import { Platform } from 'react-native';
import type { User } from '../src/types/models';

const mockAuthApi = {
  apple: jest.fn(),
  google: jest.fn(),
  signIn: jest.fn(),
  createFromIdentity: jest.fn(),
  signOut: jest.fn().mockResolvedValue({ ok: true }),
};
const mockAccountApi = { connectIdentity: jest.fn() };
const mockDeviceApi = { register: jest.fn() };
jest.mock('../src/services/api/endpoints', () => ({
  authApi: mockAuthApi,
  accountApi: mockAccountApi,
  userApi: { me: jest.fn() },
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
  readUser: jest.fn().mockResolvedValue(null),
  saveUser: jest.fn().mockResolvedValue(undefined),
  clearUser: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/services/secureStorage', () => ({ secureStorage: mockSecureStorage }));

const mockGoogleSheet = jest.fn();
jest.mock('../src/services/googleSignIn', () => ({
  signInWithGoogle: () => mockGoogleSheet(),
  forgetGoogleSession: jest.fn().mockResolvedValue(undefined),
}));

const { useAuthStore } = require('../src/stores/authStore') as typeof import('../src/stores/authStore');
const { ApiError } = jest.requireActual('../src/services/api/errors') as typeof import('../src/services/api/errors');

const performRequest = appleAuth.performRequest as jest.Mock;

const TOKENS = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 };
const USER = {
  id: 'usr_1', name: 'Rana Jay', email: 'rana@example.com', avatarUrl: null, heightCm: null,
  weightKg: null, dateOfBirth: null, phone: null, profileCompletedAt: null, gender: null, goal: 'stay_active',
  activityLevel: 'moderate', units: 'metric', streakDays: 0, weeklyGoalWorkouts: 4, createdAt: null,
  country: 'IN', phoneVerifiedAt: null, emailVerifiedAt: '2026-11-16T00:00:00Z', trustTier: 'normal',
} as User;

const notLinked = () =>
  new ApiError(
    'unknown',
    'There is no VOKVE account for this Apple ID yet.',
    409,
    { provider: 'apple', email: 'x7k2p9@privaterelay.appleid.com', linkToken: 'link-1', expiresInSeconds: 900 },
    'IDENTITY_NOT_LINKED',
  );

const flush = () => new Promise(resolve => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  mockDeviceApi.register.mockResolvedValue({ deviceId: 'dev_1', trustTier: 'normal', mustUpgrade: false, minVersion: '1.0.0' });
  performRequest.mockResolvedValue({ identityToken: 'id-token', nonce: 'raw-nonce', fullName: null });
  useAuthStore.setState({
    status: 'signed_out', user: null, isSubmitting: false, error: null, notice: null,
    pendingIdentity: null, identityLinkOutcome: null,
  });
});

describe('an Apple ID the server does not know', () => {
  test('is a question, not an error — and no account is made yet', async () => {
    mockAuthApi.apple.mockRejectedValueOnce(notLinked());

    await expect(useAuthStore.getState().signInWithApple()).resolves.toBe(false);

    expect(mockAuthApi.apple).toHaveBeenCalledWith(expect.objectContaining({ ifNew: 'ask' }));
    expect(useAuthStore.getState()).toMatchObject({
      status: 'signed_out',
      error: null,
      isSubmitting: false,
      pendingIdentity: {
        provider: 'apple',
        email: 'x7k2p9@privaterelay.appleid.com',
        linkToken: 'link-1',
        stage: 'choose',
      },
    });
  });

  test('Google asks too', async () => {
    mockGoogleSheet.mockResolvedValueOnce({ kind: 'signed_in', idToken: 'g-token' });
    mockAuthApi.google.mockRejectedValueOnce(notLinked());

    await expect(useAuthStore.getState().signInWithGoogle()).resolves.toBe(false);

    expect(mockAuthApi.google).toHaveBeenCalledWith('g-token', 'ask');
    expect(useAuthStore.getState().pendingIdentity?.stage).toBe('choose');
  });
});

describe('"Create a new account"', () => {
  test('makes it from the link token and signs in', async () => {
    mockAuthApi.apple.mockRejectedValueOnce(notLinked());
    await useAuthStore.getState().signInWithApple();
    mockAuthApi.createFromIdentity.mockResolvedValueOnce({ user: USER, tokens: TOKENS });

    await expect(useAuthStore.getState().createAccountFromIdentity()).resolves.toBe(true);

    expect(mockAuthApi.createFromIdentity).toHaveBeenCalledWith('link-1');
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', user: USER, pendingIdentity: null });
    expect(mockAccountApi.connectIdentity).not.toHaveBeenCalled();
  });

  test('an expired choice closes the sheet and says so', async () => {
    mockAuthApi.apple.mockRejectedValueOnce(notLinked());
    await useAuthStore.getState().signInWithApple();
    mockAuthApi.createFromIdentity.mockRejectedValueOnce(
      new ApiError('unknown', 'That sign-in has expired.', 410, null, 'IDENTITY_LINK_EXPIRED'),
    );

    await expect(useAuthStore.getState().createAccountFromIdentity()).resolves.toBe(false);

    expect(useAuthStore.getState().pendingIdentity).toBeNull();
    expect(useAuthStore.getState().error?.message).toBe('That sign-in has expired.');
  });
});

describe('"I already have an account"', () => {
  test('connects Apple to the account the member then signs in to', async () => {
    mockAuthApi.apple.mockRejectedValueOnce(notLinked());
    await useAuthStore.getState().signInWithApple();
    useAuthStore.getState().keepIdentityForExistingAccount();
    expect(useAuthStore.getState().pendingIdentity?.stage).toBe('link');

    mockAuthApi.signIn.mockResolvedValueOnce({ user: USER, tokens: TOKENS });
    mockAccountApi.connectIdentity.mockResolvedValueOnce({ password: true, providers: [] });
    await expect(useAuthStore.getState().signIn('rana@example.com', 'walk1000steps')).resolves.toBe(true);
    await flush();

    expect(mockAccountApi.connectIdentity).toHaveBeenCalledWith('link-1');
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      pendingIdentity: null,
      identityLinkOutcome: { tone: 'success', title: 'Apple connected' },
    });
  });

  test('a refusal leaves the member signed in and says why', async () => {
    mockAuthApi.apple.mockRejectedValueOnce(notLinked());
    await useAuthStore.getState().signInWithApple();
    useAuthStore.getState().keepIdentityForExistingAccount();
    mockAuthApi.signIn.mockResolvedValueOnce({ user: USER, tokens: TOKENS });
    mockAccountApi.connectIdentity.mockRejectedValueOnce(
      new ApiError('unknown', 'This Apple ID already signs in to another VOKVE account (x•••@privaterelay.appleid.com).', 409, null, 'IDENTITY_IN_USE'),
    );

    await useAuthStore.getState().signIn('rana@example.com', 'walk1000steps');
    await flush();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      identityLinkOutcome: {
        tone: 'error',
        title: 'Apple was not connected',
        message: expect.stringContaining('x•••@privaterelay.appleid.com'),
      },
    });
  });

  test('a choice left too long is not sent', async () => {
    mockAuthApi.apple.mockRejectedValueOnce(notLinked());
    await useAuthStore.getState().signInWithApple();
    useAuthStore.getState().keepIdentityForExistingAccount();
    const pending = useAuthStore.getState().pendingIdentity!;
    useAuthStore.setState({ pendingIdentity: { ...pending, expiresAt: Date.now() - 1 } });
    mockAuthApi.signIn.mockResolvedValueOnce({ user: USER, tokens: TOKENS });

    await useAuthStore.getState().signIn('rana@example.com', 'walk1000steps');
    await flush();

    expect(mockAccountApi.connectIdentity).not.toHaveBeenCalled();
    expect(useAuthStore.getState().identityLinkOutcome).toMatchObject({ tone: 'error' });
  });

  test('a password sign-in is not an Apple session, whatever came before (RULES O16)', async () => {
    const { rememberAppleUser, rememberedAppleUser } = require('../src/services/appleCredential');
    rememberAppleUser('001234.apple-sub');
    mockAuthApi.signIn.mockResolvedValueOnce({ user: USER, tokens: TOKENS });

    await useAuthStore.getState().signIn('rana@example.com', 'walk1000steps');

    expect(rememberedAppleUser()).toBeNull();
  });

  test('"Create a new account" from an Apple sheet is an Apple session', async () => {
    const { forgetAppleUser, rememberedAppleUser } = require('../src/services/appleCredential');
    forgetAppleUser();
    performRequest.mockResolvedValueOnce({ identityToken: 'id-token', nonce: 'raw-nonce', fullName: null, user: '001234.apple-sub', authorizationCode: 'c' });
    mockAuthApi.apple.mockRejectedValueOnce(notLinked());
    await useAuthStore.getState().signInWithApple();
    mockAuthApi.createFromIdentity.mockResolvedValueOnce({ user: USER, tokens: TOKENS });

    await useAuthStore.getState().createAccountFromIdentity();

    expect(rememberedAppleUser()).toBe('001234.apple-sub');
  });

  test('a question never answered connects nothing', async () => {
    mockAuthApi.apple.mockRejectedValueOnce(notLinked());
    await useAuthStore.getState().signInWithApple();
    mockAuthApi.signIn.mockResolvedValueOnce({ user: USER, tokens: TOKENS });

    await useAuthStore.getState().signIn('rana@example.com', 'walk1000steps');
    await flush();

    expect(mockAccountApi.connectIdentity).not.toHaveBeenCalled();
    expect(useAuthStore.getState().pendingIdentity).toBeNull();
  });
});
