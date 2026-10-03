/**
 * The analytics screen draws four different series under one total, every
 * one of them the server's (`/activity/day`, `/activity/range`). The checks
 * here are that the range control asks for the right period at the right
 * grain, that the hourly series is drawn from the server's hours, and that
 * the comparison line reads in the direction the day actually went.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { clearServerReads } from '../src/hooks/useServerRead';
import { AnalyticsScreen } from '../src/screens/main/AnalyticsScreen';
import { ThemeProvider } from '../src/theme';
import { useSettingsStore } from '../src/stores/settingsStore';
import { useStepsStore } from '../src/stores/stepsStore';
import type { ActivityRangeQuery } from '../src/services/api/contracts';
import {
  addDays,
  formatWeekdayShort,
  mondayOf,
  todayIso,
} from '../src/utils/date';

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

const mockActivityApi = {
  day: jest.fn(),
  range: jest.fn(),
};

jest.mock('../src/services/api/endpoints', () => ({
  get activityApi() {
    return mockActivityApi;
  },
  settingsApi: {
    get: jest.fn().mockRejectedValue(new Error('offline')),
    update: jest.fn().mockRejectedValue(new Error('offline')),
  },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

/** Monday to Sunday of this calendar week. */
const WEEK_STEPS = [4200, 7856, 10245, 8650, 6321, 9125, 6245];
/** Today, an hour at a time, as the server drew it. */
const HOURLY = Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 6245 : 0));

const today = todayIso();
const monday = mondayOf(today);

const day = (date: string, steps: number) => ({
  date,
  steps,
  verifiedSteps: steps,
  distanceKm: 4.2,
  activeMinutes: 48,
  caloriesBurned: 358,
  workoutsCompleted: 0,
  source: 'device' as const,
  verified: true,
});

