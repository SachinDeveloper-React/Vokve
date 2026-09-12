/**
 * The streak screen is where a user finds out whether yesterday counted, so
 * the checks here are about the two numbers it leads with and the two tools
 * that can change them: that the figures come from the day list, that the
 * calendar marks the same days the figures were counted from, that a
 * milestone the record has passed shows as earned, and that a restore
 * charges coins only when there is a gap to bridge.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { StreakScreen } from '../src/screens/main/StreakScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { useAuthStore } from '../src/stores/authStore';
import { useCoinsStore } from '../src/stores/coinsStore';
import {
  STREAK_RESTORE_COST,
  useStreakStore,
} from '../src/stores/streakStore';
import { addDays, formatLongDate, todayIso } from '../src/utils/date';
import type { User } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const user = {
  id: 'u-1',
  name: 'Rana Jay',
  email: 'rana@vokve.app',
  avatarUrl: null,
} as unknown as User;

const TODAY = todayIso();
const d = (daysAgo: number) => addDays(TODAY, -daysAgo);
const run = (from: number, to: number) =>
  Array.from({ length: from - to + 1 }, (_, i) => d(from - i));

const seedStreak = (completedDays: string[], freezesAvailable = 1) =>
  useStreakStore.setState({ completedDays, protectedDays: [], freezesAvailable });

const seedCoins = (balance: number) =>
  useCoinsStore.setState({ balance, lifetimeEarned: balance, transactions: [] });

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  useAuthStore.setState({ user, status: 'authenticated' });
  seedCoins(1000);
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
          <ToastProvider>
            <StreakScreen />
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

const labelsOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll(n => typeof n.props?.accessibilityLabel === 'string')
    .map(n => n.props.accessibilityLabel as string);

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

describe('StreakScreen', () => {
  test('leads with the current run and the record, dated', async () => {
    seedStreak([...run(25, 11), ...run(6, 0)]);
    const text = allText(await render());

    expect(text).toContain('7');
    expect(text).toContain('15');
    expect(text).toContain("You're on fire!");
    // The record's dates, not the current run's.
    expect(text).toContain('Achieved on');
  });

  test('the calendar marks the days the figures were counted from', async () => {
    seedStreak(run(2, 0));
    const labels = labelsOf(await render());

    expect(labels).toContain(`${formatLongDate(TODAY)}, completed, current streak`);
    expect(labels).toContain(`${formatLongDate(d(2))}, completed, current streak`);
    // Three days ago was not trained, and is not in the run.
    expect(labels).toContain(`${formatLongDate(d(3))}, missed`);
  });

  test('a milestone the record has passed shows as earned', async () => {
    seedStreak(run(6, 0)); // exactly seven days
    const labels = labelsOf(await render());

    expect(labels).toContain('7 days, 50 coins, achieved');
    expect(labels).toContain('15 days, 150 coins');
    expect(labels).not.toContain('15 days, 150 coins, achieved');
  });

  test('a freeze covers today, is used up, and says so', async () => {
    seedStreak(run(6, 1), 1); // yesterday done, today not yet
    const tree = await render();

    await press(tree, 'Streak Freeze, 1 Available. Protect your streak for 24 hours.');

    expect(useStreakStore.getState().freezesAvailable).toBe(0);
    expect(useStreakStore.getState().protectedDays).toEqual([TODAY]);
    expect(allText(tree)).toContain('Streak Freeze active today');
  });

  test('a restore charges the coins and bridges the gap', async () => {
    seedStreak(run(10, 3)); // ran until three days ago, missed two since
    const tree = await render();
    expect(allText(tree)).toContain('0'); // the run is broken

    await press(tree, `Streak Restore, ${STREAK_RESTORE_COST} Coins. Missed a day? Restore your streak.`);

    expect(useCoinsStore.getState().balance).toBe(1000 - STREAK_RESTORE_COST);
    expect(useStreakStore.getState().protectedDays).toEqual([d(2), d(1)]);
    // Bridged: the run now reaches yesterday, so it is 10 - 3 + 1 + 2 = 10 long.
    expect(allText(tree)).toContain('Streak restored');
  });

  test('a restore with nothing to bridge charges nothing', async () => {
    seedStreak(run(6, 0)); // alive
    const tree = await render();

    await press(tree, `Streak Restore, ${STREAK_RESTORE_COST} Coins. Missed a day? Restore your streak.`);

    expect(useCoinsStore.getState().balance).toBe(1000);
    expect(allText(tree)).toContain('Nothing to restore');
  });

  test('a restore the balance cannot cover is refused before anything changes', async () => {
    seedStreak(run(10, 3));
    seedCoins(STREAK_RESTORE_COST - 1);
    const tree = await render();

    await press(tree, `Streak Restore, ${STREAK_RESTORE_COST} Coins. Missed a day? Restore your streak.`);

    expect(useStreakStore.getState().protectedDays).toEqual([]);
    expect(allText(tree)).toContain('Not enough coins');
  });

  test('the chevron returns to whatever opened the streak', async () => {
    seedStreak(run(3, 0));

    await press(await render(), 'Back');

    // A root screen now: it covers the tab bar, so the header carries the way
    // back rather than leaving it to the platform's gesture.
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('the month can be paged back but not past today', async () => {
    seedStreak(run(6, 0));
    const tree = await render();

    const next = tree.root
      .findAll(n => n.props?.accessibilityLabel === 'Next month')
      .find(n => typeof n.props.onPress === 'function');
    expect(next?.props.accessibilityState?.disabled).toBe(true);

    await press(tree, 'Previous month');

    const after = tree.root
      .findAll(n => n.props?.accessibilityLabel === 'Next month')
      .find(n => typeof n.props.onPress === 'function');
    expect(after?.props.accessibilityState?.disabled).toBe(false);
  });
});
