/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf as collectText } from './helpers/text';
import NetInfo from '@react-native-community/netinfo';
import { OfflineBanner } from '../src/components/feedback/OfflineBanner';
import { ThemeProvider } from '../src/theme';

type Listener = (state: {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}) => void;

let listener: Listener | undefined;
const unsubscribe = jest.fn();

const mockedNetInfo = NetInfo as jest.Mocked<typeof NetInfo>;

beforeEach(() => {
  listener = undefined;
  unsubscribe.mockClear();
  mockedNetInfo.addEventListener.mockImplementation((cb: unknown) => {
    listener = cb as Listener;
    return unsubscribe;
  });
});

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <OfflineBanner />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const bannerText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  collectText(tree, Text);

test('stays hidden before connectivity is known', async () => {
  const tree = await render();

  // Nothing has been reported yet — showing a warning here would flash on
  // every cold start.
  expect(bannerText(tree)).not.toContain('offline');
});

test('appears once the device reports no connection', async () => {
  const tree = await render();

  await ReactTestRenderer.act(() => {
    listener!({ isConnected: false, isInternetReachable: false });
  });

  expect(bannerText(tree)).toContain('You are offline');
});

test('appears on a connection that cannot reach the internet', async () => {
  const tree = await render();

  // A captive-portal wifi: connected, but nothing gets through.
  await ReactTestRenderer.act(() => {
    listener!({ isConnected: true, isInternetReachable: false });
  });

  expect(bannerText(tree)).toContain('You are offline');
});

test('stays hidden while reachability is still unknown', async () => {
  const tree = await render();

  await ReactTestRenderer.act(() => {
    listener!({ isConnected: true, isInternetReachable: null });
  });

  expect(bannerText(tree)).not.toContain('You are offline');
});

test('disappears when the connection returns', async () => {
  const tree = await render();

  await ReactTestRenderer.act(() => {
    listener!({ isConnected: false, isInternetReachable: false });
  });
  expect(bannerText(tree)).toContain('You are offline');

  await ReactTestRenderer.act(() => {
    listener!({ isConnected: true, isInternetReachable: true });
  });
  expect(bannerText(tree)).not.toContain('You are offline');
});

test('unsubscribes on unmount', async () => {
  const tree = await render();

  await ReactTestRenderer.act(() => {
    tree.unmount();
  });

  expect(unsubscribe).toHaveBeenCalled();
});
