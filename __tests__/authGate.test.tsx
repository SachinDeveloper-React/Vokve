/**
 * The dev bypass exists so the app is usable without a backend. The risk is
 * that it ships: these tests pin that `__DEV__` — not the config flag — is
 * what actually holds the gate shut.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf as collectText } from './helpers/text';
import { RootNavigator } from '../src/navigation/RootNavigator';
import { ThemeProvider } from '../src/theme';
import { ToastProvider } from '../src/components/feedback';

let mockBypassAuthInDev = true;

jest.mock('../src/constants/config', () => ({
  config: {
    apiBaseUrl: 'https://example.test/v1',
    requestTimeoutMs: 1000,
    maxRetries: 0,
    retryBaseDelayMs: 1,
    get bypassAuthInDev() {
      return mockBypassAuthInDev;
    },
  },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

// `globalThis` rather than `global`: node types are not in this tsconfig.
const globals = globalThis as unknown as { __DEV__: boolean };
let realDev: boolean;

beforeEach(() => {
  realDev = globals.__DEV__;
  mockBypassAuthInDev = true;
});

afterEach(() => {
  globals.__DEV__ = realDev;
});

const renderGate = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          {/*
            The tab bar mounts every tab, and the Shop reports a redemption
            through the toast — so the gate has to be rendered inside the same
            provider stack App puts around it, or the render fails on a
            missing context rather than on anything this file is testing.
          */}
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const textOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  collectText(tree, Text);

/**
 * Text that only ever appears once the tab app is on screen — the Home
 * masthead's standing subtitle. A marker from deeper inside a feature screen
 * would have to be chased every time that feature is reworked, which is how
 * this assertion previously ended up pointing at a string the app no longer
 * contains.
 */
const APP_MARKER = 'Stay active, stay healthy!';

// The keychain mock stores nothing, so auth always resolves to signed out.
test('a signed-out user reaches the app when the bypass is on in dev', async () => {
  globals.__DEV__ = true;
  mockBypassAuthInDev = true;

  expect(textOf(await renderGate())).toContain(APP_MARKER);
});

test('turning the flag off restores the sign-in gate in dev', async () => {
  globals.__DEV__ = true;
  mockBypassAuthInDev = false;

  const text = textOf(await renderGate());
  expect(text).toContain('Train with intent.');
  expect(text).not.toContain(APP_MARKER);
});

test('a release build ignores the flag even when it is left on', async () => {
  globals.__DEV__ = false;
  mockBypassAuthInDev = true;

  // The one that matters: flag on, but __DEV__ false, so a signed-out user
  // must still land on the sign-in flow.
  const text = textOf(await renderGate());
  expect(text).toContain('Train with intent.');
  expect(text).not.toContain(APP_MARKER);
});

// ─── The two gates that outrank the session ─────────────────────────────

import { useAuthStore } from '../src/stores/authStore';
import { useAppStatusStore } from '../src/stores/appStatusStore';
import { ApiError } from '../src/services/api/errors';

afterEach(() => {
  useAppStatusStore.setState({ upgradeRequired: null });
});

test('a session the server could not confirm gets a retry screen, not the sign-in', async () => {
  globals.__DEV__ = false;
  const tree = await renderGate();
  await ReactTestRenderer.act(() => {
    useAuthStore.setState({
      status: 'unreachable',
      user: null,
      error: new ApiError('network', 'No connection. Check your internet and try again.'),
    });
  });
  const text = textOf(tree);
  expect(text).toContain("Couldn't reach VOKVE");
  expect(text).toContain('Try again');
  expect(text).not.toContain('Train with intent.');
  expect(text).not.toContain(APP_MARKER);
});

test('a retired build shows the upgrade screen over everything, including a live session', async () => {
  globals.__DEV__ = true;
  mockBypassAuthInDev = true;
  const tree = await renderGate();
  expect(textOf(tree)).toContain(APP_MARKER);

  await ReactTestRenderer.act(() => {
    useAppStatusStore.setState({
      upgradeRequired: { storeUrl: 'https://play.google.com/store/apps/details?id=com.vokve', minVersion: '1.1.0', message: 'Please update VOKVE to continue.' },
    });
  });
  const text = textOf(tree);
  expect(text).toContain('Update VOKVE to continue');
  expect(text).toContain('needs 1.1.0 or newer');
  expect(text).not.toContain(APP_MARKER);
});
