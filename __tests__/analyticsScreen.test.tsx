/**
 * The analytics screen draws four different series under one total, so the
 * checks here are that the range control actually swaps the series, that the
 * hourly one adds up to the figure above it, and that the comparison line
 * reads in the direction the day actually went.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { AnalyticsScreen } from '../src/screens/main/AnalyticsScreen';
import { ThemeProvider } from '../src/theme';
import {
  todayActivity,
  todayHourlySteps,
  weeklySteps,
} from '../src/constants/seedData';
import { useSettingsStore } from '../src/stores/settingsStore';

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

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  useSettingsStore.setState({ dailyStepGoal: 10_000 });
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

/** How many bars the overview is drawing, by their accessibility labels. */
const barCount = (tree: ReactTestRenderer.ReactTestRenderer, suffix: RegExp) =>
  new Set(
    tree.root
      .findAll(
        n =>
          typeof n.props?.accessibilityLabel === 'string' &&
          suffix.test(n.props.accessibilityLabel as string),
      )
      .map(n => n.props.accessibilityLabel as string),
  ).size;

describe('AnalyticsScreen', () => {
  test('the hourly series adds up to the total above it', () => {
    // The chart and the headline figure come from different exports, and this
    // is the one thing that has to stay true between them.
    const sum = todayHourlySteps.reduce((total, steps) => total + steps, 0);
    expect(sum).toBe(todayActivity.steps);
  });

  test('the summary states the count, the goal share and the day before', async () => {
    const text = allText(await render());

    expect(text).toContain('6,245'); // today's steps
    expect(text).toContain('62%'); // of a 10,000 step goal
    expect(text).toContain('Total Steps');
    // Yesterday was the better day in the seed, so the line reads downwards
    // rather than always claiming an improvement.
    expect(text).toContain('less than yesterday');
  });

  test('the day range draws one bar an hour', async () => {
    const tree = await render();

    expect(allText(tree)).toContain('Today, hour by hour');
    expect(barCount(tree, /^\d{1,2} (AM|PM), /)).toBe(24);
  });

  test('switching the range swaps the series under the same total', async () => {
    const tree = await render();

    press(tree, 'Week');

    const text = allText(tree);
    expect(text).toContain('This week, day by day');
    // The headline is a daily readout and deliberately does not follow the
    // range — it would be the least trustworthy number on the screen if it did.
    expect(text).toContain('6,245');

    press(tree, 'Year');
    expect(allText(tree)).toContain('This year, month by month');
  });

  test('the week highlights its best day, not its last', async () => {
    const best = weeklySteps.reduce((top, entry) =>
      entry.steps > top.steps ? entry : top,
    );

    const text = allText(await render());

    expect(text).toContain('Best Day This Week');
    expect(text).toContain('10,245 steps');
    expect(best.day).toBe('Wed');
  });

  test('the closing line says how far there is left to go', async () => {
    expect(allText(await render())).toContain('3,755 steps to go today');
  });

  test('the date opens a calendar', async () => {
    const tree = await render();

    press(tree, 'Today,');

    expect(allText(tree)).toContain('Show analytics for');
  });

  test('the chevron returns to whatever opened the screen', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