const range = (query: ActivityRangeQuery) => {
  const points =
    query.granularity === 'hour'
      ? HOURLY.map((steps, hour) => ({
          start: `${query.from}T${String(hour).padStart(2, '0')}:00`,
          end: `${query.from}T${String(hour).padStart(2, '0')}:59`,
          steps,
          verifiedSteps: steps,
        }))
      : query.granularity === 'day'
      ? WEEK_STEPS.map((steps, index) => ({
          start: addDays(query.from, index),
          end: addDays(query.from, index),
          steps,
          verifiedSteps: steps,
        }))
      : query.granularity === 'week'
      ? [1, 2, 3, 4, 5].map(week => ({
          start: addDays(query.from, (week - 1) * 7),
          end: addDays(query.from, week * 7 - 1),
          steps: week * 1000,
          verifiedSteps: week * 1000,
        }))
      : Array.from({ length: 12 }, (_, month) => ({
          start: `${query.from.slice(0, 4)}-${String(month + 1).padStart(
            2,
            '0',
          )}-01`,
          end: `${query.from.slice(0, 4)}-${String(month + 1).padStart(
            2,
            '0',
          )}-28`,
          steps: 100_000,
          verifiedSteps: 100_000,
        }));
  return {
    from: query.from,
    to: query.to,
    granularity: query.granularity,
    points,
    totals: {
      steps: 0,
      verifiedSteps: 0,
      distanceKm: 0,
      caloriesBurned: 0,
      activeMinutes: 0,
      activeDays: 0,
    },
    best: null,
  };
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  // Each test asks afresh: the screen otherwise paints the last answer.
  clearServerReads();
  useSettingsStore.setState({ dailyStepGoal: 10_000 });
  useStepsStore.setState({
    serverWeek: WEEK_STEPS.map((steps, index) =>
      day(addDays(monday, index), steps),
    ).filter(entry => entry.date <= today),
  });
  mockActivityApi.day.mockImplementation(async (date: string) =>
    // Yesterday was the better day, so the line has to read downwards.
    day(date, date === today ? 6245 : 9125),
  );
  mockActivityApi.range.mockImplementation(async (query: ActivityRangeQuery) =>
    range(query),
  );
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
          <AnalyticsScreen />
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
  prefix: string,
) => {
  const node = tree.root
    .findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        (n.props.accessibilityLabel as string).startsWith(prefix),
    )
    .find(n => typeof n.props.onPress === 'function');

  if (!node) throw new Error(`No pressable labelled "${prefix}…"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
};

/** The overview's bars, by their accessibility labels. */
const bars = (tree: ReactTestRenderer.ReactTestRenderer, label: RegExp) =>
  new Set(
    tree.root
      .findAll(
        n =>
          typeof n.props?.accessibilityLabel === 'string' &&
          label.test(n.props.accessibilityLabel as string),
      )
      .map(n => n.props.accessibilityLabel as string),
  );

describe('AnalyticsScreen', () => {
  test('the summary states the server’s count, the goal share and the day before', async () => {
    const text = allText(await render());

    expect(mockActivityApi.day).toHaveBeenCalledWith(today);
    expect(mockActivityApi.day).toHaveBeenCalledWith(addDays(today, -1));
    expect(text).toContain('6,245'); // today's steps
    expect(text).toContain('62%'); // of a 10,000 step goal
    expect(text).toContain('Total Steps');
    expect(text).toContain('less than yesterday');
  });

  test('the day range asks for the day by the hour and draws one bar an hour', async () => {
    const tree = await render();

    expect(mockActivityApi.range).toHaveBeenCalledWith({
      from: today,
      to: today,
      granularity: 'hour',
    });
    expect(allText(tree)).toContain('Today, hour by hour');
    expect(bars(tree, /^\d{1,2} (AM|PM), /).size).toBe(24);
    expect(bars(tree, /^9 AM, 6,245 steps$/).size).toBe(1);
  });

  test('switching the range asks for the period at its own grain, under the same total', async () => {
    const tree = await render();

    await press(tree, 'Week');
    expect(mockActivityApi.range).toHaveBeenCalledWith({
      from: monday,
      to: addDays(monday, 6),
      granularity: 'day',
    });
    const text = allText(tree);
    expect(text).toContain('This week, day by day');
    // The headline is a daily readout and deliberately does not follow the
    // range — it would be the least trustworthy number on the screen if it did.
    expect(text).toContain('6,245');

    await press(tree, 'Month');
    expect(mockActivityApi.range).toHaveBeenLastCalledWith(
      expect.objectContaining({ granularity: 'week' }),
    );
    expect(bars(tree, /^W\d, /).size).toBe(5);

    await press(tree, 'Year');
    expect(mockActivityApi.range).toHaveBeenLastCalledWith({
      from: `${today.slice(0, 4)}-01-01`,
      to: `${today.slice(0, 4)}-12-31`,
      granularity: 'month',
    });
    expect(allText(tree)).toContain('This year, month by month');
  });

  test('the week highlights its best day, not its last', async () => {
    const text = allText(await render());

    expect(text).toContain('Best Day This Week');
    expect(text).toContain('10,245 steps');
    expect(text).toContain(
      `${formatWeekdayShort(
        addDays(monday, 2),
      )} — your highest count of the week`,
    );
  });

  test('a week with no steps says so rather than crowning a day', async () => {
    mockActivityApi.range.mockImplementation(
      async (query: ActivityRangeQuery) => ({
        ...range(query),
        points: range(query).points.map(point => ({ ...point, steps: 0 })),
      }),
    );

    expect(allText(await render())).toContain('No steps counted this week yet');
  });

  test('the closing line says how far there is left to go today', async () => {
    useStepsStore.setState({ serverWeek: [day(today, 6245)] });

    expect(allText(await render())).toContain('3,755 steps to go today');
  });

  test('the date opens a calendar', async () => {
    const tree = await render();

    await press(tree, 'Today,');

    expect(allText(tree)).toContain('Show analytics for');
  });

  test('the chevron returns to whatever opened the screen', async () => {
    await press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
