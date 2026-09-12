/**
 * The sign-up form is the longest one in the app, and most of what could break
 * it is invisible from the outside: a password toggle wired to the wrong field,
 * a date picker that commits nothing, a country code that never reaches the
 * request. These checks walk the screen the way a new user does — fill it in,
 * submit it, and see what the store was actually handed.
 *
 * @format
 */

import React from 'react';
import { Text as RNText, TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { SignUpScreen } from '../src/screens/auth/SignUpScreen';
import { ThemeProvider } from '../src/theme';
import { useAuthStore } from '../src/stores/authStore';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const signUp = jest.fn().mockResolvedValue(true);

beforeEach(() => {
  mockGoBack.mockClear();
  mockNavigate.mockClear();
  signUp.mockClear();
  signUp.mockResolvedValue(true);
  useAuthStore.setState({ signUp, isSubmitting: false, error: null });
});

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <SignUpScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

/** The pressable carrying a given label — labels also sit on plain Views. */
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

const inputsOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(TextInput);

/** Email, phone, password, confirm — in the order the screen renders them. */
const fillFields = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  values: [string, string, string, string],
) => {
  const inputs = inputsOf(tree);
  await ReactTestRenderer.act(() => {
    values.forEach((value, index) => inputs[index].props.onChangeText(value));
  });
};

/** Walks the date sheet: open, choose a full date, confirm. */
const pickBirthday = async (tree: ReactTestRenderer.ReactTestRenderer) => {
  await press(tree, 'Date of Birth');
  await press(tree, 'Year 1995');
  await press(tree, 'Month Apr');
  await press(tree, 'Day 17');
  await press(tree, 'Done');
};

const fillValidForm = async (tree: ReactTestRenderer.ReactTestRenderer) => {
  await fillFields(tree, [
    'sachin@example.com',
    '9876543210',
    'longenough1',
    'longenough1',
  ]);
  await pickBirthday(tree);
  await press(tree, 'Female');
  await press(tree, 'I agree to the Terms and Conditions and Privacy Policy');
};

describe('sign-up screen', () => {
  test('renders the wordmark, the heading and every field label', async () => {
    const tree = await render();
    const text = textOf(tree, RNText);

    expect(text).toContain('VOK');
    expect(text).toContain('Create Your Account');
    expect(text).toContain('Join VOKVE and start your fitness journey');
    expect(text).toContain('Date of Birth');
    expect(text).toContain('Gender');
    expect(text).toContain(
      'Password must be at least 8 characters with letters and numbers',
    );
  });

  test('offers all three providers', async () => {
    const tree = await render();

    for (const name of ['Google', 'Apple', 'Facebook']) {
      expect(pressableFor(tree, `Continue with ${name}`)).toBeDefined();
    }
  });

  test('each reveal toggle unmasks only its own field', async () => {
    const tree = await render();
    const password = () => inputsOf(tree)[2];
    const confirm = () => inputsOf(tree)[3];

    expect(password().props.secureTextEntry).toBe(true);
    expect(confirm().props.secureTextEntry).toBe(true);

    await press(tree, 'Show password');

    expect(password().props.secureTextEntry).toBe(false);
    expect(confirm().props.secureTextEntry).toBe(true);
  });

  test('strips punctuation out of a pasted phone number', async () => {
    const tree = await render();

    await fillFields(tree, ['', '+91 98765-43210', '', '']);

    expect(inputsOf(tree)[1].props.value).toBe('919876543210');
  });

  test('blocks submission and explains what is missing', async () => {
    const tree = await render();

    // Emptied explicitly rather than trusting the form's own defaults. Those
    // get pre-filled by hand while the backend is stubbed out, and a test that
    // assumes a blank form quietly stops testing anything the day they are.
    await fillFields(tree, ['', '', '', '']);
    await press(tree, 'Create Account');

    expect(signUp).not.toHaveBeenCalled();
    const text = textOf(tree, RNText);
    expect(text).toContain('Enter your email address');
    expect(text).toContain('Select your date of birth');
    expect(text).toContain('Select an option');
    expect(text).toContain('You need to accept the terms to continue');
  });

  test('reports a password that does not repeat', async () => {
    const tree = await render();

    await fillValidForm(tree);
    await fillFields(tree, [
      'sachin@example.com',
      '9876543210',
      'longenough1',
      'somethingelse2',
    ]);
    await press(tree, 'Create Account');

    expect(signUp).not.toHaveBeenCalled();
    expect(textOf(tree, RNText)).toContain('Passwords do not match');
  });

  test('sends the dial code joined to the number, and drops form-only fields', async () => {
    const tree = await render();

    await fillValidForm(tree);
    await press(tree, 'Create Account');

    expect(signUp).toHaveBeenCalledWith({
      email: 'sachin@example.com',
      phone: '+919876543210',
      password: 'longenough1',
      dateOfBirth: '1995-04-17',
      gender: 'female',
    });
  });

  test('a different country changes the dial code that is sent', async () => {
    const tree = await render();

    await fillValidForm(tree);
    await press(tree, 'Country dial code');
    await press(tree, 'United Kingdom +44');
    await press(tree, 'Create Account');

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+449876543210' }),
    );
  });

  test('hands off to the OTP screen once sign-up is accepted', async () => {
    const tree = await render();

    await fillValidForm(tree);
    await press(tree, 'Create Account');

    expect(mockNavigate).toHaveBeenCalledWith('VerifyOtp');
  });

  test('stays on the form when the server rejects the sign-up', async () => {
    signUp.mockResolvedValue(false);
    const tree = await render();

    await fillValidForm(tree);
    await press(tree, 'Create Account');

    // The store's error is already on screen; moving on would hide it.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('the back arrow leaves the screen', async () => {
    const tree = await render();

    await press(tree, 'Go back');

    expect(mockGoBack).toHaveBeenCalled();
  });

  test('says so rather than doing nothing for the flows that are not wired up', async () => {
    const tree = await render();

    await press(tree, 'Continue with Google');
    expect(textOf(tree, RNText)).toContain('Google sign-up is not connected');
  });
});
