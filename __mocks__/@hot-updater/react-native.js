/**
 * Hot Updater (D-111) under Jest: the real package reaches for its native
 * TurboModule as it loads. Tests run with OTA unconfigured, so `init` is
 * only here for a test that configures it and wants to see the calls.
 */
const instance = () => ({
  checkForUpdate: jest.fn().mockResolvedValue(null),
  reload: jest.fn().mockResolvedValue(undefined),
  getBundleId: jest.fn(() => '00000000-0000-0000-0000-000000000000'),
  getMinBundleId: jest.fn(() => '00000000-0000-0000-0000-000000000000'),
  wrap: () => Component => Component,
});

module.exports = {
  HotUpdater: { init: jest.fn(instance) },
  insights: jest.fn(),
  remoteConfig: jest.fn(),
};
