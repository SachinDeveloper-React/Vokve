/* eslint-env jest */
/**
 * Native modules have no implementation inside Jest, so each one that the app
 * imports at startup needs its test double registered here. Without this a
 * component test fails at import time with "doesn't seem to be linked",
 * which says nothing about the code under test.
 */

// The library ships a mock object but does not register it, so the mapping
// has to be made explicitly.
jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
);

require('@shopify/flash-list/jestSetup');

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AccessibleAfterFirstUnlockThisDeviceOnly' },
  setGenericPassword: jest.fn().mockResolvedValue(true),
  getGenericPassword: jest.fn().mockResolvedValue(false),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
}));

jest.mock('react-native-linear-gradient', () => 'LinearGradient');

jest.mock('react-native-device-info', () =>
  require('react-native-device-info/jest/react-native-device-info-mock'),
);

// The step tracker is a native module too. Its shipped mock resolves every
// call with an empty day and fires listeners through `__emit`.
jest.mock('react-native-step-tracker-pro', () =>
  require('react-native-step-tracker-pro/jest'),
);

// The clipboard ships a mock object but does not register it either.
jest.mock('@react-native-clipboard/clipboard', () =>
  require('@react-native-clipboard/clipboard/jest/clipboard-mock.js'),
);

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn().mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    }),
  },
}));

// Firebase Messaging has no JS-only implementation. The app asks it whether
// it may notify, for a token, and for the three message channels — one
// while the app is open, one for a notification tapped from the background,
// and one for the notification the app was opened by. Allowed by default,
// so screens do not stop at the notification permission unless a test says
// so; the listeners hand back their unsubscribe, as the real ones do.
jest.mock('@react-native-firebase/messaging', () => ({
  AuthorizationStatus: { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2, EPHEMERAL: 3 },
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn().mockResolvedValue('fcm-test-token'),
  getAPNSToken: jest.fn().mockResolvedValue('apns-test-token'),
  deleteToken: jest.fn().mockResolvedValue(undefined),
  hasPermission: jest.fn().mockResolvedValue(1),
  requestPermission: jest.fn().mockResolvedValue(1),
  onTokenRefresh: jest.fn(() => jest.fn()),
  onMessage: jest.fn(() => jest.fn()),
  onNotificationOpenedApp: jest.fn(() => jest.fn()),
  getInitialNotification: jest.fn().mockResolvedValue(null),
  setBackgroundMessageHandler: jest.fn(),
}));

// Crashlytics is a native module too. The app only ever asks it to take an
// error, a user id or an attribute, and none of those answer anything — so
// the double records the calls and resolves.
jest.mock('@react-native-firebase/crashlytics', () => ({
  getCrashlytics: jest.fn(() => ({})),
  recordError: jest.fn(),
  log: jest.fn(),
  setUserId: jest.fn().mockResolvedValue(null),
  setAttributes: jest.fn().mockResolvedValue(null),
  setAttribute: jest.fn().mockResolvedValue(null),
  // The app asks this once a launch, to file the crash the previous run
  // died of. A suite that wants the crash path says so for itself.
  didCrashOnPreviousExecution: jest.fn().mockResolvedValue(false),
}));

// Google Sign-In is a Nitro module: it has no JavaScript fallback at all,
// so a suite that imported it would fail at require time. The double
// answers the three calls the app makes and defaults to a signed-in
// response; a test about cancelling or failing says so for itself.
jest.mock('react-native-nitro-google-signin', () => {
  const success = {
    type: 'success',
    data: { idToken: 'google-id-token', serverAuthCode: null, scopes: [], user: {} },
  };
  return {
    GoogleOneTapSignIn: {
      configure: jest.fn(),
      checkPlayServices: jest.fn().mockResolvedValue(undefined),
      signIn: jest.fn().mockResolvedValue(success),
      presentExplicitSignIn: jest.fn().mockResolvedValue(success),
      signOut: jest.fn().mockResolvedValue(undefined),
      getCurrentUser: jest.fn(() => null),
    },
    isSuccessResponse: (r) => r?.type === 'success',
    isCancelledResponse: (r) => r?.type === 'cancelled',
    isNoSavedCredentialFoundResponse: (r) => r?.type === 'noSavedCredentialFound',
    isErrorWithCode: (e) => Boolean(e && typeof e === 'object' && 'code' in e),
    statusCodes: {
      ONE_TAP_START_FAILED: 'ONE_TAP_START_FAILED',
      PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
      IN_PROGRESS: 'IN_PROGRESS',
      SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
      SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
      DEVELOPER_ERROR: 'DEVELOPER_ERROR',
    },
  };
});

