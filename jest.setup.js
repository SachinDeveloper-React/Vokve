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
