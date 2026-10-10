import { Platform } from 'react-native';

/**
 * App-wide configuration. Values that differ per environment should be fed in
 * through a build-time mechanism (react-native-config / Gradle + xcconfig)
 * rather than branching on `__DEV__` beyond the defaults below.
 */
/**
 * Where the local backend answers from the simulator/emulator. The Android
 * emulator reaches the host machine at 10.0.2.2, not localhost; a physical
 * device needs the machine's LAN address instead (D-31: staging comes later).
 */
const LOCAL_API_HOST = Platform.OS === 'android' ? '192.168.0.112' : 'localhost';

export const config = {
  apiBaseUrl: __DEV__
    ? `http://${LOCAL_API_HOST}:3000/v1`
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
  bypassAuthInDev: false,

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
  useMockApi: false,

  /**
   * Writes today's steps as the phone sees them to the console on every
   * foreground and every "sync now": the tracker's set-up, Health Connect's
   * grants, every app and raw record there, which number is shown and why,
   * hour by hour, and the server's day (`services/stepsDebug`). Combined
   * with `__DEV__` there — these are health data, and a release build never
   * logs them.
   */
  logStepSources: true,

  /**
   * Writes why a hydration reminder did or did not arrive to the console
   * whenever the reminder screen opens: the permission, the health switch,
   * quiet hours, the plan, what the scheduler worked out, what the OS
   * actually accepted, and whether the channel has a sound
   * (`services/remindersDebug`). Combined with `__DEV__` there.
   *
   * On by default while the feature is new: a reminder can only be tested by
   * waiting for a minute to pass, and when nothing happens there is nothing
   * else to look at.
   */
  logReminderSchedule: true,

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