// Apple sign-in's iOS half is a native module and its Android half is read
// off `NativeModules` at import, so neither exists under Jest. The double
// answers a signed-in response on both; a test about cancelling or failing
// says so for itself.
jest.mock('@invertase/react-native-apple-authentication', () => ({
  appleAuth: {
    isSupported: true,
    performRequest: jest.fn().mockResolvedValue({
      identityToken: 'apple-identity-token',
      nonce: 'apple-raw-nonce-0123456789',
      fullName: { givenName: null, familyName: null },
      email: null,
      user: 'apple-user',
      authorizationCode: 'apple-code',
    }),
    Operation: { IMPLICIT: 0, LOGIN: 1, REFRESH: 2, LOGOUT: 3 },
    Scope: { EMAIL: 0, FULL_NAME: 1 },
    State: { REVOKED: 0, AUTHORIZED: 1, NOT_FOUND: 2, TRANSFERRED: 3 },
    getCredentialStateForUser: jest.fn().mockResolvedValue(1),
    onCredentialRevoked: jest.fn(() => jest.fn()),
    Error: {
      UNKNOWN: '1000',
      CANCELED: '1001',
      INVALID_RESPONSE: '1002',
      NOT_HANDLED: '1003',
      FAILED: '1004',
    },
  },
  appleAuthAndroid: {
    isSupported: true,
    configure: jest.fn(),
    signIn: jest.fn().mockResolvedValue({
      id_token: 'apple-identity-token',
      nonce: 'apple-raw-nonce-0123456789',
      state: 'state',
      code: 'apple-code',
    }),
    Error: {
      NOT_CONFIGURED: 'E_NOT_CONFIGURED_ERROR',
      SIGNIN_FAILED: 'E_SIGNIN_FAILED_ERROR',
      SIGNIN_CANCELLED: 'E_SIGNIN_CANCELLED_ERROR',
    },
    Scope: { ALL: 'ALL', EMAIL: 'EMAIL', NAME: 'NAME' },
    ResponseType: { ALL: 'ALL', CODE: 'CODE', ID_TOKEN: 'ID_TOKEN' },
  },
}));

// Firebase Auth is used for phone verification only (RULES O14), and is a
// native module. The double sends a code, and confirms any code into a
// Firebase user holding the number it was sent to; a test about Android's
// auto-verification or a refused code says so for itself.
jest.mock('@react-native-firebase/auth', () => {
  const auth = { currentUser: null };
  const listeners = new Set();
  const setUser = user => {
    auth.currentUser = user;
    listeners.forEach(listener => listener(user));
  };
  return {
    __setUser: setUser,
    getAuth: jest.fn(() => auth),
    getIdToken: jest.fn(async user => `firebase-id-token:${user.phoneNumber}`),
    signInWithPhoneNumber: jest.fn(async (_auth, phoneNumber) => ({
      verificationId: 'verification-id',
      confirm: jest.fn(async () => {
        const user = { uid: 'firebase-uid', phoneNumber };
        setUser(user);
        return { user };
      }),
    })),
    signOut: jest.fn(async () => setUser(null)),
    onAuthStateChanged: jest.fn((_auth, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
});

// Performance monitoring is a native module whose traces answer nothing:
// every call is fire-and-forget telemetry, and a test that waited on one
// would be waiting on a console it cannot see. The double keeps the shape
// so `startSpan` returns something with the methods on it.
jest.mock('@react-native-firebase/perf', () => ({
  getPerformance: jest.fn(() => ({})),
  trace: jest.fn(() => ({
    start: jest.fn(),
    stop: jest.fn(),
    putMetric: jest.fn(),
    putAttribute: jest.fn(),
  })),
}));

// Notifee is a native module. Its shipped mock answers every call and keeps
// the jest.fn()s on the default export, which is what the reminder tests
// assert against; `openAlarmPermissionSettings` is not in it, so it is added
// here rather than letting a call on it throw.
jest.mock('@notifee/react-native', () => {
  const mock = require('@notifee/react-native/jest-mock');
  mock.default.openAlarmPermissionSettings = jest.fn(async () => {});
  return mock;
});

// The slider is a native view; the checkout only needs something that
// renders and forwards the props a test reads (`value`, `onValueChange`).
jest.mock('@react-native-community/slider', () => ({
  __esModule: true,
  default: 'Slider',
}));

// The image picker is a native module; the app only ever asks it to open a
// camera or a library and hand back an asset, so that is all the double does.
jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn().mockResolvedValue({ didCancel: true }),
  launchImageLibrary: jest.fn().mockResolvedValue({ didCancel: true }),
}));
