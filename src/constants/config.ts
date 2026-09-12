/**
 * App-wide configuration. Values that differ per environment should be fed in
 * through a build-time mechanism (react-native-config / Gradle + xcconfig)
 * rather than branching on `__DEV__` beyond the defaults below.
 */
export const config = {
  apiBaseUrl: __DEV__
    ? 'https://api.staging.vokve.app/v1'
    : 'https://api.vokve.app/v1',
  /** Network calls that outlive this are almost always a dead connection. */
  requestTimeoutMs: 15000,
  /** Retries apply to transport failures only, never to 4xx responses. */
  maxRetries: 2,
  retryBaseDelayMs: 400,

  /**
   * Skips the sign-in gate so the main app is reachable while there is no
   * backend to sign in against. Set to false to exercise the real auth flow.
   *
   * Callers must combine this with `__DEV__` (see RootNavigator) — the flag on
   * its own is not a safety boundary, and a release build must never honour it.
   */
  bypassAuthInDev: true,

  /**
   * Serves every API call from `services/api/mockApi.ts` instead of the
   * network, so the whole app — sign-up, OTP, sessions — is usable before the
   * backend exists. Flip to `false` the day the real one is reachable; nothing
   * else has to change, because both sides satisfy the same contracts.
   *
   * Like `bypassAuthInDev` this is combined with `__DEV__` at the call site
   * (see `shouldUseMockApi`), so a release build always talks to the real API
   * even if this is left on by accident.
   *
   * What the mock accepts is documented on `MOCK_RULES` in that file — the
   * short version is that the OTP is always `123456`.
   */
  useMockApi: true,

  /**
   * The version shown on the account screen's "About VOKVE" row.
   *
   * Held here rather than read from the native bundle: the two stores each
   * carry their own build number, and a marketing version that disagreed
   * between platforms would make a support ticket impossible to place.
   */
  appVersion: '1.0.0',

  /**
   * Fake round-trip time for mock responses. Not zero on purpose: spinners,
   * disabled buttons and double-tap guards only get exercised if a request
   * takes long enough to see.
   */
  mockLatencyMs: 600,
} as const;
