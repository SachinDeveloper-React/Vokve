/**
 * Adding, proving and changing the phone number (RULES O14).
 *
 * Firebase is the double in jest.setup.js: it "sends" a code and confirms
 * any code into a Firebase user holding the number. What is checked here is
 * the order of things — the server is asked before an SMS is spent, the
 * password is asked only when the number on file would be replaced, and the
 * account changes only on the server's answer — for the three members who
 * arrive here: Google/Apple with no number, a number to prove, a number to
 * replace.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as firebaseAuth from '@react-native-firebase/auth';
import { textOf } from './helpers/text';
import { VerifyPhoneScreen } from '../src/screens/main/VerifyPhoneScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { ApiError } from '../src/services/api/errors';
import { useAuthStore } from '../src/stores/authStore';
import { useCoinsStore } from '../src/stores/coinsStore';
import type { User } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: Record<string, unknown> | undefined;

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
    addListener: jest.fn(() => jest.fn()),
  }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../src/services/api/endpoints', () => ({
  accountApi: { checkPhone: jest.fn(), verifyPhone: jest.fn() },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
  authApi: { signOut: jest.fn() },
}));

const { accountApi } = jest.requireMock('../src/services/api/endpoints') as {
  accountApi: { checkPhone: jest.Mock; verifyPhone: jest.Mock };
};
const firebase = firebaseAuth as unknown as {
  signInWithPhoneNumber: jest.Mock;
  __setUser: (user: { uid: string; phoneNumber: string } | null) => void;
};

const base = {
  id: 'u-1',
  name: 'Rana Jay',
  email: 'rana@example.com',
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
} as unknown as User;
const googleMember = { ...base, phone: null, phoneVerifiedAt: null } as User;
const unprovedMember = { ...base, phone: '+919876543210', phoneVerifiedAt: null } as User;
const provedMember = { ...base, phone: '+919876543210', phoneVerifiedAt: '2026-02-01T00:00:00.000Z' } as User;

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

const settle = () =>
  ReactTestRenderer.act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>
            <VerifyPhoneScreen />
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  await settle();
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) => textOf(tree, RNText);

const typeNumber = async (tree: ReactTestRenderer.ReactTestRenderer, digits: string) => {
  const node = tree.root
    .findAll(n => typeof n.props?.onChangeText === 'function' && /number/i.test(n.props.accessibilityLabel ?? ''))
    .at(-1);
  if (!node) throw new Error('No phone number field');
  await ReactTestRenderer.act(async () => {
    node.props.onChangeText(digits);
  });
};

const typePassword = async (tree: ReactTestRenderer.ReactTestRenderer, value: string) => {
  const node = tree.root
    .findAll(n => n.props?.label === 'Your password' && typeof n.props.onChangeText === 'function')
    .at(-1);
  if (!node) throw new Error('No password field');
  await ReactTestRenderer.act(async () => {
    node.props.onChangeText(value);
  });
};

const pressButton = async (tree: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const node = tree.root
    .findAll(n => n.props?.label === label && typeof n.props.onPress === 'function')
    .at(-1);
  if (!node) throw new Error(`No button labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
};

const enterCode = async (tree: ReactTestRenderer.ReactTestRenderer, code: string) => {
  const node = tree.root.findAll(
    n => typeof n.props?.onComplete === 'function' && n.props.length === 6,
  )[0];
  if (!node) throw new Error('No code field');
  await ReactTestRenderer.act(async () => {
    node.props.onChange(code);
    node.props.onComplete(code);
  });
  await settle();
};

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockRouteParams = undefined;
  accountApi.checkPhone.mockReset().mockResolvedValue({ ok: true });
  accountApi.verifyPhone.mockReset();
  firebase.signInWithPhoneNumber.mockClear();
  firebase.__setUser(null);
  useCoinsStore.setState({ balance: 120 });
});

afterEach(async () => {
  const tree = mounted;
  mounted = null;
  if (tree) {
    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  }
});

describe('a Google or Apple member with no number', () => {
  test('adds one: the server first, then the SMS, then the code, with no password asked', async () => {
    useAuthStore.setState({ user: googleMember, status: 'authenticated' });
    accountApi.verifyPhone.mockResolvedValue({ ...googleMember, phone: '+919812345678', phoneVerifiedAt: '2026-11-16T00:00:00Z' });
    const tree = await render();

    expect(allText(tree)).toContain('Add your phone number');
    expect(allText(tree)).not.toContain('Your password');

    await typeNumber(tree, '9812345678');
    await pressButton(tree, 'Send code');

    expect(accountApi.checkPhone).toHaveBeenCalledWith({ phone: '+919812345678' });
    expect(firebase.signInWithPhoneNumber).toHaveBeenCalledWith(expect.anything(), '+919812345678');
    expect(allText(tree)).toContain('Enter the code');

    await enterCode(tree, '123456');

    expect(accountApi.verifyPhone).toHaveBeenCalledWith({ idToken: 'firebase-id-token:+919812345678' });
    expect(useAuthStore.getState().user?.phoneVerifiedAt).toBeTruthy();
    expect(mockGoBack).toHaveBeenCalled();
  });

  test('a number that is someone else’s is said before any SMS is sent', async () => {
    useAuthStore.setState({ user: googleMember, status: 'authenticated' });
    accountApi.checkPhone.mockRejectedValue(
      new ApiError('validation', 'Check the highlighted fields.', 422, {
        phone: 'That number is already registered to another account.',
      }),
    );
    const tree = await render();

    await typeNumber(tree, '9812345678');
    await pressButton(tree, 'Send code');

    expect(allText(tree)).toContain('That number is already registered to another account.');
    expect(firebase.signInWithPhoneNumber).not.toHaveBeenCalled();
  });

  test('Android proving the number by itself finishes without a code', async () => {
    useAuthStore.setState({ user: googleMember, status: 'authenticated' });
    accountApi.verifyPhone.mockResolvedValue({ ...googleMember, phone: '+919812345678', phoneVerifiedAt: '2026-11-16T00:00:00Z' });
    firebase.signInWithPhoneNumber.mockImplementationOnce(async (_auth: unknown, phoneNumber: string) => {
      firebase.__setUser({ uid: 'firebase-uid', phoneNumber });
      return { verificationId: 'v', confirm: jest.fn() };
    });
    const tree = await render();

    await typeNumber(tree, '9812345678');
    await pressButton(tree, 'Send code');

    expect(accountApi.verifyPhone).toHaveBeenCalledWith({ idToken: 'firebase-id-token:+919812345678' });
    expect(mockGoBack).toHaveBeenCalled();
  });
});

describe('a member with a number on file', () => {
  test('proves the number they signed up with, already typed in, without a password', async () => {
    useAuthStore.setState({ user: unprovedMember, status: 'authenticated' });
    accountApi.verifyPhone.mockResolvedValue({ ...unprovedMember, phoneVerifiedAt: '2026-11-16T00:00:00Z' });
    const tree = await render();

    expect(allText(tree)).toContain('Verify your number');
    expect(allText(tree)).not.toContain('Your password');
    await pressButton(tree, 'Send code');

    expect(accountApi.checkPhone).toHaveBeenCalledWith({ phone: '+919876543210' });
  });

  test('replacing a verified number asks for the password, and sends it both times', async () => {
    useAuthStore.setState({ user: provedMember, status: 'authenticated' });
    accountApi.verifyPhone.mockResolvedValue({ ...provedMember, phone: '+919812345678' });
    const tree = await render();

    expect(allText(tree)).toContain('Change your number');
    await typeNumber(tree, '9812345678');
    expect(allText(tree)).toContain('Your password');

    await pressButton(tree, 'Send code');
    // Not sent without it.
    expect(accountApi.checkPhone).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('Enter your password to change your number.');

    await typePassword(tree, 'walk1000steps');
    await pressButton(tree, 'Send code');
    expect(accountApi.checkPhone).toHaveBeenCalledWith({ phone: '+919812345678', password: 'walk1000steps' });

    await enterCode(tree, '123456');
    expect(accountApi.verifyPhone).toHaveBeenCalledWith({
      idToken: 'firebase-id-token:+919812345678',
      password: 'walk1000steps',
    });
  });
});

test('checkout’s errand is explained', async () => {
  mockRouteParams = { reason: 'redeem' };
  useAuthStore.setState({ user: googleMember, status: 'authenticated' });
  const tree = await render();
  expect(allText(tree)).toContain('One step before you redeem');
});
