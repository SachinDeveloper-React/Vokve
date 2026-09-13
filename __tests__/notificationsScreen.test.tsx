/**
 * The notification centre is a feed the user reads rather than a set of
 * figures, so the checks here are about the three things that can silently go
 * wrong in one: that a day's rows end up under the right heading, that a chip
 * shows and applies the filter it claims to, and that reading a row clears the
 * unread mark the bell on every other screen is drawn from.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { NotificationsScreen } from '../src/screens/main/NotificationsScreen';
import { ThemeProvider } from '../src/theme';
import { useNotificationsStore } from '../src/stores/notificationsStore';
import type { AppNotification } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
/** Flipped per test: the screen's chevron behaves differently without a stack behind it. */
let mockCanGoBack = true;

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => mockCanGoBack,
  }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

/** A timestamp at a fixed clock time, `days` days ago. */
const at = (days: number, hours: number, minutes: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};

const note = (
  id: string,
  topic: AppNotification['topic'],
  createdAt: string,
  read = false,
): AppNotification => ({
  id,
  topic,
  title: `Title ${id}`,
  message: `Message ${id}`,
  createdAt,
  read,
});

const seed = (notifications: AppNotification[]) =>
  useNotificationsStore.setState({ notifications });

/**
 * Torn down between tests: the screen subscribes to the notifications store, so
 * a tree left mounted would still be listening when the next test seeds the
 * feed and would re-render outside `act`.
 */
let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockCanGoBack = true;
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
          <NotificationsScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

/** The first pressable whose accessibility label starts with `prefix`. */
const press = (tree: ReactTestRenderer.ReactTestRenderer, prefix: string) => {
  const node = tree.root
    .findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        (n.props.accessibilityLabel as string).startsWith(prefix),
    )
    .find(n => typeof n.props.onPress === 'function');

  if (!node) throw new Error(`No pressable labelled "${prefix}…"`);
  ReactTestRenderer.act(() => node.props.onPress());
};

describe('NotificationsScreen', () => {
  test('files each notification under the day it arrived', async () => {
    seed([note('a', 'steps', at(0, 10, 30)), note('b', 'coins', at(1, 18, 30))]);

    const text = allText(await render());

    expect(text).toContain('Today');
    expect(text).toContain('Yesterday');
    expect(text).toContain('10:30 AM');
    expect(text).toContain('6:30 PM');
  });

  test('two notifications on the same day share one heading', async () => {
    seed([note('a', 'steps', at(0, 10, 30)), note('b', 'streak', at(0, 9, 15))]);

    const headings = allText(await render()).match(/Today/g) ?? [];

    expect(headings).toHaveLength(1);
  });

  test('each chip counts the whole category, read rows included', async () => {
    seed([
      note('a', 'steps', at(0, 10, 0)),
      note('b', 'workout', at(0, 9, 0), true),
      note('c', 'coins', at(1, 9, 0), true),
      note('d', 'system', at(2, 9, 0), true),
    ]);

    const tree = await render();
    const labels = tree.root
      .findAll(n => typeof n.props?.accessibilityLabel === 'string')
      .map(n => n.props.accessibilityLabel as string);

    expect(labels).toEqual(expect.arrayContaining(['All, 4']));
    expect(labels).toEqual(expect.arrayContaining(['Activity, 2']));
    expect(labels).toEqual(expect.arrayContaining(['Rewards, 1']));
    expect(labels).toEqual(expect.arrayContaining(['System, 1']));
  });

  test('choosing a filter leaves only that category on screen', async () => {
    seed([note('a', 'steps', at(0, 10, 0)), note('b', 'coins', at(0, 9, 0))]);

    const tree = await render();
    press(tree, 'Rewards,');

    const text = allText(tree);
    expect(text).toContain('Title b');
    expect(text).not.toContain('Title a');
  });

  test('a filter with nothing under it says so instead of a bare card', async () => {
    seed([note('a', 'steps', at(0, 10, 0))]);

    const tree = await render();
    press(tree, 'System,');

    expect(allText(tree)).toContain('Nothing here yet');
  });

  test('reading a row clears the unread mark the bell is drawn from', async () => {
    seed([note('a', 'steps', at(0, 10, 30))]);

    // The label leads with "Unread" while the row is unread, so the prefix is
    // also the assertion that it started that way.
    press(await render(), 'Unread. Title a');

    expect(useNotificationsStore.getState().notifications[0].read).toBe(true);
    expect(
      useNotificationsStore.getState().notifications.some(n => !n.read),
    ).toBe(false);
  });

  test('both settings controls lead to the notification settings', async () => {
    seed([note('a', 'steps', at(0, 10, 0))]);
    const tree = await render();

    press(tree, 'Notification settings');
    expect(mockNavigate).toHaveBeenCalledWith('NotificationSettings');

    mockNavigate.mockClear();
    press(tree, 'Notification Settings. Manage your notification preferences');
    expect(mockNavigate).toHaveBeenCalledWith('NotificationSettings');
  });

  test('the chevron returns to whatever the centre was opened from', async () => {
    seed([note('a', 'steps', at(0, 10, 0))]);

    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('opened cold, the chevron lands on Home rather than doing nothing', async () => {
    // What a notification tap does: the screen is the first route on the
    // stack, and `goBack` from there is silently a no-op.
    mockCanGoBack = false;
    seed([note('a', 'steps', at(0, 10, 0))]);

    press(await render(), 'Back');

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'Home' });
  });

  test('the avatar goes back to the account, not to the bare tab', async () => {
    seed([note('a', 'steps', at(0, 10, 0))]);

    press(await render(), 'Your profile');

    expect(mockNavigate).toHaveBeenCalledWith('Main', {
      screen: 'Account',
      params: { screen: 'AccountHome' },
    });
  });
});
