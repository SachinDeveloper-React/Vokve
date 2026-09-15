import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from 'axios';
import { z } from 'zod';
import { config } from '../../constants/config';
import { authTokensSchema, type AuthTokens } from '../../types/models';
import { logger } from '../../utils/logger';
import { secureStorage } from '../secureStorage';
import { ApiError, toApiError } from './errors';

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retryCount?: number;
  _isRetryAfterRefresh?: boolean;
  _isRetryAfterDeviceRegister?: boolean;
}

/**
 * Called when the session cannot be recovered. The auth store registers itself
 * here rather than the client importing the store, which would be a cycle.
 */
let onSessionExpired: (() => void) | null = null;

export function setOnSessionExpired(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/**
 * Called when the server retires this build (426). The app-status store
 * registers itself here, for the same no-cycle reason as above.
 */
let onUpgradeRequired: ((error: ApiError) => void) | null = null;

export function setOnUpgradeRequired(
  handler: ((error: ApiError) => void) | null,
): void {
  onUpgradeRequired = handler;
}

/**
 * The device module supplies these rather than being imported: it needs the
 * endpoints, the endpoints need this client, and this client needing the
 * device module would close the loop. Both are registered by `device.ts` at
 * import, which happens before the first request because the auth store
 * imports it.
 */
let requestHeadersProvider: () => Record<string, string> = () => ({});
let deviceReregistrar: ((tokens: AuthTokens | null) => Promise<string | null>) | null = null;

export function setRequestHeadersProvider(provider: () => Record<string, string>): void {
  requestHeadersProvider = provider;
}

export function setDeviceReregistrar(
  handler: ((tokens: AuthTokens | null) => Promise<string | null>) | null,
): void {
  deviceReregistrar = handler;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: config.requestTimeoutMs,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use(async requestConfig => {
  const tokens = await secureStorage.readTokens();
  if (tokens) {
    requestConfig.headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  // Device, version and timezone on every call (BACKEND.md §3.8): fraud,
  // support and the local-day boundary all start from these.
  for (const [name, value] of Object.entries(requestHeadersProvider())) {
    requestConfig.headers.set(name, value);
  }
  return requestConfig;
});

/**
 * A single in-flight refresh shared by every request that got a 401. Without
 * this, an app that fires several requests on launch would run one refresh per
 * request, and all but one of the new refresh tokens would be invalidated.
 */
let refreshPromise: Promise<AuthTokens | null> | null = null;

async function refreshTokens(): Promise<AuthTokens | null> {
  const current = await secureStorage.readTokens();
  if (!current) {
    return null;
  }

  try {
    // A bare axios call, not `apiClient` — going through the instance would
    // re-enter these interceptors and recurse on failure.
    const response = await axios.post(
      `${config.apiBaseUrl}/auth/refresh`,
      { refreshToken: current.refreshToken },
      { timeout: config.requestTimeoutMs },
    );

    const parsed = authTokensSchema.safeParse(response.data);
    if (!parsed.success) {
      logger.error('api', 'Refresh response did not match schema');
      return null;
    }

    await secureStorage.saveTokens(parsed.data);
    return parsed.data;
  } catch (error) {
    logger.warn('api', 'Token refresh failed', error);
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

apiClient.interceptors.response.use(
  response => response,
  async (error: AxiosError) => {
    const original = error.config as RetryableConfig | undefined;
    const apiError = toApiError(error);

    if (!original) {
      throw apiError;
    }

    // A retired build: nothing will succeed until the app is updated, so
    // hand it to the app-status store and let the root navigator take over.
    if (apiError.kind === 'upgrade_required') {
      onUpgradeRequired?.(apiError);
      throw apiError;
    }

    // The server does not know this install — a reinstall, a cleared
    // server, or a revoked device. Register once and replay; a second 428 is
    // final, and the store's own handling decides what the user sees.
    if (
      apiError.kind === 'device_not_registered' &&
      !original._isRetryAfterDeviceRegister
    ) {
      original._isRetryAfterDeviceRegister = true;
      const tokens = await secureStorage.readTokens();
      const deviceId = deviceReregistrar ? await deviceReregistrar(tokens) : null;
      if (!deviceId) {
        throw apiError;
      }
      original.headers['X-Vokve-Device-Id'] = deviceId;
      return apiClient(original);
    }

    // Expired access token: refresh once, then replay the original request.
    if (apiError.kind === 'unauthorized' && !original._isRetryAfterRefresh) {
      refreshPromise = refreshPromise ?? refreshTokens();
      const tokens = await refreshPromise;
      refreshPromise = null;

      if (!tokens) {
        await secureStorage.clearTokens();
        onSessionExpired?.();
        throw apiError;
      }

      original._isRetryAfterRefresh = true;
      original.headers.Authorization = `Bearer ${tokens.accessToken}`;
      return apiClient(original);
    }

    // Transport failures get a bounded exponential backoff. 4xx never does —
    // replaying a rejected request only wastes the user's battery.
    if (apiError.isRetryable) {
      const attempt = original._retryCount ?? 0;
      if (attempt < config.maxRetries) {
        original._retryCount = attempt + 1;
        await delay(config.retryBaseDelayMs * 2 ** attempt);
        return apiClient(original);
      }
    }

    throw apiError;
  },
);

/**
 * Runs a request and validates the response against a schema. Anything the
 * server sends that does not match is surfaced as a validation ApiError rather
 * than flowing into the UI as a malformed object.
 */
export async function request<T>(
  schema: z.ZodType<T>,
  run: (client: AxiosInstance) => Promise<{ data: unknown }>,
): Promise<T> {
  const response = await run(apiClient);
  const parsed = schema.safeParse(response.data);

  if (!parsed.success) {
    logger.error('api', 'Response failed validation', parsed.error.issues);
    throw new ApiError(
      'validation',
      'We received an unexpected response from the server.',
      null,
      parsed.error.issues,
    );
  }

  return parsed.data;
}
