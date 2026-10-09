/**
 * The account screen is the member's own summary plus a lot of navigation,
 * so the checks here are about the seams: that every figure on the panel is
 * the server's and not a seeded one, that the completeness card names what
 * is missing and leads to the right screen for it, that the tab's two
 * shelves stay distinct — the achievement shelf the rest of the app shows,
 * and the account's own milestones — that sign-out still signs out,
 * and that the appearance sheet — the one live control left on the screen —
 * still opens.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { AccountScreen } from '../src/screens/main/AccountScreen';
import { ThemeProvider } from '../src/theme';
import { clearServerReads } from '../src/hooks/useServerRead';
import { useAccountStore } from '../src/stores/accountStore';
import { useAuthStore } from '../src/stores/authStore';
import { useCoinsStore } from '../src/stores/coinsStore';
import { useNotificationsStore } from '../src/stores/notificationsStore';
import { config } from '../src/constants/config';
import type { ProfileSummary, User } from '../src/types/models';

const mockNavigate = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    addListener: jest.fn(() => jest.fn()),
  }),
}));

jest.mock('../src/services/api/endpoints', () => ({
  accountApi: { profile: jest.fn(), privacy: jest.fn(), deletion: jest.fn() },
  challengeApi: { achievements: jest.fn() },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
  notificationApi: {
    list: jest.fn(),
    counts: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
  authApi: { signOut: jest.fn() },
}));

const { accountApi, challengeApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  accountApi: { profile: jest.Mock };
  challengeApi: { achievements: jest.Mock };
};

/** The shelf the tab shows, the same one the board and the shelf screen do. */
const shelf = [
  { id: 'a-10k-steps', value: 10_000, label: '10K Steps', metric: 'steps' as const, achievedAt: '2026-09-18T19:32:00.000Z' },
  { id: 'a-cal-burner', value: 500, label: 'Cal Burner', metric: 'calories' as const, achievedAt: '2026-09-11T08:10:00.000Z' },
  { id: 'a-active-30', value: 30, label: 'Active 30', metric: 'minutes' as const, achievedAt: '2026-09-02T18:00:00.000Z' },
  { id: 'a-20k-steps', value: 20_000, label: '20K Steps', metric: 'steps' as const, achievedAt: null },
];

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const signOut = jest.fn().mockResolvedValue(undefined);

const user = {
  id: 'u-1',
  name: 'Rana Jay',
  email: 'rana@vokve.app',
  avatarUrl: null,
} as unknown as User;

/** Level 18 sits at 32,400 lifetime coins; the next level starts at 36,100. */
const summary: ProfileSummary = {
  level: 18,
  tierTitle: 'Athlo Warrior',
  xp: 33_400,
  xpIntoLevel: 1_000,
  xpForNextLevel: 3_700,
  levelProgress: 1_000 / 3_700,
  memberSince: '2025-05-14T00:00:00.000Z',
  rank: 412,
  totalMembers: 18_940,
  stats: {
    coins: 2_450,
    lifetimeCoins: 33_400,
    currentStreak: 32,
    longestStreak: 41,
    totalSteps: 245_600,
    activeDays: 96,
    totalWorkouts: 34,
    totalWorkoutMinutes: 1_632,
    orders: 3,
    referrals: 2,
  },
  badges: [
    {
      id: 'streak-7',
      label: 'Week One',
      description: 'A seven-day streak',
      icon: 'flame',
      unlocked: true,
      unlockedAt: null,
      progress: 1,
      value: 7,
      goal: 7,
    },
    {
      id: 'streak-30',
      label: 'Month Strong',
      description: 'A thirty-day streak',
      icon: 'flame',
      unlocked: true,
      unlockedAt: null,
      progress: 1,
      value: 30,
      goal: 30,
    },
    {
      id: 'workouts-25',
      label: 'Regular',
      description: '25 workouts finished',
      icon: 'dumbbell',
      unlocked: false,
      unlockedAt: null,
      progress: 0.4,
      value: 10,
      goal: 25,
    },
  ],
  completeness: 75,
  gaps: [
    { field: 'avatarUrl', label: 'Add a profile photo', weight: 10 },
    { field: 'phone', label: 'Verify your phone', weight: 10 },
    { field: 'address', label: 'Add a delivery address', weight: 5 },
  ],
  trustTier: 'normal',
};

/**
 * Torn down between tests: the screen subscribes to the coin store, so a tree
 * left mounted would still be listening when the next test seeds a balance and
 * would re-render outside `act`.
 */
let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  signOut.mockClear();
  accountApi.profile.mockReset().mockResolvedValue(summary);
  challengeApi.achievements.mockReset().mockResolvedValue(shelf);
  clearServerReads();
  useAuthStore.setState({ user, signOut, status: 'authenticated' });
  useCoinsStore.setState({ balance: 2450 });
  // One unread row, so the bell carries its dot.
  useNotificationsStore.setState({
    notifications: [
      {
        id: 'n1',
        topic: 'coins',
        title: 'Coins added',
        message: 'You earned 20 coins.',
        createdAt: new Date().toISOString(),
        read: false,
      },
    ],
    counts: null,
    syncedAt: new Date().toISOString(),
  });
  useAccountStore.setState({
    profile: summary,
    privacy: null,
    deletion: null,
    syncedAt: new Date().toISOString(),
    isSyncing: false,
    savingPrivacy: [],
    syncError: null,
  });
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

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <AccountScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    await Promise.resolve();
  });
  mounted = tree;
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
};

