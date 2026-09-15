/**
 * Forgot-password is the first screen of the reset. What matters is that a
 * valid identifier starts a reset and moves to the code screen, that an
 * invalid one is stopped before the network, and that the screen never
 * claims to know whether an account exists — the server sends a decoy for
 * unknown identifiers precisely so nothing here can.
 *
 * @format
 */

import React from 'react';
import { Text as RNText, TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { ForgotPasswordScreen } from '../src/screens/auth/ForgotPasswordScreen';
import { ThemeProvider } from '../src/theme';
import { useAuthStore } from '../src/stores/authStore';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const forgotPassword = jest.fn().mockResolvedValue(true);

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  forgotPassword.mockClear();
  forgotPassword.mockResolvedValue(true);
  useAuthStore.setState({ forgotPassword, isSubmitting: false, error: null });
});

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ForgotPasswordScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const pressableFor = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function')!;

const typeIdentifier = async (tree: ReactTestRenderer.ReactTestRenderer, value: string) => {
  const [input] = tree.root.findAllByType(TextInput);
  await ReactTestRenderer.act(() => {
    input.props.onChangeText(value);
  });
};

const submit = async (tree: ReactTestRenderer.ReactTestRenderer) => {
  await ReactTestRenderer.act(async () => {
    await pressableFor(tree, 'Send Code').props.onPress();
  });
};

describe('ForgotPasswordScreen', () => {
  test('explains the step and offers one identifier field', async () => {
    const tree = await render();
    expect(textOf(tree, RNText)).toContain('Forgot your password?');
    expect(tree.root.findAllByType(TextInput)).toHaveLength(1);
  });

  test('a phone number starts the reset and moves to the code screen', async () => {
    const tree = await render();
    await typeIdentifier(tree, '+91 98765 43210');
    await submit(tree);
    expect(forgotPassword).toHaveBeenCalledWith('+91 98765 43210');
    expect(mockNavigate).toHaveBeenCalledWith('ResetPassword');
  });

  test('an email address is accepted too', async () => {
    const tree = await render();
    await typeIdentifier(tree, 'asha@example.com');
    await submit(tree);
    expect(forgotPassword).toHaveBeenCalledWith('asha@example.com');
  });

  test('a malformed identifier never reaches the network', async () => {
    const tree = await render();
    await typeIdentifier(tree, 'not an address');
    await submit(tree);
    expect(forgotPassword).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('stays put when the request fails, showing the server message', async () => {
    forgotPassword.mockImplementation(async () => {
      useAuthStore.setState({
        error: { kind: 'rate_limited', message: 'Too many attempts. Please wait a moment.' } as never,
      });
      return false;
    });
    const tree = await render();
    await typeIdentifier(tree, 'asha@example.com');
    await submit(tree);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(textOf(tree, RNText)).toContain('Too many attempts');
  });

  test('back leaves the screen', async () => {
    const tree = await render();
    await ReactTestRenderer.act(() => {
      pressableFor(tree, 'Go back').props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();
  });
});
