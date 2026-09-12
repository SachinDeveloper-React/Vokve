/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, useColorScheme } from 'react-native';
import { darkColors, lightColors } from '../src/constants/colors';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import { getMMKV } from '../src/stores';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
  typeof useColorScheme
>;

type Captured = ReturnType<typeof useTheme>;

const Probe = () => {
  captured = useTheme();
  return <Text>probe</Text>;
};

let captured: Captured;

const render = async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
  });
};

beforeEach(() => {
  getMMKV().clearAll();
  mockedUseColorScheme.mockReturnValue('light');
});

test('defaults to system mode and follows the OS scheme', async () => {
  mockedUseColorScheme.mockReturnValue('dark');
  await render();

  expect(captured.mode).toBe('system');
  expect(captured.scheme).toBe('dark');
  expect(captured.isDark).toBe(true);
  expect(captured.colors).toBe(darkColors);
});

test('treats a null OS scheme as light', async () => {
  mockedUseColorScheme.mockReturnValue(null);
  await render();

  expect(captured.scheme).toBe('light');
  expect(captured.colors).toBe(lightColors);
});

test('an explicit mode overrides the OS scheme', async () => {
  mockedUseColorScheme.mockReturnValue('dark');
  await render();

  await ReactTestRenderer.act(() => captured.setMode('light'));

  expect(captured.mode).toBe('light');
  expect(captured.scheme).toBe('light');
  expect(captured.colors).toBe(lightColors);
});

test('toggleTheme flips away from the resolved scheme', async () => {
  mockedUseColorScheme.mockReturnValue('dark');
  await render();

  await ReactTestRenderer.act(() => captured.toggleTheme());

  expect(captured.mode).toBe('light');
  expect(captured.scheme).toBe('light');
});

test('the chosen mode survives a remount', async () => {
  await render();
  await ReactTestRenderer.act(() => captured.setMode('dark'));

  await render();

  expect(captured.mode).toBe('dark');
  expect(captured.scheme).toBe('dark');
});

class Boundary extends React.Component<
  { children: React.ReactNode; onError: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

test('useTheme outside the provider is a clear error', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  let error: Error | undefined;

  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(
      <Boundary
        onError={e => {
          error = e;
        }}
      >
        <Probe />
      </Boundary>,
    );
  });

  expect(error?.message).toBe('useTheme must be used within a ThemeProvider');
  spy.mockRestore();
});
