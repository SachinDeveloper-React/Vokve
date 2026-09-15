/**
 * The banner is the soft email gate made visible. Three states matter: gone
 * once the email is verified, "Verify" (request a code) when nothing is
 * pending, and "Enter code" (reopen the screen) when a code is already out.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { EmailVerificationBanner } from '../src/components/account/EmailVerificationBanner';
import { ThemeProvider } from '../src/theme';
import { useAuthStore } from '../src/stores/authStore';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const user = {
  id: 'usr_1', name: 'Asha', email: 'asha@example.com', avatarUrl: null, heightCm: null, weightKg: null,
  dateOfBirth: null, phone: '+919876543210', profileCompletedAt: null, gender: null, goal: 'stay_active' as const,
  activityLevel: 'moderate' as const, units: 'metric' as const, streakDays: 0, weeklyGoalWorkouts: 4,
  createdAt: null, country: 'IN', phoneVerifiedAt: '2026-09-14T00:00:00Z', emailVerifiedAt: null, trustTier: 'normal' as const,
};

const EMAIL_CHALLENGE = {
  verificationId: 'vrf_email', phone: '', channel: 'email' as const, target: 'a•••@example.com',
  codeLength: 6, expiresInSeconds: 300, resendInSeconds: 30,
  devCode: null,
};

const requestEmailVerification = jest.fn().mockResolvedValue(true);

beforeEach(() => {
  mockNavigate.mockClear();
  requestEmailVerification.mockClear();
  useAuthStore.setState({
    status: 'authenticated', user, pendingVerification: null, requestEmailVerification, isSubmitting: false,
  });
});

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <EmailVerificationBanner reason="redeem rewards" />
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

describe('EmailVerificationBanner', () => {
  test('renders nothing once the email is verified', async () => {
    useAuthStore.setState({ user: { ...user, emailVerifiedAt: '2026-09-14T00:00:00Z' } });
    const tree = await render();
    expect(textOf(tree, RNText)).toBe('');
  });

  test('asks for a code when none is pending', async () => {
    const tree = await render();
    expect(textOf(tree, RNText)).toContain('redeem rewards');
    await ReactTestRenderer.act(async () => {
      await pressableFor(tree, 'Verify').props.onPress();
    });
    expect(requestEmailVerification).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('reopens the code screen when one is already out', async () => {
    useAuthStore.setState({ pendingVerification: EMAIL_CHALLENGE });
    const tree = await render();
    expect(textOf(tree, RNText)).toContain('We sent a code to asha@example.com');
    await ReactTestRenderer.act(() => {
      pressableFor(tree, 'Enter code').props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('VerifyContact');
    expect(requestEmailVerification).not.toHaveBeenCalled();
  });
});
