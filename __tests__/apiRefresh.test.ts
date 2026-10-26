/**
 * The one place a session can end without anybody asking: a 401 whose
 * refresh does not come back with tokens.
 *
 * It used to end there whatever the reason — and "the refresh request
 * failed" is mostly not the server refusing anything. A member whose access
 * token ran out while the train was in a tunnel was signed out for it, which
 * is the same mistake as putting a connection screen in front of a phone
 * that is holding the day's steps (`offlineSession.test.ts`). So the two
 * failures are told apart here, and only a refusal ends the session.
 *
 * @format
 */

import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { ApiError } from '../src/services/api/errors';

const mockSecureStorage = {
  readTokens: jest.fn(),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  readUser: jest.fn().mockResolvedValue(null),
  saveUser: jest.fn().mockResolvedValue(undefined),
  clearUser: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/services/secureStorage', () => ({
  secureStorage: mockSecureStorage,
}));

// Required rather than imported: the client reads `secureStorage` the moment
// it is loaded, and a static import would load it before the mock above has
// been assigned.
const { apiClient, setOnSessionExpired } =
  require('../src/services/api/client') as typeof import('../src/services/api/client');

const TOKENS = { accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() };
const FRESH = { accessToken: 'new', refreshToken: 'r2', expiresAt: Date.now() + 60_000 };

/** What the adapter answers, in order; anything after the list is a 200. */
let answers: Array<{ status: number; data?: unknown }> = [];
let sent: InternalAxiosRequestConfig[] = [];
const expired = jest.fn();

const refused = (status: number, config: InternalAxiosRequestConfig) =>
  new AxiosError('Refused', String(status), config, {}, {
    status,
    statusText: '',
    data: {},
    headers: {},
    config,
  });

beforeAll(() => {
  // A custom adapter has to settle the status itself: axios only applies
  // `validateStatus` inside the adapters it ships with.
  apiClient.defaults.adapter = async config => {
    sent.push(config);
    const answer = answers.shift() ?? { status: 200, data: {} };
    if (answer.status >= 400) {
      throw refused(answer.status, config);
    }
    return {
      data: answer.data ?? {},
      status: answer.status,
      statusText: '',
      headers: {},
      config,
    };
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  answers = [];
  sent = [];
  mockSecureStorage.readTokens.mockResolvedValue(TOKENS);
  // Storage as the real thing behaves: what the refresh saves is what the
  // request interceptor reads on the replay.
  mockSecureStorage.saveTokens.mockImplementation(async saved => {
    mockSecureStorage.readTokens.mockResolvedValue(saved);
  });
  setOnSessionExpired(expired);
});

afterEach(() => {
  jest.restoreAllMocks();
  setOnSessionExpired(null);
});

/**
 * What the bare `axios.post` behind the refresh answers — bare so it misses
 * the interceptors above. A factory, not a promise: a rejected promise built
 * before the call is an unhandled rejection until the client gets to it.
 */
const refreshAnswers = (answer: () => Promise<unknown>) =>
  jest.spyOn(axios, 'post').mockImplementation(answer as never);

test('a refreshed session replays the request with the new token', async () => {
  answers = [{ status: 401 }, { status: 200, data: { ok: true } }];
  refreshAnswers(() => Promise.resolve({ data: FRESH }));

  const response = await apiClient.get('/me');

  expect(response.data).toEqual({ ok: true });
  expect(sent[1].headers.Authorization).toBe('Bearer new');
  expect(mockSecureStorage.saveTokens).toHaveBeenCalledWith(FRESH);
  expect(expired).not.toHaveBeenCalled();
});

test('a refresh the server refuses ends the session', async () => {
  answers = [{ status: 401 }];
  const config = { headers: {} } as InternalAxiosRequestConfig;
  refreshAnswers(() => Promise.reject(refused(401, config)));

  await expect(apiClient.get('/me')).rejects.toBeInstanceOf(ApiError);

  expect(mockSecureStorage.clearTokens).toHaveBeenCalled();
  expect(expired).toHaveBeenCalled();
});

test('a refresh that never reached the server keeps it', async () => {
  answers = [{ status: 401 }];
  refreshAnswers(() =>
    Promise.reject(
      new AxiosError(
        'Network Error',
        'ERR_NETWORK',
        { headers: {} } as InternalAxiosRequestConfig,
      ),
    ),
  );

  // The caller still fails — there is nothing to show it — but the member is
  // not signed out on the way.
  await expect(apiClient.get('/me')).rejects.toBeInstanceOf(ApiError);

  expect(mockSecureStorage.clearTokens).not.toHaveBeenCalled();
  expect(expired).not.toHaveBeenCalled();
});

test('a captive portal answering the refresh keeps it too', async () => {
  answers = [{ status: 401 }];
  refreshAnswers(() =>
    Promise.resolve({ data: '<html>Sign in to WiFi</html>' }),
  );

  await expect(apiClient.get('/me')).rejects.toBeInstanceOf(ApiError);

  expect(mockSecureStorage.clearTokens).not.toHaveBeenCalled();
  expect(expired).not.toHaveBeenCalled();
});

test('a session with no tokens left at all is over', async () => {
  answers = [{ status: 401 }];
  mockSecureStorage.readTokens.mockResolvedValue(null);

  await expect(apiClient.get('/me')).rejects.toBeInstanceOf(ApiError);

  expect(expired).toHaveBeenCalled();
});
