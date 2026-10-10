/**
 * The water record (RULES Y4).
 *
 * Two things here are easy to get wrong and both would make the screen lie.
 * The first is a day nobody logged: drawn as 0.0 L it reads as a day of
 * drinking nothing, which is a different fact. The second is the average —
 * divided by the days in the span rather than the days that had water, a
 * week with two entries reads as a week of 600 ml a day. Both figures are
 * the server's here, and the checks are that the screen draws them rather
 * than recomputing them.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { HydrationHistoryScreen } from '../src/screens/main/HydrationHistoryScreen';
import { ThemeProvider } from '../src/theme';
import { clearServerReads } from '../src/hooks/useServerRead';
import { useHydrationStore } from '../src/stores/hydrationStore';
import { addDays, formatLongDate, todayIso } from '../src/utils/date';
import type { HydrationHistory } from '../src/types/models';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
}));

jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    mockLatencyMs: 0,
  },
}));

jest.mock('../src/services/api/endpoints', () => ({
  hydrationApi: {
    history: jest.fn(),
    day: jest.fn(),
  },
}));

const { hydrationApi } = jest.requireMock('../src/services/api/endpoints') as {
  hydrationApi: { history: jest.Mock; day: jest.Mock };
};

const TODAY = todayIso();

/** A span where one day hit the goal, one fell short, and one has nothing. */
const HISTORY: HydrationHistory = {
  from: addDays(TODAY, -2),
  to: TODAY,
  days: [
    { date: TODAY, consumedMl: 2600, goalMl: 2500, goalMet: true, entries: 4 },
    { date: addDays(TODAY, -1), consumedMl: 1200, goalMl: 2500, goalMet: false, entries: 2 },
    { date: addDays(TODAY, -2), consumedMl: 0, goalMl: 2500, goalMet: false, entries: 0 },
  ],
  summary: {
    dailyAverageMl: 1900,
    totalMl: 3800,
    daysLogged: 2,
    daysInRange: 3,
    goalHitRatePercent: 50,
    bestStreakDays: 1,
    bestDay: { date: TODAY, consumedMl: 2600 },
  },
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  clearServerReads();
  hydrationApi.history.mockReset();
  hydrationApi.day.mockReset();
  hydrationApi.history.mockResolvedValue(HISTORY);
  hydrationApi.day.mockResolvedValue({
    date: addDays(TODAY, -1),
    consumedMl: 1200,
    goalMl: 2500,
    entries: [
      { id: 'a', ml: 700, at: `${addDays(TODAY, -1)}T09:00:00.000Z` },
      { id: 'b', ml: 500, at: `${addDays(TODAY, -1)}T14:00:00.000Z` },
    ],
    limits: {
      minMl: 10, maxMl: 3000, maxDailyMl: 10000,
      confirmAboveMl: 5000, hourlyMl: 1500, hourlyMinutes: 60,
    },
    caution: null,
  });
  useHydrationStore.setState({ syncedAt: new Date().toISOString() });
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
          <HydrationHistoryScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
  mounted = tree;
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

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

describe('HydrationHistoryScreen', () => {
  test('asks the server for the week and draws its figures, not its own', async () => {
    const text = allText(await render());

    expect(hydrationApi.history).toHaveBeenCalledWith(
      addDays(TODAY, -6),
      TODAY,
    );
    // 1.9 L is the server's average over the two days that had water. The
    // app must not divide 3.8 L by the three days in the span.
    expect(text).toContain('1.9 L');
    expect(text).toContain('2 of 3 days logged');
    expect(text).toContain('50%');
    expect(text).toContain('3.8 L');
  });

  test('a day nobody logged says so rather than reading as nothing drunk', async () => {
    const text = allText(await render());

    // Zero is a figure; a day nobody recorded is not the same fact.
    expect(text).toContain('Nothing logged');
    expect(text).toContain('2.6 L');
    expect(text).toContain('1.2 L');
  });

  test('the day that reached the goal is marked, and the others are not', async () => {
    const tree = await render();

    const marked = tree.root
      .findAll(
        n =>
          typeof n.props?.accessibilityLabel === 'string' &&
          (n.props.accessibilityLabel as string).includes('goal reached'),
      )
      .map(n => String(n.props.accessibilityLabel));

    expect(new Set(marked).size).toBe(1);
  });

  test('names the biggest day, which is the figure a reader goes looking for', async () => {
    expect(allText(await render())).toContain('Your biggest day was');
  });

  test('a row opens on that day’s own drinks, read-only', async () => {
    const tree = await render();
    const yesterday = addDays(TODAY, -1);

    // By its accessible label, which names the day rather than its position.
    press(tree, formatLongDate(yesterday));
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    expect(hydrationApi.day).toHaveBeenCalledWith(yesterday);
    const text = allText(tree);
    expect(text).toContain('700 ml Water');
    expect(text).toContain('500 ml Water');
    // A past day is a record: no way to delete out of it from here.
    expect(
      tree.root.findAll(
        n =>
          typeof n.props?.accessibilityLabel === 'string' &&
          (n.props.accessibilityLabel as string).startsWith('Remove'),
      ),
    ).toHaveLength(0);
  });

  test('tapping the open row again closes it', async () => {
    const tree = await render();
    const yesterday = addDays(TODAY, -1);

    press(tree, formatLongDate(yesterday));
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });
    expect(allText(tree)).toContain('700 ml Water');

    press(tree, formatLongDate(yesterday));
    expect(allText(tree)).not.toContain('700 ml Water');
  });

  test('switching range asks the server for the new span', async () => {
    const tree = await render();

    press(tree, 'Monthly');
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    expect(hydrationApi.history).toHaveBeenLastCalledWith(
      addDays(TODAY, -89),
      TODAY,
    );
  });

  test('a span that could not be loaded offers a retry rather than empty figures', async () => {
    hydrationApi.history.mockRejectedValue(new Error('offline'));

    const text = allText(await render());

    expect(text).toContain("Couldn't load your water history");
    expect(text).not.toContain('days logged');
  });

  test('the chevron returns to the water screen', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
