/**
 * The "New to VOKVE?" sheet, and its Facebook twin (RULES O15, O18): when
 * Facebook's email already has an account, the sheet offers only what
 * works — sign in to it once — never a new account the server would refuse.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { IdentityChoiceSheet } from '../src/components/auth/IdentityChoiceSheet';
import { ThemeProvider } from '../src/theme';
import { useAuthStore, type PendingIdentity } from '../src/stores/authStore';

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const pending = (over: Partial<PendingIdentity> = {}): PendingIdentity => ({
  provider: 'facebook',
  email: 'rana.fb@example.com',
  existingAccount: null,
  linkToken: 'link-fb',
  expiresAt: Date.now() + 600_000,
  stage: 'choose',
  ...over,
});

const render = async (onChoseExistingAccount = jest.fn()) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <IdentityChoiceSheet onChoseExistingAccount={onChoseExistingAccount} />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const pressableFor = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');

beforeEach(() => {
  useAuthStore.setState({ isSubmitting: false, pendingIdentity: null });
});

test('a Facebook identity nobody has: new account, or one you already have', async () => {
  useAuthStore.setState({ pendingIdentity: pending() });
  const tree = await render();

  const text = textOf(tree, RNText);
  expect(text).toContain('There is no VOKVE account for this Facebook account yet.');
  expect(pressableFor(tree, 'Create a new account')).toBeDefined();
  expect(pressableFor(tree, 'I already have an account')).toBeDefined();
});

test('a Facebook email an account already has: "Welcome back", one tap on that account\'s own sign-in, no new account', async () => {
  const keepIdentityForExistingAccount = jest.fn();
  const signInWithGoogle = jest.fn().mockResolvedValue(true);
  const onChose = jest.fn();
  useAuthStore.setState({
    pendingIdentity: pending({ existingAccount: 'r•••@example.com', existingMethods: ['google', 'password'] }),
    keepIdentityForExistingAccount,
    signInWithGoogle,
  });
  const tree = await render(onChose);

  const text = textOf(tree, RNText);
  expect(text).toContain('Welcome back');
  expect(text).toContain('You already have a VOKVE account with r•••@example.com.');
  expect(text).toContain('Continue with Google or your password once and we will connect Facebook to it.');
  expect(pressableFor(tree, 'Create a new account')).toBeUndefined();

  await ReactTestRenderer.act(() => {
    pressableFor(tree, 'Continue with Google')!.props.onPress();
  });
  // The identity waits for the session Google is about to start, which
  // connects it (authStore.connectPendingIdentity).
  expect(keepIdentityForExistingAccount).toHaveBeenCalledTimes(1);
  expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  expect(onChose).not.toHaveBeenCalled();
});

test('a password account is sent to the sign-in form, where the identity is connected', async () => {
  const keepIdentityForExistingAccount = jest.fn();
  const onChose = jest.fn();
  useAuthStore.setState({
    pendingIdentity: pending({ existingAccount: 'r•••@example.com', existingMethods: ['password'] }),
    keepIdentityForExistingAccount,
  });
  const tree = await render(onChose);

  expect(pressableFor(tree, 'Continue with Google')).toBeUndefined();
  await ReactTestRenderer.act(() => {
    pressableFor(tree, 'Sign in with email and password')!.props.onPress();
  });
  expect(keepIdentityForExistingAccount).toHaveBeenCalledTimes(1);
  expect(onChose).toHaveBeenCalledTimes(1);
});

test('with nothing named, the sign-in form still works, and "Not now" lets it go', async () => {
  const dismissPendingIdentity = jest.fn();
  useAuthStore.setState({
    pendingIdentity: pending({ existingAccount: 'r•••@example.com', existingMethods: [] }),
    dismissPendingIdentity,
  });
  const tree = await render();

  expect(pressableFor(tree, 'Sign in')).toBeDefined();
  await ReactTestRenderer.act(() => {
    pressableFor(tree, 'Not now')!.props.onPress();
  });
  expect(dismissPendingIdentity).toHaveBeenCalledTimes(1);
});
