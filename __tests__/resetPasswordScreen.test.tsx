/**
 * The reset's second step: a code and a new password, checked together. The
 * checks are that the screen shows where the code went, refuses to submit
 * until the code is complete, enforces the sign-up password rules on the new
 * one, and — on success — hands the user back to sign-in with a word about
 * what happened.
 *
 * @format
 */

import React from 'react';
import { Text as RNText, TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { ResetPasswordScreen } from '../src/screens/auth/ResetPasswordScreen';
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

const CHALLENGE = {
  verificationId: 'vrf_reset',
  phone: '',
  channel: 'email' as const,
  target: 'a•••@example.com',
  codeLength: 6,
  expiresInSeconds: 300,
  resendInSeconds: 30,
  devCode: null,
};

const resetPassword = jest.fn().mockResolvedValue(true);
const resendResetOtp = jest.fn().mockResolvedValue(true);

beforeEach(() => {
  jest.useFakeTimers();
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  resetPassword.mockClear();
  resetPassword.mockResolvedValue(true);
  resendResetOtp.mockClear();
  useAuthStore.setState({
    resetPassword,
    resendResetOtp,
    pendingReset: CHALLENGE,
    isSubmitting: false,
    error: null,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ResetPasswordScreen />
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

/** The OTP boxes come first in the tree; the two password fields follow. */
const fill = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  code: string,
  password: string,
  confirm = password,
) => {
  const inputs = tree.root.findAllByType(TextInput);
  const [passwordInput, confirmInput] = inputs.slice(-2);
  const otp = inputs.find(n => n.props.accessibilityLabel === 'Reset code') ?? inputs[0];
  await ReactTestRenderer.act(() => {
    otp.props.onChangeText(code);
    passwordInput.props.onChangeText(password);
    confirmInput.props.onChangeText(confirm);
  });
};

const submit = async (tree: ReactTestRenderer.ReactTestRenderer) => {
  await ReactTestRenderer.act(async () => {
    await pressableFor(tree, 'Update Password').props.onPress();
  });
};

describe('ResetPasswordScreen', () => {
  test('says where the code went, masked', async () => {
    const tree = await render();
    const text = textOf(tree, RNText);
    expect(text).toContain('Set a new password');
    expect(text).toContain('a•••@example.com');
  });

  test('a complete code and a valid password finish the reset and return to sign-in', async () => {
    const tree = await render();
    await fill(tree, '123456', 'walk1000steps');
    await submit(tree);
    expect(resetPassword).toHaveBeenCalledWith('123456', 'walk1000steps');
    expect(mockNavigate).toHaveBeenCalledWith('SignIn', {
      notice: expect.stringContaining('password has been updated'),
    });
  });

  test('will not submit a short code', async () => {
    const tree = await render();
    await fill(tree, '123', 'walk1000steps');
    expect(pressableFor(tree, 'Update Password').props.disabled).toBe(true);
  });

  test('applies the sign-up password rules to the new password', async () => {
    const tree = await render();
    await fill(tree, '123456', 'short');
    await submit(tree);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  test('a mismatched confirmation is caught on the client', async () => {
    const tree = await render();
    await fill(tree, '123456', 'walk1000steps', 'walk1000stepz');
    await submit(tree);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  test('a rejected code keeps the challenge and shows the reason', async () => {
    resetPassword.mockImplementation(async () => {
      useAuthStore.setState({
        error: { kind: 'validation', message: 'That code is not right. Check it and try again.' } as never,
      });
      return false;
    });
    const tree = await render();
    await fill(tree, '999999', 'walk1000steps');
    await submit(tree);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(textOf(tree, RNText)).toContain('That code is not right');
  });

  test('leaves when there is no reset in progress', async () => {
    useAuthStore.setState({ pendingReset: null });
    await render();
    expect(mockGoBack).toHaveBeenCalled();
  });
});
