/**
 * Over-the-air updates (D-111): when the app looks for one, what it does
 * with an ordinary update and a forced one, and how it says which update it
 * is running.
 *
 * The updater is made as its module loads, from the config, so each test
 * loads the modules afresh — React and React Native with them, or the hook
 * and the renderer would hold two different Reacts.
 *
 * @format
 */

import type { AppStateStatus } from 'react-native';

jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    otaBaseUrl: 'https://ota.example.test/api/check-update',
    otaApiKey: 'client-key',
  },
}));

const BUILTIN = '00000000-0000-0000-0000-000000000000';
const SHIPPED = '0198a7c2-5f1e-7000-8000-000000000001';

const globals = globalThis as unknown as { __DEV__: boolean };
let realDev: boolean;

beforeEach(() => {
  realDev = globals.__DEV__;
  globals.__DEV__ = false;
});

afterEach(() => {
  globals.__DEV__ = realDev;
  jest.useRealTimers();
});

/** Every module fresh, with the updater answering as given. */
function load(running: string = BUILTIN) {
  jest.resetModules();
  const updater = {
    checkForUpdate: jest.fn().mockResolvedValue(null),
    reload: jest.fn().mockResolvedValue(undefined),
    getBundleId: jest.fn(() => running),
    getMinBundleId: jest.fn(() => BUILTIN),
  };
  // Registered for this load only: the root `__mocks__` copy is a different
  // instance once the registry is reset.
  const HotUpdater = {
    init: jest.fn((_options: Record<string, unknown>) => updater),
  };
  const insights = jest.fn(() => ({ name: 'insights' }));
  jest.doMock('@hot-updater/react-native', () => ({ HotUpdater, insights }));

  const React = require('react') as typeof import('react');
  const Renderer =
    require('react-test-renderer') as typeof import('react-test-renderer');
  const { AppState } = require('react-native') as typeof import('react-native');
  let foreground: ((state: AppStateStatus) => void) | null = null;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, handler) => {
      foreground = handler as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as never;
    });

  const ota =
    require('../src/services/otaUpdates') as typeof import('../src/services/otaUpdates');
  const hook =
    require('../src/hooks/useOtaUpdates') as typeof import('../src/hooks/useOtaUpdates');

  const mount = async () => {
    const Probe = () => {
      hook.useOtaUpdates();
      return null;
    };
    let tree!: import('react-test-renderer').ReactTestRenderer;
    await Renderer.act(async () => {
      tree = Renderer.create(React.createElement(Probe));
    });
    return tree;
  };
  const returnToApp = () =>
    Renderer.act(async () => {
      foreground?.('active');
    });

  return { updater, HotUpdater, ota, hook, mount, returnToApp };
}

const offer = (shouldForceUpdate: boolean) => ({
  id: SHIPPED,
  status: 'UPDATE' as const,
  shouldForceUpdate,
  message: 'Fix the step card',
  updateBundle: jest.fn().mockResolvedValue(true),
});

test('is made with the server, the client key, insights and the fingerprint strategy', () => {
  const { ota, HotUpdater } = load();
  expect(ota.otaUpdater).not.toBeNull();
  expect(HotUpdater.init).toHaveBeenCalledTimes(1);
  const options = HotUpdater.init.mock.calls[0][0];
  expect(options.baseURL).toBe('https://ota.example.test/api/check-update');
  expect(options.requestHeaders).toEqual({ 'x-api-key': 'client-key' });
  expect(options.plugins).toEqual([{ name: 'insights' }]);
  expect(ota.OTA_UPDATE_STRATEGY).toBe('fingerprint');
});

test('an ordinary update downloads now and waits for the next launch', async () => {
  const { updater, mount } = load();
  const update = offer(false);
  updater.checkForUpdate.mockResolvedValue(update);

  const tree = await mount();
  expect(updater.checkForUpdate).toHaveBeenCalledWith({
    updateStrategy: 'fingerprint',
  });
  expect(update.updateBundle).toHaveBeenCalledTimes(1);
  expect(updater.reload).not.toHaveBeenCalled();
  tree.unmount();
});

test('a forced update reloads as soon as it has downloaded', async () => {
  const { updater, mount } = load();
  const update = offer(true);
  updater.checkForUpdate.mockResolvedValue(update);

  const tree = await mount();
  expect(update.updateBundle).toHaveBeenCalledTimes(1);
  expect(updater.reload).toHaveBeenCalledTimes(1);
  tree.unmount();
});

test('asks again on a return to the app, but not more than every quarter hour', async () => {
  jest.useFakeTimers({ now: new Date('2026-11-23T10:00:00Z') });
  const { updater, hook, mount, returnToApp } = load();
  const tree = await mount();
  expect(updater.checkForUpdate).toHaveBeenCalledTimes(1);

  await returnToApp();
  expect(updater.checkForUpdate).toHaveBeenCalledTimes(1);

  jest.setSystemTime(new Date(Date.now() + hook.OTA_CHECK_INTERVAL_MS + 1));
  await returnToApp();
  expect(updater.checkForUpdate).toHaveBeenCalledTimes(2);
  tree.unmount();
});

test('stays quiet in development, where Metro serves the bundle', async () => {
  globals.__DEV__ = true;
  const { updater, mount } = load();
  const tree = await mount();
  expect(updater.checkForUpdate).not.toHaveBeenCalled();
  tree.unmount();
});

test('says which update is running: builtin for the bundle inside the build, the id otherwise', () => {
  expect(load(BUILTIN).ota.runningOtaUpdateId).toBeNull();
  const device = () =>
    require('../src/services/device') as typeof import('../src/services/device');
  expect(device().requestHeaders()['X-Vokve-Ota-Update']).toBe('builtin');

  expect(load(SHIPPED).ota.runningOtaUpdateId).toBe(SHIPPED);
  expect(device().requestHeaders()['X-Vokve-Ota-Update']).toBe(SHIPPED);
});
