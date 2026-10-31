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
  formatDateRange,
  formatLongDate,
  formatWeekdayDate,
  formatWeekdayDay,
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
  /**
   * The invite card the screens now carry. Left on its way, like the tips
   * beside it: a promo is never worth a spinner, so a card that has not
   * arrived is simply not drawn — which keeps these tests about the screen.
   */
  contentApi: { referralCards: jest.fn(() => new Promise(() => {})) },
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
const sunday = addDays(monday, 6);

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
  // The totals are the server's own, not the app's sum of the points — the
  // insights sheet reads them, so a mock that left them at zero would let the
  // sheet quietly add the bars up instead and still pass.
  const steps = points.reduce((sum, point) => sum + point.steps, 0);
  return {
    from: query.from,
    to: query.to,
    granularity: query.granularity,
    points,
    totals: {
      steps,
      verifiedSteps: steps,
      distanceKm: 29.4,
      caloriesBurned: 2506,
      activeMinutes: 336,
      activeDays: query.granularity === 'hour' ? 1 : 7,
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
    // Dated: a chart nobody can date is a shape, not a figure.
    expect(allText(tree)).toContain(
      `Today · ${formatLongDate(today)}, hour by hour`,
    );
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
    expect(text).toContain(
      `This week · ${formatDateRange(monday, sunday)}, day by day`,
    );
    // Each bar is named for the day it covers, not only for its weekday.
    expect(bars(tree, /^Mon \d{1,2}, /).size).toBe(1);
    // The headline is a daily readout and deliberately does not follow the
    // range — it would be the least trustworthy number on the screen if it did.
    expect(text).toContain('6,245');

    await press(tree, 'Month');
    expect(mockActivityApi.range).toHaveBeenLastCalledWith(
      expect.objectContaining({ granularity: 'week' }),
    );
    // The month's weeks are labelled by the days they cover — "1–7" — rather
    // than by a week number nobody can date.
    expect(bars(tree, /^1–7, /).size).toBe(1);
    expect(bars(tree, /^\d{1,2}–\d{1,2}, /).size).toBe(5);

    await press(tree, 'Year');
    expect(mockActivityApi.range).toHaveBeenLastCalledWith({
      from: `${today.slice(0, 4)}-01-01`,
      to: `${today.slice(0, 4)}-12-31`,
      granularity: 'month',
    });
    expect(allText(tree)).toContain(
      `This year · ${today.slice(0, 4)}, month by month`,
    );
  });

  test('the trend card says which week it is drawing, whatever the range', async () => {
    const text = allText(await render());

    expect(text).toContain(`This week · ${formatDateRange(monday, sunday)}`);
    expect(text).toContain(formatWeekdayDay(monday));
  });

  describe('period overview', () => {
    test('asks for a rolling window of days, and re-asks when it is widened', async () => {
      const tree = await render();

      // Seven days ending on the day being read, not the calendar week.
      expect(mockActivityApi.range).toHaveBeenCalledWith({
        from: addDays(today, -6),
        to: today,
        granularity: 'day',
      });
      // And the same length of time before it, for the comparison.
      expect(mockActivityApi.range).toHaveBeenCalledWith({
        from: addDays(today, -13),
        to: addDays(today, -7),
        granularity: 'day',
      });

      await press(tree, '30 days');

      expect(mockActivityApi.range).toHaveBeenCalledWith({
        from: addDays(today, -29),
        to: today,
        granularity: 'day',
      });
      expect(allText(tree)).toContain(
        `${formatDateRange(addDays(today, -29), today)} · active on`,
      );
    });

    test('totals the window to the verified share, never the raw count', async () => {
      // Half of each day verified: the steps *and* the kilometres halve, or
      // the card states a distance its own step count could not cover.
      mockActivityApi.range.mockImplementation(
        async (query: ActivityRangeQuery) => {
          const answer = range(query);
          return {
            ...answer,
            totals: { ...answer.totals, verifiedSteps: answer.totals.steps / 2 },
          };
        },
      );

      const text = allText(await render());

      expect(text).toContain('26,321'); // 52,642 verified down to half
      expect(text).toContain('14.7 km'); // and 29.4 km with it
    });

    test('counts the days of the window that reached the goal', async () => {
      // One of the seven mocked days clears 10,000.
      expect(allText(await render())).toContain('1 / 7');
    });
  });

  describe('most active', () => {
    test('names the busiest day of the window and the busiest hour of the day', async () => {
      const text = allText(await render());

      expect(text).toContain('Busiest day of the last 7 days');
      expect(text).toContain(formatWeekdayDate(addDays(today, -4)));
      expect(text).toContain('10,245 steps');
      // The hourly series puts every step in the 9 AM hour.
      expect(text).toContain('Busiest hour on');
      expect(text).toContain('9 AM – 10 AM');
    });

    test('a window with no steps crowns no day', async () => {
      mockActivityApi.range.mockImplementation(
        async (query: ActivityRangeQuery) => {
          const answer = range(query);
          return {
            ...answer,
            points: answer.points.map(point => ({
              ...point,
              steps: 0,
              verifiedSteps: 0,
            })),
            totals: { ...answer.totals, steps: 0, verifiedSteps: 0 },
          };
        },
      );

      expect(allText(await render())).toContain('Nothing counted yet');
    });

    test('the busiest day opens that day in full', async () => {
      const tree = await render();

      await press(tree, 'Busiest day of the last 7 days');

      const text = allText(tree);
      expect(text).toContain(formatLongDate(addDays(today, -4)));
      expect(text).toContain('Busiest hour');
    });
  });

  describe('activity calendar', () => {
    test('asks for the whole month a day at a time, and labels its days', async () => {
      const text = allText(await render());
      const month = today.slice(0, 7);

      expect(mockActivityApi.range).toHaveBeenCalledWith({
        from: `${month}-01`,
        to: expect.stringContaining(month),
        granularity: 'day',
      });
      expect(text).toContain('Activity Calendar');
      expect(text).toContain('Mon');
      expect(text).toContain('Goal met');
    });

    test('a day in the grid opens that day in full', async () => {
      const tree = await render();
      const picked = `${today.slice(0, 7)}-02`;

      await press(tree, formatLongDate(picked));

      expect(allText(tree)).toContain(formatLongDate(picked));
      expect(mockActivityApi.day).toHaveBeenCalledWith(picked);
    });

    test('opening a day leaves the rest of the screen where it was', async () => {
      // The bug this covers: opening a day used to move the screen's anchor,
      // which emptied every card behind the sheet while five reads were in
      // flight — and the sheet opened on a day of zeros for the same reason.
      const tree = await render();
      const picked = `${today.slice(0, 7)}-02`;

      await press(tree, formatLongDate(picked));

      const text = allText(tree);
      // The sheet has the day it was asked for …
      expect(text).toContain('9,125');
      // … and the summary behind it is still today's.
      expect(text).toContain('6,245');
      expect(text).toContain(`Today · ${formatLongDate(today)}, hour by hour`);
    });

    test('"Show this day" is what moves the whole screen onto it', async () => {
      const tree = await render();
      const picked = `${today.slice(0, 7)}-02`;

      await press(tree, formatLongDate(picked));
      await press(tree, 'Show this day');

      const text = allText(tree);
      expect(text).toContain(`${formatLongDate(picked)}, hour by hour`);
      expect(text).not.toContain(`Today · ${formatLongDate(today)}`);
    });

    test('a day the screen is already on is not offered "Show this day"', async () => {
      const tree = await render();

      await press(tree, formatLongDate(today));

      // The sheet is open on today, which is where the screen already is.
      expect(allText(tree)).toContain('Busiest hour');
      expect(
        tree.root.findAll(n => n.props?.label === 'Show this day'),
      ).toHaveLength(0);
    });

    test('a day still on its way says so rather than drawing zeros', async () => {
      const picked = `${today.slice(0, 7)}-02`;
      mockActivityApi.day.mockImplementation(async (date: string) => {
        if (date === picked) return new Promise(() => {}) as Promise<never>;
        return day(date, date === today ? 6245 : 9125);
      });

      const tree = await render();
      await press(tree, formatLongDate(picked));

      const text = allText(tree);
      expect(text).toContain('Fetching this day');
      // Nothing is asserted about the walk until the server has answered.
      expect(text).not.toContain('steps short of the goal');
    });
  });

  test('the AI report control is gone from the summary', async () => {
    const tree = await render();

    expect(allText(tree)).not.toContain('Report');
    expect(
      tree.root.findAll(
        n => n.props?.accessibilityLabel === 'AI report',
      ),
    ).toHaveLength(0);
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

  test('view insights opens the breakdown of the period on screen', async () => {
    const tree = await render();

    await press(tree, 'View insights');

    const text = allText(tree);
    expect(text).toContain('Steps Insights');
    expect(text).toContain(`Today · ${formatLongDate(today)}, hour by hour`);
    // The day's own total and its busiest hour, both from the hourly read.
    expect(text).toContain('Total steps');
    expect(text).toContain('Busiest hour');
    expect(text).toContain('9 AM · 6,245');
    expect(text).toContain('That total is 62% of the 10,000 step daily goal.');
  });

  test('the breakdown follows the range it was opened over', async () => {
    const tree = await render();

    await press(tree, 'Week');
    await press(tree, 'View insights');

    const text = allText(tree);
    expect(text).toContain(
      `This week · ${formatDateRange(monday, sunday)}, day by day`,
    );
    expect(text).toContain('Busiest day');
    // The busiest bar is named as the chart names it, date and all.
    expect(text).toContain(`${formatWeekdayDay(addDays(monday, 2))} · 10,245`);
    // 52,642 steps over the seven days the server counted.
    expect(text).toContain('Daily average');
    expect(text).toContain('7,520');
  });

  test('the chevron returns to whatever opened the screen', async () => {
    await press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
