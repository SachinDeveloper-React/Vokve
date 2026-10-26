/**
 * The other half of the offline launch (`offlineSession.test.ts`): a session
 * the app drew from its stored snapshot is only safe to show because the
 * server is asked about it again. These tests pin *when* it is asked — and
 * that the asking is not one request per connectivity event.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSessionRecovery } from '../src/hooks/useSessionRecovery';
import { useAuthStore } from '../src/stores/authStore';

const Probe = () => {
  useSessionRecovery();
  return null;
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

/**
 * One probe at a time. A tree left mounted keeps its listeners and its
 * subscription to the store, so the next test's `setState` would run the
 * last test's hook as well.
 */
const mount = async () => {
  await ReactTestRenderer.act(() => {
    mounted = ReactTestRenderer.create(<Probe />);
  });
};

/** The listener the hook's `useNetworkStatus` registered. */
const netInfoListener = () =>
  (NetInfo.addEventListener as unknown as jest.Mock).mock.calls.at(-1)![0];

const appStateListener = () =>
  (AppState.addEventListener as unknown as jest.Mock).mock.calls
    .filter(([event]) => event === 'change')
    .at(-1)![1];

const hydrate = jest.fn().mockResolvedValue(undefined);
let clock = 1_000_000;

beforeEach(() => {
  jest.clearAllMocks();
  clock = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  useAuthStore.setState({
    status: 'authenticated',
    isSessionUnconfirmed: true,
    isSubmitting: false,
    hydrate,
  });
});

afterEach(() => {
  ReactTestRenderer.act(() => {
    mounted?.unmount();
  });
  mounted = null;
  jest.restoreAllMocks();
});

test('a session restored offline is asked about at once, and again when the network comes back', async () => {
  // At once, because the restore also covers a server that was simply down,
  // and there is nothing to wait for in that case. NetInfo has not answered
  // yet either: the app assumes a connection until told otherwise.
  await mount();
  expect(hydrate).toHaveBeenCalledTimes(1);

  // Losing the network is not a reason to ask.
  await ReactTestRenderer.act(async () => {
    netInfoListener()({ isConnected: false, isInternetReachable: false });
  });
  expect(hydrate).toHaveBeenCalledTimes(1);

  clock += 60_000;
  await ReactTestRenderer.act(async () => {
    netInfoListener()({ isConnected: true, isInternetReachable: true });
  });
  expect(hydrate).toHaveBeenCalledTimes(2);
});

test('a confirmed session is left alone', async () => {
  useAuthStore.setState({ isSessionUnconfirmed: false });

  await mount();
  await ReactTestRenderer.act(async () => {
    netInfoListener()({ isConnected: true, isInternetReachable: true });
  });

  expect(hydrate).not.toHaveBeenCalled();
});

test('the events of one reconnection are one request', async () => {
  await mount();
  expect(hydrate).toHaveBeenCalledTimes(1);

  // Wifi to mobile data, then the app coming to the front: the same
  // reconnection, said three ways.
  await ReactTestRenderer.act(async () => {
    netInfoListener()({ isConnected: true, isInternetReachable: true });
    appStateListener()('active');
  });

  expect(hydrate).toHaveBeenCalledTimes(1);
});

test('a later foreground asks again, for everything NetInfo did not say', async () => {
  await mount();
  expect(hydrate).toHaveBeenCalledTimes(1);

  clock += 60_000;
  await ReactTestRenderer.act(async () => {
    appStateListener()('active');
  });

  expect(hydrate).toHaveBeenCalledTimes(2);
});

test('nothing is asked while an attempt is already in flight', async () => {
  useAuthStore.setState({ isSubmitting: true });

  await mount();
  clock += 60_000;
  await ReactTestRenderer.act(async () => {
    appStateListener()('active');
  });

  expect(hydrate).not.toHaveBeenCalled();
});
