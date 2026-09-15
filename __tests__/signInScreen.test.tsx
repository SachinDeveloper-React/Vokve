/**
 * The sign-in screen is the app's front door, so the checks here are about the
 * things a broken login would hide: that every route off the screen does
 * something visible, that the reveal toggle really unmasks the field, and that
 * a phone number gets through the validator a mock-driven redesign could
 * easily have left email-only.
 *
 * @format
 */

import React from 'react';
import { Text as RNText, TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { SignInScreen } from '../src/screens/auth/SignInScreen';
import { ThemeProvider } from '../src/theme';
import { useAuthStore } from '../src/stores/authStore';

const mockNavigate = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockRouteParams }),
}));

let mockRouteParams: { notice?: string } | undefined;

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const signIn = jest.fn().mockResolvedValue(true);

beforeEach(() => {
  mockRouteParams = undefined;
  mockNavigate.mockClear();
  signIn.mockClear();
  useAuthStore.setState({ signIn, isSubmitting: false, error: null });
});

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <SignInScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

/** The pressable carrying a given label — labels also sit on plain Views. */
const pressableFor = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function')!;

const inputsOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(TextInput);

const type = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  identifier: string,
  password: string,
) => {
  const [identifierInput, passwordInput] = inputsOf(tree);
  await ReactTestRenderer.act(() => {
    identifierInput.props.onChangeText(identifier);
    passwordInput.props.onChangeText(password);
  });
};

const submit = async (tree: ReactTestRenderer.ReactTestRenderer) => {
  await ReactTestRenderer.act(async () => {
    await pressableFor(tree, 'Log In').props.onPress();
  });
};

describe('sign-in screen', () => {
  test('renders the wordmark, the heading and the perk strip', async () => {
    const tree = await render();
    const text = textOf(tree, RNText);

    expect(text).toContain('VOK');
    expect(text).toContain('Welcome back!');
    expect(text).toContain('Track Steps');
    expect(text).toContain('Earn V-Coins');
    expect(text).toContain('Redeem Rewards');
  });

  test('offers all three providers', async () => {
    const tree = await render();

    for (const name of ['Google', 'Apple', 'Facebook']) {
      expect(pressableFor(tree, `Continue with ${name}`)).toBeDefined();
    }
  });

  test('the reveal toggle unmasks the password field', async () => {
    const tree = await render();
    const passwordInput = () => inputsOf(tree)[1];

    expect(passwordInput().props.secureTextEntry).toBe(true);

    await ReactTestRenderer.act(() => {
      pressableFor(tree, 'Show password').props.onPress();
    });

    expect(passwordInput().props.secureTextEntry).toBe(false);
    expect(pressableFor(tree, 'Hide password')).toBeDefined();
  });

  test('blocks submission and explains why when the field is empty', async () => {
    const tree = await render();

    await submit(tree);

    expect(signIn).not.toHaveBeenCalled();
    expect(textOf(tree, RNText)).toContain('Enter your email or phone number');
  });

  test('signs in with a phone number, trimmed', async () => {
    const tree = await render();

    await type(tree, '  +91 98765 43210  ', 'secret');
    await submit(tree);

    expect(signIn).toHaveBeenCalledWith('+91 98765 43210', 'secret');
  });

  test('signs in with an email address', async () => {
    const tree = await render();

    await type(tree, 'a@b.com', 'secret');
    await submit(tree);

    expect(signIn).toHaveBeenCalledWith('a@b.com', 'secret');
  });

  test('routes to sign-up', async () => {
    const tree = await render();

    await ReactTestRenderer.act(() => {
      pressableFor(tree, 'Sign up').props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('SignUp');
  });

  test('says so rather than doing nothing for social sign-in, which is not wired up', async () => {
    const tree = await render();
    await ReactTestRenderer.act(() => {
      pressableFor(tree, 'Continue with Google').props.onPress();
    });
    expect(textOf(tree, RNText)).toContain('Google sign-in is not connected');
  });

  test('forgot password leads to the reset flow rather than a dead-end notice', async () => {
    const tree = await render();
    await ReactTestRenderer.act(() => {
      pressableFor(tree, 'Forgot password').props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('ForgotPassword');
    expect(textOf(tree, RNText)).not.toContain('not available');
  });

  test('shows the notice a finished reset arrives with', async () => {
    mockRouteParams = { notice: 'Your password has been updated.' };
    const tree = await render();
    expect(textOf(tree, RNText)).toContain('Your password has been updated.');
  });
});
