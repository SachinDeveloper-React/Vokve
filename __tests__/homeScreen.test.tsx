/**
 * Home is where the rest of the app is reached from, so what is checked here
 * is the wiring: that the shortcut row and the bell lead to the screens they
 * name rather than to a tab that happens to contain something similar.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HomeScreen } from '../src/screens/main/HomeScreen';
import { ThemeProvider } from '../src/theme';

const mockNavigate = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
});

afterEach(async () => {
  const tree = mounted;
  mounted = null;
  if (tree) {
    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  }
});

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <HomeScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

const press = (tree: ReactTestRenderer.ReactTestRenderer, prefix: string) => {
  const node = tree.root
    .findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        (n.props.accessibilityLabel as string).startsWith(prefix),
    )
    .find(n => typeof n.props.onPress === 'function');

  if (!node) throw new Error(`No pressable labelled "${prefix}…"`);
  ReactTestRenderer.act(() => node.props.onPress());
};

describe('HomeScreen', () => {
  test('the challenges shortcut opens the board as a route of its own', async () => {
    press(await render(), 'Challenges &');

    expect(mockNavigate).toHaveBeenCalledWith('Challenges');
  });

  test('the hydration card opens the hydration screen', async () => {
    press(await render(), 'Hydration,');

    expect(mockNavigate).toHaveBeenCalledWith('Hydration');
  });

  test('the bell opens the notification centre', async () => {
    press(await render(), 'Notifications');

    expect(mockNavigate).toHaveBeenCalledWith('Notifications');
  });

  test('the streak shortcut opens the streak as a route of its own', async () => {
    press(await render(), 'Streaks');

    expect(mockNavigate).toHaveBeenCalledWith('Streak');
  });
});
