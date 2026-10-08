/**
 * The screens the account tab leads to all touch something irreversible —
 * a password, a contact, a deletion — so the checks here are about the
 * gates rather than the layout: that the profile form converts units at the
 * boundary and puts a server refusal on the field it belongs to, that a
 * contact change ends at the code screen instead of moving anything on its
 * own, that a privacy switch reverts when the server says no, that a
 * deletion can be scheduled and called off, and that the help centre
 * searches the server rather than a bundled list.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { AboutScreen } from '../src/screens/main/AboutScreen';
import { EditProfileScreen } from '../src/screens/main/EditProfileScreen';
import { HelpSupportScreen } from '../src/screens/main/HelpSupportScreen';
import { HelpTopicScreen } from '../src/screens/main/HelpTopicScreen';
import { ContactUsScreen } from '../src/screens/main/ContactUsScreen';
import { ReportIssueScreen } from '../src/screens/main/ReportIssueScreen';
import { AppGuideScreen } from '../src/screens/main/AppGuideScreen';
import { PrivacyScreen } from '../src/screens/main/PrivacyScreen';
import { SecurityScreen } from '../src/screens/main/SecurityScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { ApiError } from '../src/services/api/errors';
import { useAccountStore } from '../src/stores/accountStore';
import { useAuthStore } from '../src/stores/authStore';
import { useCoinsStore } from '../src/stores/coinsStore';
import { useSettingsStore } from '../src/stores/settingsStore';
import type {
  AccountSession,
  AppAbout,
  AppGuide,
  SupportFaq,
  SupportHome,
  SupportTicket,
  User,
} from '../src/types/models';

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

jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));

jest.mock('../src/services/api/endpoints', () => ({
  accountApi: {
    profile: jest.fn(),
    privacy: jest.fn(),
    updatePrivacy: jest.fn(),
    changePassword: jest.fn(),
    changeEmail: jest.fn(),
    changePhone: jest.fn(),
    sessions: jest.fn(),
    revokeOtherSessions: jest.fn(),
    exportData: jest.fn(),
    deletion: jest.fn(),
    scheduleDeletion: jest.fn(),
    cancelDeletion: jest.fn(),
  },
  supportApi: {
    home: jest.fn(),
    guide: jest.fn(),
    faqs: jest.fn(),
    tickets: jest.fn(),
    ticket: jest.fn(),
    createTicket: jest.fn(),
    reply: jest.fn(),
  },
  appApi: { about: jest.fn() },
  userApi: {
    me: jest.fn(),
    updateProfile: jest.fn(),
    completeProfile: jest.fn(),
    uploadAvatar: jest.fn(),
    removeAvatar: jest.fn(),
  },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
  settingsApi: {
    get: jest.fn().mockRejectedValue(new Error('offline')),
    update: jest.fn(async (patch: Record<string, unknown>) => ({
      units: 'metric',
      dailyStepGoal: 10000,
      dailyWaterGoalMl: 2500,
      restTimerSeconds: 90,
      hapticsEnabled: true,
      workoutRemindersEnabled: true,
      keepAwakeDuringWorkout: true,
      ...patch,
    })),
  },
  notificationApi: {
    list: jest.fn(),
    counts: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
  authApi: { signOut: jest.fn(), stepUp: jest.fn() },
}));

const { accountApi, supportApi, appApi, userApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  accountApi: Record<string, jest.Mock>;
  supportApi: Record<string, jest.Mock>;
  appApi: { about: jest.Mock };
  userApi: {
    updateProfile: jest.Mock;
    uploadAvatar: jest.Mock;
    removeAvatar: jest.Mock;
  };
};

const { launchCamera, launchImageLibrary } = jest.requireMock(
  'react-native-image-picker',
) as { launchCamera: jest.Mock; launchImageLibrary: jest.Mock };

/** A one-pixel JPEG, as the picker hands it back: base64 with its type. */
const PICKED = {
  assets: [
    {
      base64: '/9j/4AAQSkZJRg==',
      type: 'image/jpeg',
      uri: 'file:///tmp/pick.jpg',
    },
  ],
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const user = {
  id: 'u-1',
  name: 'Rana Jay',
  email: 'rana@vokve.app',
  phone: '+919876543210',
  avatarUrl: null,
  heightCm: 175,
  weightKg: 70,
  dateOfBirth: '1994-03-21',
  gender: 'female',
  goal: 'stay_active',
  activityLevel: 'moderate',
  units: 'metric',
  weeklyGoalWorkouts: 4,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  phoneVerifiedAt: null,
} as unknown as User;

const SESSIONS: AccountSession[] = [
  {
    id: 'dev-1',
    platform: 'android',
    model: 'Pixel 8',
    brand: 'Google',
    osVersion: '14',
    appVersion: '1.0.1',
    firstSeenAt: '2026-08-01T00:00:00.000Z',
    lastSeenAt: new Date().toISOString(),
    isCurrent: true,
  },
  {
    id: 'dev-2',
    platform: 'ios',
    model: 'iPhone 13',
    brand: 'Apple',
    osVersion: '17.4',
    appVersion: '1.0.0',
    firstSeenAt: '2026-05-01T00:00:00.000Z',
    lastSeenAt: '2026-09-10T00:00:00.000Z',
    isCurrent: false,
  },
];

const FAQS: SupportFaq[] = [
  {
    id: 'faq-coins-expiry',
    category: 'coins',
    question: 'Do my coins expire?',
    answer: 'After 90 days without earning.',
  },
  {
    id: 'faq-orders-track',
    category: 'orders',
    question: 'Where is my order?',
    answer: 'My Orders shows every order.',
  },
];

/** The help centre as the server lays it out (RULES A9). */
const SUPPORT_HOME: SupportHome = {
  topics: [
    { id: 'faq', title: 'Frequently Asked Questions', subtitle: 'Find quick answers to common questions', kind: 'faq', category: null, icon: 'question', tint: 'destructive', count: 2 },
    { id: 'contact', title: 'Contact Us', subtitle: 'Get in touch with our support team', kind: 'contact', category: null, icon: 'mail', tint: 'primary', count: null },
    { id: 'report', title: 'Report an Issue', subtitle: 'Facing a problem? Let us know', kind: 'report', category: null, icon: 'alert', tint: 'success', count: null },
    { id: 'orders', title: 'Orders & Shipping', subtitle: 'Track orders, returns and replacements', kind: 'faq', category: 'orders', icon: 'package', tint: 'brandAccent', count: 1 },
    { id: 'guide', title: 'App Guide', subtitle: 'How to use VOKVE (step by step)', kind: 'guide', category: null, icon: 'guide', tint: 'success', count: null },
  ],
  chat: {
    title: 'Chat with our Support Team',
    subtitle: 'Still need help?',
    responseTime: 'We usually reply within 24 hours.',
    openTicketId: null,
  },
  channels: [
    { kind: 'email', label: 'Email us', value: 'support@vokve.app', url: 'mailto:support@vokve.app', note: 'We usually reply within 24 hours.' },
    { kind: 'phone', label: 'Call us', value: '+918000000000', url: 'tel:+918000000000', note: 'Mon–Sat, 9 am – 7 pm IST' },
  ],
  hours: 'Mon–Sat, 9 am – 7 pm IST',
};

const GUIDE: AppGuide = {
  title: 'App Guide',
  subtitle: 'How to use VOKVE, step by step',
  sections: [
    {
      id: 'guide-start',
      title: 'Getting started',
      summary: 'Set the app up once and it keeps count for you.',
      icon: 'guide',
      tint: 'primary',
      steps: [
        { title: 'Create your account', body: 'Sign up with your phone and email.' },
        { title: 'Allow step tracking', body: 'VOKVE reads steps from your phone’s health service.' },
      ],
    },
  ],
};

const TICKET: SupportTicket = {
  id: 'tkt-1',
  reference: 'VK-7Q2M',
  subject: 'Coins missing',
  category: 'coins',
  status: 'open',
  messages: [
    {
      id: 'msg-1',
      from: 'user',
      body: 'I walked 12,000 steps and nothing arrived.',
      createdAt: new Date().toISOString(),
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ABOUT: AppAbout = {
  name: 'VOKVE',
  company: 'VOKVE Fitness',
  version: '1.0.0',
  build: '1',
  latestVersion: '1.2.0',
  minVersion: '1.0.0',
  updateRequired: false,
  updateAvailable: true,
  storeUrl: 'https://play.google.com/store/apps/details?id=com.vokve',
  releaseNotes: [
    {
      version: '1.2.0',
      releasedAt: '2026-09-17T00:00:00.000Z',
      notes: 'Shop, cart and checkout with coins.',
    },
  ],
  links: {
    privacy: 'https://vokve.app/privacy',
    terms: 'https://vokve.app/terms',
    licenses: 'https://vokve.app/licenses',
    website: 'https://vokve.app',
  },
  supportEmail: 'support@vokve.app',
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockRouteParams = undefined;
  for (const fn of Object.values(accountApi)) fn.mockReset();
  for (const fn of Object.values(supportApi)) fn.mockReset();
  appApi.about.mockReset().mockResolvedValue(ABOUT);
  userApi.updateProfile
    .mockReset()
    .mockImplementation(async patch => ({ ...user, ...patch }));
  userApi.uploadAvatar.mockReset().mockResolvedValue({
    ...user,
    avatarUrl: 'https://api.vokve.app/v1/media/avatars/avt_1',
  });
  userApi.removeAvatar
    .mockReset()
    .mockResolvedValue({ ...user, avatarUrl: null });
  launchCamera.mockReset().mockResolvedValue({ didCancel: true });
  launchImageLibrary.mockReset().mockResolvedValue({ didCancel: true });
  useAuthStore.setState({ isSavingAvatar: false });
  accountApi.sessions.mockResolvedValue(SESSIONS);
  accountApi.privacy.mockResolvedValue({
    analytics: true,
    personalisedOffers: true,
    shareNameWithReferrer: true,
  });
  accountApi.deletion.mockResolvedValue({
    scheduledAt: null,
    purgeAt: null,
    reason: null,
    graceDays: 14,
  });
  supportApi.home.mockResolvedValue(SUPPORT_HOME);
  supportApi.guide.mockResolvedValue(GUIDE);
  supportApi.faqs.mockResolvedValue(FAQS);
  supportApi.tickets.mockResolvedValue([]);
  useAuthStore.setState({
    user,
    status: 'authenticated',
    isSubmitting: false,
    pendingVerification: null,
  });
  useAccountStore.getState().reset();
  useCoinsStore.setState({ balance: 2450 });
  useSettingsStore.setState({ units: 'metric' });
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

const settle = () =>
  ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

const render = async (screen: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>{screen}</ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  mounted = tree;
  await settle();
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
};

const pressButton = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = tree.root
    .findAll(
      n => n.props?.label === label && typeof n.props.onPress === 'function',
    )
    .at(-1);
  if (!node) throw new Error(`No button labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
};

/** Types into the field whose accessibility label (or label prop) matches. */
const type = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
  value: string,
) => {
  const node = tree.root
    .findAll(
      n =>
        n.props?.label === label && typeof n.props.onChangeText === 'function',
    )
    .at(-1);
  if (!node) throw new Error(`No field labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onChangeText(value);
  });
};

const setSwitch = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
  value: boolean,
) => {
  const node = tree.root
    .findAll(
      n =>
        n.props?.accessibilityLabel === label &&
        typeof n.props.onValueChange === 'function',
    )
    .at(-1);
  if (!node) throw new Error(`No switch labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onValueChange(value);
  });
  await settle();
};

describe('EditProfileScreen', () => {
  test('fills from the user and saves canonical units, then re-syncs the profile', async () => {
    const tree = await render(<EditProfileScreen />);

    // Metric: the stored centimetres are shown as they are.
    const height = tree.root
      .findAll(n => n.props?.label === 'Height' && n.props?.value !== undefined)
      .at(-1);
    expect(height?.props.value).toBe(175);

    await type(tree, 'Full name', 'Rana Jayanti');
    await pressButton(tree, 'Save changes');

    expect(userApi.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Rana Jayanti',
        heightCm: 175,
        weightKg: 70,
        units: 'metric',
      }),
    );
    expect(accountApi.profile).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  test('converts to canonical units when the member types in imperial', async () => {
    useAuthStore.setState({ user: { ...user, units: 'imperial' } });
    const tree = await render(<EditProfileScreen />);

    // 175cm is 68.9in and 70kg is 154.3lb, as the form shows them.
    const height = tree.root
      .findAll(n => n.props?.label === 'Height' && n.props?.value !== undefined)
      .at(-1);
    expect(height?.props.value).toBeCloseTo(68.9, 1);

    await pressButton(tree, 'Save changes');
    const payload = userApi.updateProfile.mock.calls[0][0];
    expect(payload.units).toBe('imperial');
    expect(payload.heightCm).toBeCloseTo(175, 0);
    expect(payload.weightKg).toBeCloseTo(70, 0);
  });

  test('refuses an impossible measurement before it reaches the server', async () => {
    const tree = await render(<EditProfileScreen />);

    const weight = tree.root
      .findAll(
        n =>
          n.props?.label === 'Weight' &&
          typeof n.props?.onChange === 'function',
      )
      .at(-1);
    await ReactTestRenderer.act(async () => {
      weight!.props.onChange(900);
    });
    await pressButton(tree, 'Save changes');

    expect(userApi.updateProfile).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('Check your weight');
  });

  test('a server field error lands on the field it names', async () => {
    userApi.updateProfile.mockRejectedValue(
      new ApiError('validation', 'Check the highlighted fields.', 422, {
        name: 'That name is not allowed.',
      }),
    );
    const tree = await render(<EditProfileScreen />);

    await pressButton(tree, 'Save changes');

    expect(allText(tree)).toContain('That name is not allowed.');
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});

describe('SecurityScreen', () => {
  test('lists the devices, marks the current one, and signs the rest out', async () => {
    accountApi.revokeOtherSessions.mockResolvedValue({ signedOut: 1 });
    const tree = await render(<SecurityScreen />);

    const text = allText(tree);
    expect(text).toContain('Google Pixel 8');
    expect(text).toContain('This device');
    expect(text).toContain('Apple iPhone 13');

    await pressButton(tree, 'Sign out 1 other device');
    await press(tree, 'Sign out other devices');

    expect(accountApi.revokeOtherSessions).toHaveBeenCalled();
    expect(accountApi.sessions).toHaveBeenCalledTimes(2); // re-read after
  });

  test('a wrong current password lands on its own field, not in a toast', async () => {
    accountApi.changePassword.mockRejectedValue(
      new ApiError(
        'validation',
        'That is not your current password.',
        422,
        { currentPassword: 'That is not your current password.' },
        'PASSWORD_INCORRECT',
      ),
    );
    const tree = await render(<SecurityScreen />);

    await pressButton(tree, 'Change'); // the password row's button is the last "Change"
    await type(tree, 'Current password', 'wrongpass1');
    await type(tree, 'New password', 'newpass123');
    await type(tree, 'Confirm new password', 'newpass123');
    await pressButton(tree, 'Change password');

    expect(accountApi.changePassword).toHaveBeenCalledWith({
      currentPassword: 'wrongpass1',
      newPassword: 'newpass123',
    });
    expect(allText(tree)).toContain('That is not your current password.');
  });

  test('a changed password says how many devices it signed out', async () => {
    accountApi.changePassword.mockResolvedValue({
      ok: true,
      signedOutSessions: 2,
    });
    const tree = await render(<SecurityScreen />);

    await pressButton(tree, 'Change');
    await type(tree, 'Current password', 'walk1000steps');
    await type(tree, 'New password', 'newpass123');
    await type(tree, 'Confirm new password', 'newpass123');
    await pressButton(tree, 'Change password');

    const text = allText(tree);
    expect(text).toContain('Password changed');
    expect(text).toContain('2 other devices were signed out.');
  });

  test('an email change moves nothing on its own: it parks a challenge and opens the code screen', async () => {
    const challenge = {
      verificationId: 'vrf-1',
      phone: '',
      channel: 'email' as const,
      target: 'n•••@example.com',
      codeLength: 6,
      expiresInSeconds: 300,
      resendInSeconds: 30,
      devCode: null,
      purpose: 'change_email' as const,
    };
    accountApi.changeEmail.mockResolvedValue(challenge);
    const tree = await render(<SecurityScreen />);

    // The email row's Change is the first of the three.
    const changeButtons = tree.root.findAll(
      n => n.props?.label === 'Change' && typeof n.props.onPress === 'function',
    );
    await ReactTestRenderer.act(async () => {
      changeButtons[0].props.onPress();
    });
    await settle();

    await type(tree, 'New email', 'new@example.com');
    await type(tree, 'Your password', 'walk1000steps');
    await pressButton(tree, 'Send code');

    expect(accountApi.changeEmail).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'walk1000steps',
    });
    // The account is untouched until the code passes; the OTP screen has it.
    expect(useAuthStore.getState().user?.email).toBe('rana@vokve.app');
    expect(useAuthStore.getState().pendingVerification).toMatchObject({
      verificationId: 'vrf-1',
    });
    expect(mockNavigate).toHaveBeenCalledWith('Auth', { screen: 'VerifyOtp' });
  });

  test('shows which contacts are verified', async () => {
    const text = allText(await render(<SecurityScreen />));
    expect(text).toContain('rana@vokve.app');
    expect(text).toContain('Verified');
    expect(text).toContain('Not verified'); // the phone, in this fixture
  });
});

describe('PrivacyScreen', () => {
  test('flips a switch at once and puts it back when the server refuses', async () => {
    accountApi.updatePrivacy.mockResolvedValue({
      analytics: false,
      personalisedOffers: true,
      shareNameWithReferrer: true,
    });
    const tree = await render(<PrivacyScreen />);

    await setSwitch(tree, 'Usage analytics', false);
    expect(accountApi.updatePrivacy).toHaveBeenCalledWith({ analytics: false });
    expect(useAccountStore.getState().privacy?.analytics).toBe(false);

    accountApi.updatePrivacy.mockRejectedValueOnce(
      new ApiError('network', 'You appear to be offline.'),
    );
    await setSwitch(tree, 'Personalised offers', false);
    expect(useAccountStore.getState().privacy?.personalisedOffers).toBe(true);
    expect(allText(tree)).toContain("Couldn't save that");
  });

  test('schedules a deletion the password proves, then offers the way back', async () => {
    const purgeAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    accountApi.scheduleDeletion.mockResolvedValue({
      scheduledAt: new Date().toISOString(),
      purgeAt,
      reason: null,
      graceDays: 14,
    });
    accountApi.cancelDeletion.mockResolvedValue({
      scheduledAt: null,
      purgeAt: null,
      reason: null,
      graceDays: 14,
    });
    const tree = await render(<PrivacyScreen />);

    expect(allText(tree)).toContain(
      'Scheduled 14 days ahead so you can change your mind',
    );

    await pressButton(tree, 'Delete my account');
    await type(tree, 'Your password', 'walk1000steps');
    await pressButton(tree, 'Schedule deletion');

    expect(accountApi.scheduleDeletion).toHaveBeenCalledWith({
      password: 'walk1000steps',
      reason: undefined,
    });
    const text = allText(tree);
    expect(text).toContain('Deletion scheduled');
    expect(text).toContain('Your account is scheduled for deletion');

    await pressButton(tree, 'Cancel deletion');
    await press(tree, 'Keep my account');
    expect(accountApi.cancelDeletion).toHaveBeenCalled();
    expect(allText(tree)).toContain('Deletion cancelled');
  });

  test('a wrong password on the deletion sheet stays on the field', async () => {
    accountApi.scheduleDeletion.mockRejectedValue(
      new ApiError(
        'validation',
        'That is not your password.',
        422,
        { password: 'That is not your password.' },
        'PASSWORD_INCORRECT',
      ),
    );
    const tree = await render(<PrivacyScreen />);

    await pressButton(tree, 'Delete my account');
    await type(tree, 'Your password', 'nope');
    await pressButton(tree, 'Schedule deletion');

    expect(allText(tree)).toContain('That is not your password.');
  });

  test('an export asked for too soon says when to come back', async () => {
    accountApi.exportData.mockRejectedValue(
      new ApiError(
        'rate_limited',
        'Your last export was recent.',
        429,
        { retryAfterSeconds: 7200 },
        'EXPORT_TOO_SOON',
      ),
    );
    const tree = await render(<PrivacyScreen />);

    await pressButton(tree, 'Prepare my data');

    const text = allText(tree);
    expect(text).toContain('You asked for this recently');
    expect(text).toContain('Try again in about 2 hours.');
  });
});

describe('HelpSupportScreen', () => {
  test('lays the page out as the design has it: the server\'s rows, the chat card and the sign-off', async () => {
    const tree = await render(<HelpSupportScreen />);
    const text = allText(tree);

    expect(supportApi.home).toHaveBeenCalled();
    expect(text).toContain("We're here to help you");
    // Every row is the server's, in the server's order.
    expect(text).toContain('Frequently Asked Questions');
    expect(text).toContain('Find quick answers to common questions');
    expect(text).toContain('Contact Us');
    expect(text).toContain('Report an Issue');
    expect(text).toContain('Orders & Shipping');
    expect(text).toContain('App Guide');
    // The promise at the foot is the server's words, never ours.
    expect(text).toContain('Chat with our Support Team');
    expect(text).toContain('We usually reply within 24 hours.');
    expect(text).toContain('Move More. Live Better.');
    // The rows are the page until something is searched for.
    expect(text).not.toContain('Do my coins expire?');
  });

  test('each row opens what its kind says, and the shelf rows carry their category', async () => {
    const tree = await render(<HelpSupportScreen />);

    await press(tree, 'Contact Us. Get in touch with our support team');
    expect(mockNavigate).toHaveBeenCalledWith('ContactUs');

    await press(tree, 'Report an Issue. Facing a problem? Let us know');
    expect(mockNavigate).toHaveBeenCalledWith('ReportIssue', {});

    await press(tree, 'App Guide. How to use VOKVE (step by step)');
    expect(mockNavigate).toHaveBeenCalledWith('AppGuide');

    await press(tree, 'Orders & Shipping. Track orders, returns and replacements');
    expect(mockNavigate).toHaveBeenCalledWith('HelpTopic', {
      title: 'Orders & Shipping',
      subtitle: 'Track orders, returns and replacements',
      category: 'orders',
    });

    // The shelf that holds everything sends no category at all.
    await press(tree, 'Frequently Asked Questions. Find quick answers to common questions');
    expect(mockNavigate).toHaveBeenLastCalledWith('HelpTopic', {
      title: 'Frequently Asked Questions',
      subtitle: 'Find quick answers to common questions',
      category: null,
    });
  });

  test('searching takes the page over and asks the server a beat behind the typing', async () => {
    jest.useFakeTimers();
    const tree = await render(<HelpSupportScreen />);
    expect(supportApi.faqs).not.toHaveBeenCalled();

    const field = tree.root
      .findAll(
        n =>
          n.props?.accessibilityLabel === 'Search for help' &&
          typeof n.props.onChangeText === 'function',
      )
      .at(-1);
    await ReactTestRenderer.act(async () => {
      field!.props.onChangeText('expire');
    });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(400);
    });
    jest.useRealTimers();
    await settle();

    expect(supportApi.faqs).toHaveBeenLastCalledWith({ q: 'expire' });
    const text = allText(tree);
    expect(text).toContain('Do my coins expire?');
    // The rows step aside while there is something in the box.
    expect(text).not.toContain('Find quick answers to common questions');
  });

  test('"Chat Now" carries on the conversation already open, and starts one when there is none', async () => {
    const tree = await render(<HelpSupportScreen />);
    await pressButton(tree, 'Chat Now');
    expect(mockNavigate).toHaveBeenCalledWith('ReportIssue', {});

    supportApi.home.mockResolvedValue({
      ...SUPPORT_HOME,
      chat: { ...SUPPORT_HOME.chat, openTicketId: 'tkt-1' },
    });
    const waiting = await render(<HelpSupportScreen />);
    await pressButton(waiting, 'Continue');
    expect(mockNavigate).toHaveBeenLastCalledWith('SupportTicket', {
      id: 'tkt-1',
    });
  });
});

describe('HelpTopicScreen', () => {
  test('asks for its own shelf and lists what is on it', async () => {
    mockRouteParams = {
      title: 'Orders & Shipping',
      subtitle: 'Track orders, returns and replacements',
      category: 'orders',
    };
    const text = allText(await render(<HelpTopicScreen />));

    expect(supportApi.faqs).toHaveBeenCalledWith({
      q: undefined,
      category: 'orders',
    });
    expect(text).toContain('Orders & Shipping');
    expect(text).toContain('Where is my order?');
    // The way to a human rides along, with the server's promise on it.
    expect(text).toContain('We usually reply within 24 hours.');
  });

  test('an empty shelf offers the form instead, already on its topic', async () => {
    mockRouteParams = { title: 'Coins & Rewards', category: 'coins' };
    supportApi.faqs.mockResolvedValue([]);
    const tree = await render(<HelpTopicScreen />);

    expect(allText(tree)).toContain('Nothing here yet');
    await pressButton(tree, 'Report an issue');
    expect(mockNavigate).toHaveBeenCalledWith('ReportIssue', {
      category: 'coins',
    });
  });
});

describe('ContactUsScreen', () => {
  test('lists the ways the server says support can be reached, and when', async () => {
    const text = allText(await render(<ContactUsScreen />));

    expect(text).toContain('Email us');
    expect(text).toContain('support@vokve.app');
    expect(text).toContain('Call us');
    expect(text).toContain('+918000000000');
    expect(text).toContain('Mon–Sat, 9 am – 7 pm IST');
  });

  test('a channel the server does not send is not offered', async () => {
    supportApi.home.mockResolvedValue({
      ...SUPPORT_HOME,
      channels: [SUPPORT_HOME.channels[0]],
      hours: null,
    });
    const text = allText(await render(<ContactUsScreen />));

    expect(text).toContain('Email us');
    expect(text).not.toContain('Call us');
    expect(text).not.toContain('When we are in');
  });
});

describe('ReportIssueScreen', () => {
  test('sends what the member wrote and lands on its thread', async () => {
    supportApi.createTicket.mockResolvedValue(TICKET);
    const tree = await render(<ReportIssueScreen />);

    await type(tree, 'What is it about?', 'Coins missing');
    await type(
      tree,
      'What happened?',
      'I walked 12,000 steps yesterday and nothing arrived.',
    );
    await pressButton(tree, 'Send to support');

    expect(supportApi.createTicket).toHaveBeenCalledWith({
      subject: 'Coins missing',
      category: 'other',
      message: 'I walked 12,000 steps yesterday and nothing arrived.',
    });
    expect(allText(tree)).toContain('Reported — VK-7Q2M');
    expect(mockNavigate).toHaveBeenCalledWith('SupportTicket', { id: 'tkt-1' });
  });

  test('opened from a shelf, the form starts on that topic', async () => {
    supportApi.createTicket.mockResolvedValue(TICKET);
    mockRouteParams = { category: 'orders' };
    const tree = await render(<ReportIssueScreen />);

    await type(tree, 'What is it about?', 'Parcel never arrived');
    await type(
      tree,
      'What happened?',
      'It has said shipped for nine days and the courier page is blank.',
    );
    await pressButton(tree, 'Send to support');

    expect(supportApi.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'orders' }),
    );
  });

  test('a message too short for the server is refused before it is sent', async () => {
    const tree = await render(<ReportIssueScreen />);

    await type(tree, 'What is it about?', 'Help');
    await type(tree, 'What happened?', 'broken');
    await pressButton(tree, 'Send to support');

    expect(supportApi.createTicket).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('at least 20 characters');
  });

  test('what has already been reported is listed under the form', async () => {
    supportApi.tickets.mockResolvedValue([TICKET]);
    const text = allText(await render(<ReportIssueScreen />));

    expect(text).toContain('What you have reported');
    expect(text).toContain('Coins missing');
    expect(text).toContain('VK-7Q2M');
    expect(text).toContain('Open');
  });
});

describe('AppGuideScreen', () => {
  test('draws the server\'s chapters as numbered steps', async () => {
    const text = allText(await render(<AppGuideScreen />));

    expect(supportApi.guide).toHaveBeenCalled();
    expect(text).toContain('Getting started');
    expect(text).toContain('Set the app up once and it keeps count for you.');
    expect(text).toContain('Create your account');
    expect(text).toContain('Allow step tracking');
    expect(text).toContain('1');
    expect(text).toContain('2');
  });

  test('a guide nobody has written yet says so rather than showing an empty page', async () => {
    supportApi.guide.mockResolvedValue({ ...GUIDE, sections: [] });
    expect(allText(await render(<AppGuideScreen />))).toContain(
      'The guide is on its way',
    );
  });
});

describe('AboutScreen', () => {
  test('states the build, judges it against the server, and carries the legal links', async () => {
    const text = allText(await render(<AboutScreen />));

    expect(text).toContain('1.0.0 (1)');
    expect(text).toContain('Version 1.2.0 is out');
    expect(text).toContain('Update available');
    expect(text).toContain("What's new");
    expect(text).toContain('Shop, cart and checkout with coins.');
    expect(text).toContain('Privacy policy');
    expect(text).toContain('Open-source licences');
    expect(text).toContain('support@vokve.app');
  });

  test('an unsupported build is told so in the loudest words the screen has', async () => {
    appApi.about.mockResolvedValue({
      ...ABOUT,
      updateRequired: true,
      version: '0.9.0',
    });
    const text = allText(await render(<AboutScreen />));

    expect(text).toContain('This version is no longer supported');
    expect(text).toContain('Unsupported');
  });
});

describe('AvatarPicker on Edit Profile (RULES P10)', () => {
  test('a chosen photo uploads at once and the record points at what the server stored', async () => {
    launchImageLibrary.mockResolvedValue(PICKED);
    const tree = await render(<EditProfileScreen />);

    await press(tree, 'Add a profile photo');
    await press(tree, 'Choose from library');

    // Downscaled on the phone before it travels, and sent as base64 + type.
    expect(launchImageLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        maxWidth: 512,
        maxHeight: 512,
        includeBase64: true,
        mediaType: 'photo',
      }),
    );
    expect(userApi.uploadAvatar).toHaveBeenCalledWith({
      data: '/9j/4AAQSkZJRg==',
      contentType: 'image/jpeg',
    });
    expect(useAuthStore.getState().user?.avatarUrl).toBe(
      'https://api.vokve.app/v1/media/avatars/avt_1',
    );
    // The completeness figure counts the photo, so it is re-read.
    expect(accountApi.profile).toHaveBeenCalled();
    expect(allText(tree)).toContain('Photo updated');
  });

  test('the camera is the other way in, and backing out of either changes nothing', async () => {
    launchCamera.mockResolvedValue(PICKED);
    const tree = await render(<EditProfileScreen />);

    await press(tree, 'Add a profile photo');
    await press(tree, 'Take a photo');
    expect(userApi.uploadAvatar).toHaveBeenCalledTimes(1);

    launchCamera.mockResolvedValue({ didCancel: true });
    await press(tree, 'Change your profile photo');
    await press(tree, 'Take a photo');
    expect(userApi.uploadAvatar).toHaveBeenCalledTimes(1);
  });

  test('"Remove photo" is offered only once there is one, and it clears the record', async () => {
    const tree = await render(<EditProfileScreen />);

    await press(tree, 'Add a profile photo');
    expect(
      tree.root.findAll(n => n.props?.accessibilityLabel === 'Remove photo'),
    ).toHaveLength(0);

    // With a photo on file the third action appears.
    await ReactTestRenderer.act(async () => {
      useAuthStore.setState({
        user: {
          ...user,
          avatarUrl: 'https://api.vokve.app/v1/media/avatars/avt_1',
        },
      });
    });
    await press(tree, 'Change your profile photo');
    await press(tree, 'Remove photo');

    expect(userApi.removeAvatar).toHaveBeenCalled();
    expect(useAuthStore.getState().user?.avatarUrl).toBeNull();
    expect(allText(tree)).toContain('Photo removed');
  });

  test('a photo the server refuses is worded, and nothing local changes', async () => {
    launchImageLibrary.mockResolvedValue(PICKED);
    userApi.uploadAvatar.mockRejectedValue(
      new ApiError(
        'unknown',
        'Photos must be under 512 KB.',
        413,
        { maxKb: 512 },
        'AVATAR_TOO_LARGE',
      ),
    );
    const tree = await render(<EditProfileScreen />);

    await press(tree, 'Add a profile photo');
    await press(tree, 'Choose from library');

    const text = allText(tree);
    expect(text).toContain('That photo is too large');
    expect(text).toContain('Photos must be under 512 KB.');
    expect(useAuthStore.getState().user?.avatarUrl).toBeNull();
  });

  test('a refused permission says where to fix it rather than failing silently', async () => {
    launchImageLibrary.mockResolvedValue({ errorCode: 'permission' });
    const tree = await render(<EditProfileScreen />);

    await press(tree, 'Add a profile photo');
    await press(tree, 'Choose from library');

    expect(userApi.uploadAvatar).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('Permission needed');
  });
});
