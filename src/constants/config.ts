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
const LOCAL_API_HOST = Platform.OS === 'android' ? '10.20.38.237' : 'localhost';

export const config = {
  apiBaseUrl: __DEV__
    ? `http://${LOCAL_API_HOST}:3000/v1`
    : 'https://vokve-backend-src.vercel.app/v1',
  /**
   * The Google OAuth client ids, where this build needs to name them
   * (RULES O12).
   *
   * Null is the ordinary setting, not a gap: `autoDetect` reads the web
   * id the Google Services plugin writes into the Android resources and
   * the iOS plist, so the value lives with the rest of the Firebase
   * config rather than in two places that can disagree. Set these only
   * for a build pointed at a project whose files are not bundled.
   *
   * The **web** id is the one the native SDKs put in the ID token's
   * audience, and the one the server checks against. An Android client
   * id used here is the commonest cause of `DEVELOPER_ERROR`.
   */
  googleWebClientId: "1098246351234-d1jqe3edqm4f23961qqfgd78ucd9spbc.apps.googleusercontent.com" as string | null,
  googleIosClientId: "1098246351234-5p0j2c1lifopaf4hegnr6jr2sl7k11le.apps.googleusercontent.com" as string | null,

  /**
   * Over-the-air updates (D-111, Hot Updater on Firebase): the managed
   * Function's URL and the client API key, both printed by
   * `npx hot-updater init --provider firebase --build bare` (the key is
   * also in `.env.hotupdater` as `HOT_UPDATER_API_KEY`). The client key is
   * meant to ship inside the app; the Firebase credentials never are.
   *
   * Null turns OTA off: the app runs the bundle inside the build, as before.
   */
  otaBaseUrl: 'https://hot-updater-v1-tijxznskfa-el.a.run.app' as string | null,
  otaApiKey: 'ZUfbz42VsfFvyA5WpU8x-6vmOzS87LeQmm0yVLE50sw' as string | null,

  /**
   * Apple sign-in on **Android** (RULES O13). iOS needs neither: it signs
   * in natively and Apple addresses the token to the bundle id.
   *
   * Android has no native Apple sign-in, so it opens Apple's web flow in a
   * WebView, and that flow is identified by a **Services ID** — created in
   * the Apple developer account under Identifiers → Services IDs, grouped
   * with the app's App ID, with Sign in with Apple configured on it. Its
   * tokens are addressed to this id, so it must also be on the server's
   * `APPLE_CLIENT_IDS` list.
   *
   * The return URL must be one of the Return URLs registered on that
   * Services ID, character for character. The WebView reads the result off
   * Apple's page before the browser gets there, but Apple refuses to start
   * the flow for a URL it does not know. The backend answers it with a
   * small page (`/v1/auth/apple/callback`). Not switched on `__DEV__`: it is
   * an id registered with Apple, not where this build's API lives.
   */
  appleServiceId: 'com.vokve.fitness.service' as string | null,
  appleRedirectUri: 'https://vokve-d50ff.firebaseapp.com/__/auth/handler' as string | null,

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
   * Whether the account card shows the member's level.
   *
   * Off for now, on the owner's call: the level, its rank title and the bar
   * under them are coming back, so the card still *reads* the server's
   * figures and simply does not draw them — rather than the JSX being
   * commented out, which would stop being typechecked the moment
   * `ProfileSummary` next changed shape and would be dead the day it was
   * uncommented.
   *
   * Nothing on the server changed: `/account/summary` still works the level
   * out from lifetime coins (RULES P4), so turning this back on shows the
   * level everybody has been accruing all along rather than starting it from
   * one. The rank beside it is a separate figure and stays on.
   */
  showProfileLevel: false,

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