describe('AccountScreen', () => {
  test('every figure on the panel is the server summary, not a seeded one', async () => {
    const text = allText(await render());

    expect(text).toContain('Rana Jay');
    expect(text).toContain('Level 18');
    expect(text).toContain('Athlo Warrior');
    expect(text).toContain('Member since May 2025');
    // The level bar reads from the band, and the rank from the whole field.
    expect(text).toContain('1,000 / 3,700 to level 19');
    expect(text).toContain('#412 of 18.9k');
    expect(text).toContain('2,450'); // the wallet's balance, grouped
    expect(text).toContain('32'); // the server's current streak
    expect(text).toContain('3'); // badges earned, off the achievement shelf
  });

  test('lifetime steps are compacted, with the suffix in caps', async () => {
    const text = allText(await render());

    // 245 600 in full would leave nothing else in the strip legible, and a
    // lowercase `k` reads as a typo beside the bold figures either side of it.
    expect(text).toContain('245.6K');
    expect(text).not.toContain('245600');
  });

  test('the completeness card names what is missing and what each gap is worth', async () => {
    const text = allText(await render());

    expect(text).toContain('Finish your profile');
    expect(text).toContain('75%');
    expect(text).toContain('Add a profile photo');
    expect(text).toContain('+10%');
  });

  test('a gap opens the screen that can actually close it', async () => {
    const tree = await render();

    await press(tree, 'Add a profile photo');
    expect(mockNavigate).toHaveBeenLastCalledWith('EditProfile', {
      focus: 'avatarUrl',
    });

    // A contact is changed under Security, and an address in the address book —
    // neither lives on the profile form.
    await press(tree, 'Verify your phone');
    expect(mockNavigate).toHaveBeenLastCalledWith('Security');

    await press(tree, 'Add a delivery address');
    expect(mockNavigate).toHaveBeenLastCalledWith('Addresses');
  });

  test('a finished profile drops the card rather than congratulating forever', async () => {
    useAccountStore.setState({
      profile: { ...summary, completeness: 100, gaps: [] },
    });

    expect(allText(await render())).not.toContain('Finish your profile');
  });

  test('the achievements card is the shelf the rest of the app shows', async () => {
    const text = allText(await render());

    expect(text).toContain('Achievements');
    expect(text).toContain('10K Steps');
    expect(text).toContain('Cal Burner');
    // Locked ones keep their place, as on the board.
    expect(text).toContain('20K Steps');
  });

  test('a badge opens its own screen, and View All opens the shelf', async () => {
    const tree = await render();

    await press(tree, '10K Steps, achieved');
    expect(mockNavigate).toHaveBeenLastCalledWith('AchievementDetail', {
      id: 'a-10k-steps',
    });

    await press(tree, 'View all achievements');
    expect(mockNavigate).toHaveBeenLastCalledWith('Achievements');
  });

  test('the account milestones are their own shelf, under their own name', async () => {
    const text = allText(await render());

    // Not "Achievements": these are account milestones, a different list.
    expect(text).toContain('Milestones');
    expect(text).toContain('2 of 3 reached');
    expect(text).toContain('Regular'); // locked, still on the shelf
    expect(text).toContain('10/25');
  });

  test('the about row states the version the app actually ships as', async () => {
    expect(allText(await render())).toContain(`v${config.appVersion}`);
  });

  test('the log out row signs the user out', async () => {
    const tree = await render();

    await press(tree, 'Log Out. Sign out from your account');

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test('the appearance shortcut is what reveals the preference controls', async () => {
    const tree = await render();

    // The screen itself is a menu — the live controls are not on it until the
    // sheet is opened, which is the whole reason the shortcut has to work.
    expect(allText(tree)).not.toContain('System');

    await press(tree, 'Appearance');

    const text = allText(tree);
    expect(text).toContain('System');
    expect(text).toContain('kg / cm');
  });

  test('each menu row and shortcut opens its own root route', async () => {
    const tree = await render();

    const cases: [string, string][] = [
      [
        'Streak Freeze & Restore. Manage, freeze or restore your streak',
        'Streak',
      ],
      ['Notifications, unread', 'Notifications'],
      ['My Rewards. View and track your rewards', 'LeaderboardRewards'],
      ['Notification Settings', 'NotificationSettings'],
      ['Edit Profile', 'EditProfile'],
      ['Privacy', 'Privacy'],
      ['Security', 'Security'],
      ['Wishlist. Everything you saved for later', 'Wishlist'],
      ['Help & Support. Get help and find answers', 'HelpSupport'],
      [
        `About VOKVE, v${config.appVersion}. App info, version and more`,
        'About',
      ],
      ['Health Data. Your vitals and health check up', 'HealthCheckup'],
      ['Step Tracking. Step counting, Health Connect and sync', 'StepTracking'],
    ];

    for (const [label, route] of cases) {
      await press(tree, label);
      expect(mockNavigate).toHaveBeenLastCalledWith(route);
    }
  });

  test('a profile that has not loaded still renders a whole screen', async () => {
    useAuthStore.setState({ user: null });
    useAccountStore.setState({ profile: null });

    const text = allText(await render());

    expect(text).toContain('Your account');
    expect(text).toContain('Manage your profile and preferences');
    // The panel draws without a summary rather than vanishing, so the screen
    // does not reflow the moment the first sync lands — but nothing that is
    // only meaningful with one (the level bar, the badge shelf, the
    // completeness card) is drawn from placeholders.
    expect(text).toContain('Getting started');
    expect(text).not.toContain('to level');
    expect(text).not.toContain('earned');
    expect(text).not.toContain('Finish your profile');
  });
});
