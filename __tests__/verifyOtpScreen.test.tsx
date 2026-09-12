/**
 * The OTP screen is the only thing standing between a typed phone number and a
 * working account, so the checks here are about the parts a redesign could
 * quietly break: that a code cannot be submitted before it is complete or
 * after it has expired, that both clocks come from the server rather than the
 * screen, and that backing out abandons the sign-up instead of leaving it
 * half-open in the store.
 *
 * @format
 */

import React from 'react';
import { Text as RNText, TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { VerifyOtpScreen } from '../src/screens/auth/VerifyOtpScreen';
import { ThemeProvider } from '../src/theme';
import { useAuthStore } from '../src/stores/authStore';

const mockGoBack = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const CHALLENGE = {
  verificationId: 'ver_123',
  phone: '+919876543210',
  codeLength: 6,
  expiresInSeconds: 105,
  resendInSeconds: 27,
};

const verifyOtp = jest.fn().mockResolvedValue(true);
const resendOtp = jest.fn().mockResolvedValue(true);

beforeEach(() => {
  jest.useFakeTimers();
  mockGoBack.mockClear();
  verifyOtp.mockClear();
  verifyOtp.mockResolvedValue(true);
  resendOtp.mockClear();
  resendOtp.mockResolvedValue(true);
  useAuthStore.setState({
    verifyOtp,
    resendOtp,
    pendingVerification: CHALLENGE,
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
          <VerifyOtpScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const pressableFor = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) =>
  tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function')!;

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  await ReactTestRenderer.act(async () => {
    await pressableFor(tree, label).props.onPress();
  });
};

const typeCode = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  code: string,
) => {
  await ReactTestRenderer.act(() => {
    tree.root.findByType(TextInput).props.onChangeText(code);
  });
};

/** Advances both the fake clock and the wall clock the countdown reads. */
const tick = async (seconds: number) => {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + seconds * 1000);
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(seconds * 1000);
  });
};

const verifyButton = (tree: ReactTestRenderer.ReactTestRenderer) =>
  pressableFor(tree, 'Verify & Continue');

describe('verify OTP screen', () => {
  test('shows the number the code was sent to, grouped for reading', async () => {
    const tree = await render();
    const text = textOf(tree, RNText);

    expect(text).toContain('Verify Your Number');
    expect(text).toContain('Enter the 6-digit OTP sent to');
    expect(text).toContain('+91 98765 43210');
    expect(text).toContain("Don't share your OTP with anyone.");
  });

  test('runs both clocks off the durations the server sent', async () => {
    const tree = await render();
    const text = textOf(tree, RNText);

    expect(text).toContain('01:45'); // expiresInSeconds: 105
    expect(text).toContain('00:27'); // resendInSeconds: 27
  });

  test('will not verify a code that is still incomplete', async () => {
    const tree = await render();

    await typeCode(tree, '123');
    expect(verifyButton(tree).props.accessibilityState.disabled).toBe(true);

    await press(tree, 'Verify & Continue');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  test('verifies as soon as the last digit lands, without a tap', async () => {
    const tree = await render();

    await typeCode(tree, '123456');

    expect(verifyOtp).toHaveBeenCalledWith('123456');
  });

  test('clears a rejected code so the next one can be typed', async () => {
    // Six wrong digits left in place would sit at the field's maximum length,
    // swallowing every further keystroke — the field looks live and is not.
    verifyOtp.mockResolvedValue(false);
    const tree = await render();

    await typeCode(tree, '000000');

    expect(verifyOtp).toHaveBeenCalledWith('000000');
    expect(tree.root.findByType(TextInput).props.value).toBe('');
  });

  test('keeps an accepted code on screen rather than blanking it', async () => {
    verifyOtp.mockResolvedValue(true);
    const tree = await render();

    await typeCode(tree, '123456');

    expect(tree.root.findByType(TextInput).props.value).toBe('123456');
  });

  test('a second attempt after a rejection reaches the store', async () => {
    verifyOtp.mockResolvedValue(false);
    const tree = await render();

    await typeCode(tree, '000000');
    await typeCode(tree, '123456');

    expect(verifyOtp).toHaveBeenNthCalledWith(2, '123456');
  });

  test('keeps non-digits out of the code', async () => {
    const tree = await render();

    await typeCode(tree, '12a3-4');

    expect(tree.root.findByType(TextInput).props.value).toBe('1234');
  });

  test('stops accepting a code once it has expired', async () => {
    const tree = await render();

    await tick(CHALLENGE.expiresInSeconds + 1);
    expect(textOf(tree, RNText)).toContain('This OTP has expired.');

    await typeCode(tree, '123456');
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(verifyButton(tree).props.accessibilityState.disabled).toBe(true);
  });

  test('holds the resend action back until its cooldown runs out', async () => {
    const tree = await render();
    const resendRow = () => pressableFor(tree, 'Resend OTP');

    expect(resendRow().props.accessibilityState.disabled).toBe(true);

    await tick(CHALLENGE.resendInSeconds + 1);

    expect(resendRow().props.accessibilityState.disabled).toBe(false);
    await press(tree, 'Resend OTP');
    expect(resendOtp).toHaveBeenCalled();
  });

  test('clears a stale error the moment the user edits the code', async () => {
    const clearError = jest.fn();
    useAuthStore.setState({
      clearError,
      error: { message: 'That code is not right', kind: 'server' } as never,
    });
    const tree = await render();

    expect(textOf(tree, RNText)).toContain('That code did not work');

    await typeCode(tree, '1');
    expect(clearError).toHaveBeenCalled();
  });

  test('backing out abandons the pending sign-up rather than leaving it open', async () => {
    const tree = await render();

    await press(tree, 'Go back');

    expect(useAuthStore.getState().pendingVerification).toBeNull();
    expect(mockGoBack).toHaveBeenCalled();
  });

  test('"Change" goes back to the form the number came from', async () => {
    const tree = await render();

    await press(tree, 'Change phone number');

    expect(mockGoBack).toHaveBeenCalled();
  });
});
