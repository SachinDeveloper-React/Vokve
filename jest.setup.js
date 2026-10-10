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

// Firebase Messaging has no JS-only implementation; the app only ever asks
// it whether it may notify, for permission and for a token, so that is all
// the double provides. Allowed by default, so screens do not stop at the
// notification permission unless a test says so.
jest.mock('@react-native-firebase/messaging', () => ({
  AuthorizationStatus: { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2, EPHEMERAL: 3 },
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn().mockResolvedValue('fcm-test-token'),
  hasPermission: jest.fn().mockResolvedValue(1),
  requestPermission: jest.fn().mockResolvedValue(1),
  onTokenRefresh: jest.fn(() => jest.fn()),
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
