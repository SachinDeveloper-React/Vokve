/**
 * The theme must survive a broken storage layer. MMKV is created lazily, so a
 * missing native module or a corrupted store surfaces on the first read — that
 * must degrade to the OS scheme rather than crash startup.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, useColorScheme } from 'react-native';
import { darkColors } from '../src/constants/colors';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';

jest.mock('react-native/Libraries/Utilities/useColorScheme');

jest.mock('../src/stores', () => ({
  mmkvStorage: {
    getItem: () => {
      throw new Error("Invariant Violation: 'NitroModules' could not be found.");
    },
    setItem: () => {
      throw new Error("Invariant Violation: 'NitroModules' could not be found.");
    },
  },
}));

const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
  typeof useColorScheme
>;

let captured: ReturnType<typeof useTheme>;

const Probe = () => {
  captured = useTheme();
  return <Text>probe</Text>;
};

test('falls back to the OS scheme when storage is unavailable', async () => {
  mockedUseColorScheme.mockReturnValue('dark');

  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
  });

  expect(captured.mode).toBe('system');
  expect(captured.scheme).toBe('dark');
  expect(captured.colors).toBe(darkColors);
});

test('changing the theme still works, just without persistence', async () => {
  mockedUseColorScheme.mockReturnValue('dark');

  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
  });

  await ReactTestRenderer.act(() => captured.setMode('light'));

  expect(captured.scheme).toBe('light');
});
