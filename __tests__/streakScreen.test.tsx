/**
 * The streak screen is where a user finds out whether yesterday counted, so
 * the checks here are about the two numbers it leads with and the two tools
 * that can change them. Every figure is the server's: the checks are that the
 * screen shows what `GET /streak` said, that the calendar marks the same days
 * the figures were counted from, that a freeze and a restore are asked of the
 * server and their answers shown, and that nothing is invented before the
 * first answer arrives.
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
import { ApiError } from '../src/services/api/errors';
import { useAuthStore } from '../src/stores/authStore';
import { useCoinsStore } from '../src/stores/coinsStore';
import { useStreakStore } from '../src/stores/streakStore';
import { addDays, formatLongDate, todayIso } from '../src/utils/date';
import type { StreakRun, StreakSummary, User } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
// One object for every render, as the real hook gives: the focus refresh
// depends on it.
const mockNavigation = {
  navigate: mockNavigate,
  goBack: mockGoBack,
  canGoBack: () => true,
  addListener: jest.fn(() => jest.fn()),
};

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

jest.mock('../src/services/api/endpoints', () => ({
  streakApi: {
    get: jest.fn(),
    freeze: jest.fn(),
    restore: jest.fn(),
    history: jest.fn(),
  },
  walletApi: { get: jest.fn(), transactions: jest.fn(), earnRules: jest.fn() },
}));

const { streakApi, walletApi } = jest.requireMock(
  '../src/services/api/endpoints',
) as {
  streakApi: {
    get: jest.Mock;
    freeze: jest.Mock;
    restore: jest.Mock;
    history: jest.Mock;
  };
  walletApi: { get: jest.Mock; transactions: jest.Mock; earnRules: jest.Mock };
};

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

const LADDER = [
  { days: 7, coins: 50 },
  { days: 15, coins: 150 },
  { days: 30, coins: 300 },
  { days: 90, coins: 1000 },
  { days: 180, coins: 2000 },
];

/** What the server would answer for these earned days — its arithmetic, in brief. */
const summaryOf = (
  completed: string[],
  over: Partial<StreakSummary> = {},
): StreakSummary => {
  const days = new Set(completed);
  let cursor = days.has(TODAY) ? TODAY : d(1);
  let current = 0;
  while (days.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  const sorted = [...days].sort();
  let longest: StreakRun | null = null;
  let start = '';
  let length = 0;
  sorted.forEach((day, i) => {
    const follows = i > 0 && addDays(sorted[i - 1], 1) === day;
    start = follows ? start : day;
    length = follows ? length + 1 : 1;
    if (!longest || length > longest.length) {
      longest = { length, start, end: day };
    }
  });
  const best = (longest as StreakRun | null)?.length ?? 0;
  const milestones = LADDER.map(m => ({
    ...m,
    achieved: best >= m.days,
    paid: best >= m.days,
  }));
  return {
    today: TODAY,
    currentStreak: current,
    longestStreak: longest,
    completedDays: sorted,
    protectedDays: [],
    freezesAvailable: 1,
    maxFreezes: 3,
    todayCovered: days.has(TODAY),
    todayFrozen: false,
    canRestore: false,
    restoreGap: [],
    restoreCostCoins: 50,
    restoreWindowDays: 7,
    milestones,
    nextMilestone: milestones.find(m => m.days > current) ?? null,
    howToEarn: 'Finish a workout or walk 10,000 steps in a day.',
    ...over,
  };
};

/** The streak as a finished sync leaves it. */
const showStreak = (summary: StreakSummary) =>
  useStreakStore.setState({
    summary,
    syncedAt: new Date().toISOString(),
    isSyncing: false,
    syncError: null,
    pendingAction: null,
  });

const seedWallet = (balance: number, synced = true) =>
  useCoinsStore.setState({
    balance,
    lifetimeEarned: balance,
    transactions: [],
    syncedAt: synced ? new Date().toISOString() : null,
  });

const RESTORE_LABEL = 'Restore Day';
const FREEZE_LABEL = 'Use Freeze';

/** A record with one completed day, one missed and one restored. */
const HISTORY = {
  data: [
    { date: TODAY, day: 3, status: 'completed' as const, detail: '10,428 steps', steps: 10_428 },
    { date: d(1), day: 2, status: 'completed' as const, detail: '8,932 steps', steps: 8_932 },
    { date: d(2), day: null, status: 'missed' as const, detail: 'No activity', steps: 0 },
  ],
  nextCursor: d(2),
  total: 24,
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  streakApi.get.mockReset();
  streakApi.freeze.mockReset();
  streakApi.restore.mockReset();
  streakApi.history.mockReset().mockResolvedValue(HISTORY);
  walletApi.get.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.transactions.mockReset().mockRejectedValue(new Error('offline'));
  walletApi.earnRules.mockReset().mockRejectedValue(new Error('offline'));
  useAuthStore.setState({ user, status: 'authenticated' });
  useStreakStore.getState().reset();
  seedWallet(1000);
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
  await ReactTestRenderer.act(async () => {
    await node.props.onPress();
  });
};

describe('StreakScreen', () => {
  test('before the first answer it says it is loading, and invents no streak', async () => {
    streakApi.get.mockReturnValue(new Promise(() => {}));

    const tree = await render();

    expect(labelsOf(tree)).toContain('Loading');
    expect(allText(tree)).not.toContain('Best Streak');
    expect(streakApi.get).toHaveBeenCalledTimes(1);
  });

  test('a first answer that failed offers to try again', async () => {
    streakApi.get.mockRejectedValueOnce(
      new ApiError(
        'network',
        'No connection. Check your internet and try again.',
      ),
    );
    const tree = await render();
    expect(allText(tree)).toContain("Couldn't load your streak");

    streakApi.get.mockResolvedValue(summaryOf(run(6, 0)));
    const retry = tree.root
      .findAll(n => n.props?.label === 'Try again')
      .find(n => typeof n.props.onPress === 'function');
    if (!retry) throw new Error('No retry button');
    await ReactTestRenderer.act(async () => {
      await retry.props.onPress();
    });

    expect(allText(tree)).toContain('Best Streak');
  });

  test('leads with the current run and the record beside it', async () => {
    showStreak(summaryOf([...run(25, 11), ...run(6, 0)]));
    const text = allText(await render());

    expect(text).toContain('Current Streak');
    expect(text).toContain('7');
    expect(text).toContain('Best Streak');
    expect(text).toContain('15');
    expect(text).toContain('Keep it going!');
    // The milestone ladder is still on the screen, under the record.
    expect(text).toContain('Streak Benefits');
  });

  test("with no streak it says how to start, in the server's words", async () => {
    showStreak(summaryOf([]));
    const text = allText(await render());

    expect(text).toContain('Current Streak');
    expect(text).toContain('Finish a workout or walk 10,000 steps in a day.');
  });

  test('the calendar marks the days the figures were counted from', async () => {
    const days = run(2, 0);
    showStreak(summaryOf(days));
    const labels = labelsOf(await render());

    // Only this month's days are on the page the calendar opens on.
    const thisMonth = (iso: string) => iso.slice(0, 7) === TODAY.slice(0, 7);
    for (const day of days.filter(thisMonth)) {
      expect(labels).toContain(
        `${formatLongDate(day)}, completed, current streak`,
      );
    }
    if (thisMonth(d(3))) {
      // Three days ago was not earned, and is not in the run.
      expect(labels).toContain(`${formatLongDate(d(3))}, missed`);
    }
  });

  test("a milestone the record has passed shows as earned, from the server's ladder", async () => {
    showStreak(summaryOf(run(6, 0))); // exactly seven days
    const labels = labelsOf(await render());

    expect(labels).toContain('7 days, 50 coins, achieved');
    expect(labels).toContain('15 days, 150 coins');
    expect(labels).not.toContain('15 days, 150 coins, achieved');
  });

  test('a freeze is asked of the server, and its answer is shown', async () => {
    const before = summaryOf(run(6, 1)); // yesterday done, today not yet
    showStreak(before);
    streakApi.freeze.mockResolvedValue({
      ...before,
      protectedDays: [TODAY],
      todayCovered: true,
      todayFrozen: true,
      freezesAvailable: 0,
      currentStreak: 7,
    });
    const tree = await render();

    await press(tree, FREEZE_LABEL);

    expect(streakApi.freeze).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
    });
    expect(useStreakStore.getState().summary?.freezesAvailable).toBe(0);
    const text = allText(tree);
    expect(text).toContain('Streak Freeze active today');
    expect(text).toContain('Today is covered.');
  });

  test("a freeze the server refuses says why, in the server's words", async () => {
    showStreak(summaryOf(run(6, 1)));
    streakApi.freeze.mockRejectedValue(
      new ApiError(
        'unknown',
        'No freezes left. Keep your streak going to earn another.',
        409,
        null,
        'NO_FREEZES_LEFT',
      ),
    );
    streakApi.get.mockResolvedValue(
      summaryOf(run(6, 1), { freezesAvailable: 0 }),
    );
    const tree = await render();

    await press(tree, FREEZE_LABEL);

    const text = allText(tree);
    expect(text).toContain('No freezes left');
    expect(text).toContain('Keep your streak going to earn another.');
    // The refusal means the cache was behind; it is asked again.
    expect(streakApi.get).toHaveBeenCalled();
  });

  test('a restore is paid for on the server, and the wallet takes its answer', async () => {
    const broken = summaryOf(run(10, 3), {
      canRestore: true,
      restoreGap: [d(2), d(1)],
    });
    showStreak(broken);
    streakApi.restore.mockResolvedValue({
      streak: summaryOf([...run(10, 3)], {
        protectedDays: [d(2), d(1)],
        currentStreak: 10,
      }),
      balance: 950,
    });
    const tree = await render();
    expect(allText(tree)).toContain('0'); // the run is broken

    await press(tree, RESTORE_LABEL);

    expect(streakApi.restore).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
    });
    expect(useCoinsStore.getState().balance).toBe(950);
    expect(useStreakStore.getState().summary?.protectedDays).toEqual([
      d(2),
      d(1),
    ]);
    expect(allText(tree)).toContain('Streak restored');
  });

  test('a restore with nothing to bridge is not even asked', async () => {
    showStreak(summaryOf(run(6, 0))); // alive
    const tree = await render();

    await press(tree, RESTORE_LABEL);

    expect(streakApi.restore).not.toHaveBeenCalled();
    expect(useCoinsStore.getState().balance).toBe(1000);
    expect(allText(tree)).toContain('Nothing to restore');
  });

  test('a restore the synced balance cannot cover is not asked either', async () => {
    showStreak(
      summaryOf(run(10, 3), { canRestore: true, restoreGap: [d(2), d(1)] }),
    );
    seedWallet(49);
    const tree = await render();

    await press(tree, RESTORE_LABEL);

    expect(streakApi.restore).not.toHaveBeenCalled();
    expect(allText(tree)).toContain('Not enough coins');
  });

  test('a restore the server refuses for coins says so, and changes nothing here', async () => {
    showStreak(
      summaryOf(run(10, 3), { canRestore: true, restoreGap: [d(2), d(1)] }),
    );
    // The wallet has not synced, so the server is the one to say.
    seedWallet(0, false);
    streakApi.restore.mockRejectedValue(
      new ApiError(
        'validation',
        'You need 30 more coins for this.',
        422,
        { required: 50, balance: 20 },
        'INSUFFICIENT_COINS',
      ),
    );
    streakApi.get.mockResolvedValue(
      summaryOf(run(10, 3), { canRestore: true, restoreGap: [d(2), d(1)] }),
    );
    const tree = await render();

    await press(tree, RESTORE_LABEL);

    const text = allText(tree);
    expect(text).toContain('Not enough coins');
    expect(text).toContain('You need 30 more coins for this.');
    expect(useStreakStore.getState().summary?.protectedDays).toEqual([]);
  });

  test('the record under the tools is the server’s, newest first', async () => {
    showStreak(summaryOf(run(2, 0)));
    const text = allText(await render());

    expect(text).toContain('Streak History');
    expect(text).toContain('Day 3');
    expect(text).toContain('10,428 steps');
    // A missed day is on the record too, not edited out of it.
    expect(text).toContain('Missed');
    expect(text).toContain('No activity');
  });

  test('"View All" opens the whole record', async () => {
    showStreak(summaryOf(run(2, 0)));
    const tree = await render();

    await press(tree, 'View all streak history');
    expect(mockNavigate).toHaveBeenCalledWith('StreakHistory');
  });

  test('a gap the server would bridge is called out above the tools', async () => {
    // A run that ended two days ago: the server offers a restore for the gap.
    showStreak({ ...summaryOf(run(5, 2)), canRestore: true, restoreGap: [d(1)] });
    const text = allText(await render());

    expect(text).toContain('1 day missed');
    expect(text).toContain('Use Freeze or Restore to keep your streak alive.');
  });

  test('no gap, no warning', async () => {
    showStreak(summaryOf(run(2, 0)));
    expect(allText(await render())).not.toContain('day missed');
  });

  test('the call to action follows whether today already counts', async () => {
    showStreak(summaryOf(run(2, 0)));
    expect(allText(await render())).toContain('Today already counts');
  });

  test('a day not yet covered offers the way to keep it alive', async () => {
    showStreak(summaryOf(run(3, 1)));
    const tree = await render();

    expect(allText(tree)).toContain('Keep Your Streak Alive');
    await press(tree, 'Keep Your Streak Alive');
    expect(mockNavigate).toHaveBeenCalledWith('StepTracking');
  });

  test('the "?" opens the guide rather than doing nothing', async () => {
    showStreak(summaryOf(run(2, 0)));
    const tree = await render();

    await press(tree, 'How streaks work');
    expect(mockNavigate).toHaveBeenCalledWith('AppGuide');
  });

  test('the chevron returns to whatever opened the streak', async () => {
    showStreak(summaryOf(run(3, 0)));

    await press(await render(), 'Back');

    // A root screen now: it covers the tab bar, so the header carries the way
    // back rather than leaving it to the platform's gesture.
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('the month can be paged back but not past today', async () => {
    showStreak(summaryOf(run(6, 0)));
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
