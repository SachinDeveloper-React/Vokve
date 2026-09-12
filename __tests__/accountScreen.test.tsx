/**
 * The account screen is mostly navigation, so the checks here are about the
 * three things on it that are not: the profile panel, which is the only place
 * several of these figures appear at all and the only one that compacts a
 * number before showing it; the sign-out row, which is now a list row among
 * six harmless ones and has to still call `signOut`; and the appearance
 * sheet, which is where two live preference controls went when the screen
 * became a menu — a shortcut that opened nothing would strand them.
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
import { useAuthStore } from '../src/stores/authStore';
import { useCoinsStore } from '../src/stores/coinsStore';
import { useStreakStore } from '../src/stores/streakStore';
import { addDays, todayIso } from '../src/utils/date';
import { config } from '../src/constants/config';
import { profileHighlights } from '../src/constants/seedData';
import type { User } from '../src/types/models';

const mockNavigate = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

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

/** A run of `length` days ending today, as the streak store records them. */
const runEndingToday = (length: number) =>
  Array.from({ length }, (_, i) => addDays(todayIso(), -i));

/**
 * Torn down between tests: the screen subscribes to the coin store, so a tree
 * left mounted would still be listening when the next test seeds a balance and
 * would re-render outside `act`.
 */
let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  signOut.mockClear();
  useAuthStore.setState({ user, signOut, status: 'authenticated' });
  useCoinsStore.setState({ balance: 2450 });
  // The streak on the panel is the store's, not the user record's, so the
  // panel and the streak screen's calendar can never show different numbers.
  useStreakStore.setState({
    completedDays: runEndingToday(32),
    protectedDays: [],
    freezesAvailable: 1,
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
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <AccountScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
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
  await ReactTestRenderer.act(() => node.props.onPress());
};

describe('AccountScreen', () => {
  test('the profile panel carries the identity and every headline figure', async () => {
    const text = allText(await render());

    expect(text).toContain('Rana Jay');
    expect(text).toContain(`Level ${profileHighlights.level}`);
    expect(text).toContain(profileHighlights.tierTitle);
    expect(text).toContain(`Member since ${profileHighlights.memberSince}`);
    expect(text).toContain('2,450'); // balance, grouped
    expect(text).toContain('32'); // streak days, counted from the store
    expect(text).toContain(String(profileHighlights.achievements));
  });

  test('lifetime steps are compacted, with the suffix in caps', async () => {
    const text = allText(await render());

    // 245 600 in full would leave nothing else in the strip legible, and a
    // lowercase `k` reads as a typo beside the bold figures either side of it.
    expect(text).toContain('245.6K');
    expect(text).not.toContain('245600');
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

  test('the streak row opens the streak screen inside the Account tab', async () => {
    const tree = await render();

    await press(tree, 'Streak Freeze & Restore. Manage, freeze or restore your streak');

    // The nested path, not a bare route: the streak lives in the Account
    // tab's own stack so the tab bar stays on screen behind it.
    expect(mockNavigate).toHaveBeenCalledWith('Main', {
      screen: 'Account',
      params: { screen: 'Streak' },
    });
  });

  test('a profile that has not loaded still renders a whole screen', async () => {
    useAuthStore.setState({ user: null });

    const text = allText(await render());

    expect(text).toContain('Your account');
    expect(text).toContain('Manage your profile and preferences');
  });
});
