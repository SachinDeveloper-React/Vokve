/**
 * The flow this pins down is sign-up → OTP → complete profile → home.
 *
 * The subtle part is the middle: verifying the code *does* sign the user in,
 * so the root navigator has already swapped the auth stack out by the time
 * onboarding is due. What holds the app back is the server's
 * `profileCompletedAt` stamp, not the session — and getting that backwards
 * either strands a verified user on a login form or drops them into a home
 * screen with no name, height or weight.
 *
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf as collectText } from './helpers/text';
import { RootNavigator } from '../src/navigation/RootNavigator';
import { ThemeProvider } from '../src/theme';
import { ToastProvider } from '../src/components/feedback';
import { useAuthStore } from '../src/stores/authStore';
import { userSchema } from '../src/types/models';

jest.mock('../src/constants/config', () => ({
  config: {
    apiBaseUrl: 'https://example.test/v1',
    requestTimeoutMs: 1000,
    maxRetries: 0,
    retryBaseDelayMs: 1,
    bypassAuthInDev: false,
    useMockApi: false,
    mockLatencyMs: 0,
  },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const userWith = (profileCompletedAt: string | null) =>
  userSchema.parse({
    id: 'usr_1',
    name: 'Rahul Sharma',
    email: 'rahul@example.com',
    profileCompletedAt,
  });

const render = async () => {
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

/** A partial store update, the way the real actions apply theirs. */
type AuthPatch = Partial<ReturnType<typeof useAuthStore.getState>>;

const settle = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  state: AuthPatch,
) => {
  await ReactTestRenderer.act(async () => {
    useAuthStore.setState(state);
  });
  return tree;
};

test('a verified user with no profile lands on onboarding, not on home', async () => {
  const tree = await render();
  await settle(tree, {
    status: 'authenticated',
    user: userWith(null),
  });

  expect(textOf(tree)).toContain('Complete Your Profile');
});

test('finishing the profile moves the same session on to the app', async () => {
  const tree = await render();
  await settle(tree, { status: 'authenticated', user: userWith(null) });
  expect(textOf(tree)).toContain('Complete Your Profile');

  // Exactly what `completeProfile` does: swaps in the server's user, stamped.
  await settle(tree, { user: userWith('2026-09-03T10:00:00.000Z') });

  expect(textOf(tree)).not.toContain('Complete Your Profile');
});

test('a returning user with a finished profile never sees onboarding', async () => {
  const tree = await render();
  await settle(tree, {
    status: 'authenticated',
    user: userWith('2026-09-03T10:00:00.000Z'),
  });

  expect(textOf(tree)).not.toContain('Complete Your Profile');
});

test('a signed-out user still gets the auth stack, not onboarding', async () => {
  const tree = await render();
  await settle(tree, { status: 'signed_out', user: null });

  expect(textOf(tree)).not.toContain('Complete Your Profile');
});
