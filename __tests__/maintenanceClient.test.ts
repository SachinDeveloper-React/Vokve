/**
 * How the app learns of maintenance from any request, not only from its
 * own check (RULES DV14): a refusal with 503 `MAINTENANCE` puts the screen
 * up at once, and an answer carrying `X-Vokve-Maintenance: bypass` — the
 * server letting a tester through — puts up the strip.
 *
 * @format
 */

import { AxiosError, type InternalAxiosRequestConfig } from 'axios';

const mockSecureStorage = {
  readTokens: jest
    .fn()
    .mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 60_000,
    }),
  saveTokens: jest.fn().mockResolvedValue(undefined),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  readUser: jest.fn().mockResolvedValue(null),
  saveUser: jest.fn().mockResolvedValue(undefined),
  clearUser: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/services/secureStorage', () => ({
  secureStorage: mockSecureStorage,
}));

const { apiClient } =
  require('../src/services/api/client') as typeof import('../src/services/api/client');
const { useAppStatusStore } =
  require('../src/stores/appStatusStore') as typeof import('../src/stores/appStatusStore');

type Answer = {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
};
let answers: Answer[] = [];
let sent = 0;

beforeAll(() => {
  apiClient.defaults.adapter = async config => {
    sent += 1;
    const answer = answers.shift() ?? { status: 200, data: {} };
    const response = {
      status: answer.status,
      statusText: '',
      data: answer.data ?? {},
      headers: answer.headers ?? {},
      config,
    };
    if (answer.status >= 400) {
      throw new AxiosError(
        'Refused',
        String(answer.status),
        config as InternalAxiosRequestConfig,
        {},
        response,
      );
    }
    return response;
  };
});

beforeEach(() => {
  answers = [];
  sent = 0;
  useAppStatusStore.setState({ maintenance: null, maintenanceSignIn: false });
});

test('a maintenance refusal puts the screen up with its words, and is not retried', async () => {
  answers = [
    {
      status: 503,
      data: {
        error: {
          code: 'MAINTENANCE',
          message: 'Upgrading the servers.',
          details: { title: 'Back soon', endsAt: '2026-11-23T12:00:00.000Z' },
        },
      },
    },
  ];
  await expect(apiClient.get('/me')).rejects.toMatchObject({
    kind: 'maintenance',
  });
  expect(sent).toBe(1);
  expect(useAppStatusStore.getState().maintenance).toEqual({
    active: true,
    bypass: false,
    title: 'Back soon',
    message: 'Upgrading the servers.',
    endsAt: '2026-11-23T12:00:00.000Z',
  });
});

test('an answer let through maintenance puts up the strip, a refusal included', async () => {
  answers = [
    {
      status: 200,
      data: { ok: true },
      headers: { 'x-vokve-maintenance': 'bypass' },
    },
  ];
  await apiClient.get('/me');
  expect(useAppStatusStore.getState().maintenance).toMatchObject({
    active: true,
    bypass: true,
  });

  useAppStatusStore.setState({ maintenance: null });
  answers = [
    {
      status: 404,
      data: { error: { code: 'NOT_FOUND', message: 'Gone.' } },
      headers: { 'x-vokve-maintenance': 'bypass' },
    },
  ];
  await expect(apiClient.get('/orders/x')).rejects.toMatchObject({
    kind: 'not_found',
  });
  expect(useAppStatusStore.getState().maintenance).toMatchObject({
    active: true,
    bypass: true,
  });
});

test('an ordinary answer says nothing about maintenance', async () => {
  answers = [{ status: 200, data: {} }];
  await apiClient.get('/me');
  expect(useAppStatusStore.getState().maintenance).toBeNull();
});
