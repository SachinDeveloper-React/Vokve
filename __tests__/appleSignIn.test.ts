/**
 * Signing in with Apple, from the press to the session (RULES O13).
 *
 * The native library is the double in jest.setup.js; what is checked here
 * is what the app does with each of its answers on each platform — that
 * the token goes up with the raw nonce it was minted for, that the name
 * Apple hands over once is not dropped, and that backing out of the sheet
 * puts nothing red on the screen.
 *
 * @format
 */

import { Platform } from 'react-native';
import {
  appleAuth,
  appleAuthAndroid,
} from '@invertase/react-native-apple-authentication';
import { config } from '../src/constants/config';
import { signInWithApple } from '../src/services/appleSignIn';
import type { User } from '../src/types/models';

const mockAuthApi = {
  apple: jest.fn(),
  signOut: jest.fn().mockResolvedValue({ ok: true }),
};
const mockDeviceApi = { register: jest.fn() };
jest.mock('../src/services/api/endpoints', () => ({
  authApi: mockAuthApi,
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

const { useAuthStore } = require('../src/stores/authStore') as typeof import('../src/stores/authStore');

const performRequest = appleAuth.performRequest as jest.Mock;
const androidSignIn = appleAuthAndroid.signIn as jest.Mock;
const androidConfigure = appleAuthAndroid.configure as jest.Mock;
const mutableConfig = config as { appleServiceId: string | null };

const TOKENS = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 };
const USER = {
  id: 'usr_1', name: 'Rana Jay', email: 'x@privaterelay.appleid.com', avatarUrl: null, heightCm: null,
  weightKg: null, dateOfBirth: null, phone: null, profileCompletedAt: null, gender: null, goal: 'stay_active',
  activityLevel: 'moderate', units: 'metric', streakDays: 0, weeklyGoalWorkouts: 4, createdAt: null,
  country: 'IN', phoneVerifiedAt: null, emailVerifiedAt: '2026-11-16T00:00:00Z', trustTier: 'normal',
} as User;

const appleError = (code: string) => Object.assign(new Error(`Apple ${code}`), { code });

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  mutableConfig.appleServiceId = 'com.vokve.fitness.signin';
  mockDeviceApi.register.mockResolvedValue({ deviceId: 'dev_1', trustTier: 'normal', mustUpgrade: false, minVersion: '1.0.0' });
  useAuthStore.setState({ status: 'signed_out', user: null, isSubmitting: false, error: null, notice: null });
});

afterAll(() => {
  Platform.OS = 'ios';
});

describe('on iPhone', () => {
  test('asks for the name and the email, and returns the token with its raw nonce', async () => {
    performRequest.mockResolvedValueOnce({
      identityToken: 'id-token',
      nonce: 'raw-nonce',
      fullName: { givenName: ' Rana ', familyName: 'Jay' },
      user: '001234.apple-sub',
      authorizationCode: 'one-time-code',
    });

    await expect(signInWithApple()).resolves.toEqual({
      kind: 'signed_in',
      idToken: 'id-token',
      nonce: 'raw-nonce',
      fullName: { givenName: 'Rana', familyName: 'Jay' },
      // What a deletion revokes with, and what the credential check asks about (O16).
      authorizationCode: 'one-time-code',
      appleUser: '001234.apple-sub',
    });
    expect(performRequest).toHaveBeenCalledWith({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
    });
  });

  test('a later sign-in has no name, and says so with null rather than empty strings', async () => {
    performRequest.mockResolvedValueOnce({
      identityToken: 'id-token',
      nonce: 'raw-nonce',
      fullName: { givenName: null, familyName: null },
    });

    await expect(signInWithApple()).resolves.toMatchObject({ fullName: null });
  });

  test('backing out is a cancel, not a failure', async () => {
    performRequest.mockRejectedValueOnce(appleError('1001'));
    await expect(signInWithApple()).resolves.toEqual({ kind: 'cancelled' });
  });

  test('error 1000 — no capability, or no Apple ID — says what to check', async () => {
    performRequest.mockRejectedValueOnce(appleError('1000'));
    await expect(signInWithApple()).resolves.toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('Apple ID'),
    });
  });
});

