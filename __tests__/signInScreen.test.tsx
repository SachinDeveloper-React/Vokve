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

  test('Google and Apple sign in rather than apologising, and Facebook still says so', async () => {
    const signInWithGoogle = jest.fn().mockResolvedValue(true);
    const signInWithApple = jest.fn().mockResolvedValue(true);
    useAuthStore.setState({ signInWithGoogle, signInWithApple });

    const tree = await render();
    await ReactTestRenderer.act(() => {
      pressableFor(tree, 'Continue with Google').props.onPress();
    });
    await ReactTestRenderer.act(() => {
      pressableFor(tree, 'Continue with Apple').props.onPress();
    });

    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(signInWithApple).toHaveBeenCalledTimes(1);
    // And no apology for the ones that work.
    expect(textOf(tree, RNText)).not.toContain('Google sign-in is not connected');
    expect(textOf(tree, RNText)).not.toContain('Apple sign-in is not connected');

    // Facebook is not wired, and says so rather than doing nothing at all
    // when pressed.
    await ReactTestRenderer.act(() => {
      pressableFor(tree, 'Continue with Facebook').props.onPress();
    });
    expect(textOf(tree, RNText)).toContain('Facebook sign-in is not connected');
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

describe('an Apple ID with no account yet (RULES O15)', () => {
  const pending = {
    provider: 'apple' as const,
    email: 'x7k2p9@privaterelay.appleid.com',
    linkToken: 'link-1',
    expiresAt: Date.now() + 600_000,
    stage: 'choose' as const,
  };

  // Trees from every test in this file stay mounted and subscribed to the
  // store, so these are unmounted and the store reset inside `act`: outside
  // it, a re-render lands after the test environment is gone and takes the
  // jest worker down with it.
  const trees: ReactTestRenderer.ReactTestRenderer[] = [];
  const renderTracked = async () => {
    const tree = await render();
    trees.push(tree);
    return tree;
  };

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      trees.splice(0).forEach(tree => tree.unmount());
      useAuthStore.setState({ pendingIdentity: null });
    });
  });

  const pressLabelled = async (tree: ReactTestRenderer.ReactTestRenderer, label: string) => {
    const node = tree.root
      .findAll(n => n.props?.label === label && typeof n.props.onPress === 'function')
      .at(-1)!;
    await ReactTestRenderer.act(async () => {
      node.props.onPress();
    });
  };

  test('asks before making a second account, naming what Apple shared', async () => {
    useAuthStore.setState({ pendingIdentity: pending });
    const tree = await renderTracked();
    const text = textOf(tree, RNText);

    expect(text).toContain('New to VOKVE?');
    expect(text).toContain('There is no VOKVE account for this Apple ID yet.');
    expect(text).toContain('x7k2p9@privaterelay.appleid.com');
  });

  test('"I already have an account" turns the sheet into a line over the form', async () => {
    useAuthStore.setState({ pendingIdentity: pending });
    const tree = await renderTracked();

    await pressLabelled(tree, 'I already have an account');

    expect(useAuthStore.getState().pendingIdentity?.stage).toBe('link');
    expect(textOf(tree, RNText)).toContain('Sign in to connect Apple');
  });

  test('"Create a new account" hands the choice to the store', async () => {
    const createAccountFromIdentity = jest.fn().mockResolvedValue(true);
    useAuthStore.setState({ pendingIdentity: pending, createAccountFromIdentity });
    const tree = await renderTracked();

    await pressLabelled(tree, 'Create a new account');

    expect(createAccountFromIdentity).toHaveBeenCalledTimes(1);
  });
});