describe('on Android', () => {
  beforeEach(() => {
    Platform.OS = 'android';
  });

  test('opens Apple’s web flow with the Services ID, leaving the nonce to the native side', async () => {
    androidSignIn.mockResolvedValueOnce({
      id_token: 'id-token',
      nonce: 'raw-uuid-nonce',
      state: 's',
      code: 'c',
      user: { name: { firstName: 'Rana', lastName: 'Jay' }, email: 'rana@example.com' },
    });

    await expect(signInWithApple()).resolves.toEqual({
      kind: 'signed_in',
      idToken: 'id-token',
      nonce: 'raw-uuid-nonce',
      fullName: { givenName: 'Rana', familyName: 'Jay' },
      authorizationCode: 'c',
      // The web flow does not hand over Apple's id, and Android has no
      // credential check to use it for.
      appleUser: null,
    });
    const options = androidConfigure.mock.calls[0][0];
    expect(options).toMatchObject({
      clientId: 'com.vokve.fitness.signin',
      redirectUri: config.appleRedirectUri,
    });
    // A nonce passed in would be one made in JavaScript, which has no
    // secure random source here; the native side's UUID is.
    expect(options).not.toHaveProperty('nonce');
  });

  test('closing the WebView is a cancel — the module puts that in the message', async () => {
    androidSignIn.mockRejectedValueOnce(new Error('E_SIGNIN_CANCELLED_ERROR'));
    await expect(signInWithApple()).resolves.toEqual({ kind: 'cancelled' });
  });

  test('a build with no Services ID says so instead of opening a flow Apple will refuse', async () => {
    mutableConfig.appleServiceId = null;
    await expect(signInWithApple()).resolves.toMatchObject({
      kind: 'failed',
      message: 'Apple sign-in is not set up for this build of the app.',
    });
    expect(androidSignIn).not.toHaveBeenCalled();
  });
});

describe('the store', () => {
  test('sends the token, the nonce and the first-time name, then signs in', async () => {
    performRequest.mockResolvedValueOnce({
      identityToken: 'id-token',
      nonce: 'raw-nonce',
      fullName: { givenName: 'Rana', familyName: 'Jay' },
    });
    mockAuthApi.apple.mockResolvedValueOnce({ user: USER, tokens: TOKENS });

    await expect(useAuthStore.getState().signInWithApple()).resolves.toBe(true);

    expect(mockAuthApi.apple).toHaveBeenCalledWith({
      idToken: 'id-token',
      nonce: 'raw-nonce',
      fullName: { givenName: 'Rana', familyName: 'Jay' },
      // A new identity is a question, not a second account (RULES O15).
      ifNew: 'ask',
    });
    expect(mockSecureStorage.saveTokens).toHaveBeenCalledWith(TOKENS);
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', user: USER, error: null, isSubmitting: false });
  });

  test('remembers whose Apple session this is, for the credential check (RULES O16)', async () => {
    const { rememberedAppleUser, forgetAppleUser } = require('../src/services/appleCredential');
    forgetAppleUser();
    performRequest.mockResolvedValueOnce({
      identityToken: 'id-token',
      nonce: 'raw-nonce',
      fullName: null,
      user: '001234.apple-sub',
      authorizationCode: 'code',
    });
    mockAuthApi.apple.mockResolvedValueOnce({ user: USER, tokens: TOKENS });

    await useAuthStore.getState().signInWithApple();

    expect(rememberedAppleUser()).toBe('001234.apple-sub');
  });

  test('a cancel leaves nothing on the screen and nothing sent', async () => {
    performRequest.mockRejectedValueOnce(appleError('1001'));

    await expect(useAuthStore.getState().signInWithApple()).resolves.toBe(false);

    expect(mockAuthApi.apple).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_out', error: null, isSubmitting: false });
  });

  test('the server’s refusal is shown in its own words', async () => {
    const { ApiError } = jest.requireActual('../src/services/api/errors');
    mockAuthApi.apple.mockRejectedValueOnce(
      new ApiError('unauthorized', 'Apple did not share an email address for this account.', 401, null, 'APPLE_EMAIL_MISSING'),
    );

    await expect(useAuthStore.getState().signInWithApple()).resolves.toBe(false);

    expect(useAuthStore.getState().error?.message).toBe('Apple did not share an email address for this account.');
    expect(useAuthStore.getState().status).toBe('signed_out');
  });
});
