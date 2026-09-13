/**
 * The history reads the same per-day buckets the add-meal screen writes into,
 * so the checks here are that a day nobody logged is told apart from a day of
 * nothing, that the ranges are the same days counted differently, and that
 * every list can be walked into.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { NutritionHistoryScreen } from '../src/screens/main/NutritionHistoryScreen';
import { ThemeProvider } from '../src/theme';
import { useNutritionStore } from '../src/stores/nutritionStore';
import {
  addDays,
  formatLongDate,
  fromIsoDate,
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

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  useNutritionStore.getState().reset();
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
          <NutritionHistoryScreen />
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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The label a day row carries, which is how a test finds one to press. */
const dayRowLabel = (date: string) =>
  `${WEEKDAYS[fromIsoDate(date).getDay()]}, ${formatLongDate(date)}`;

describe('NutritionHistoryScreen', () => {
  test("today's diary opens with its figures and its meals", async () => {
    const text = allText(await render());

    expect(text).toContain('1,650'); // what the seeded plate comes to
    expect(text).toContain('of 2,200');
    expect(text).toContain('Breakfast');
    expect(text).toContain('Oats with milk'); // the items, not a count
  });

  test('the previous days carry their own totals', async () => {
    const tree = await render();

    // The week before today is seeded from the diet plan, so yesterday has a
    // real figure rather than a blank.
    const yesterday = formatLongDate(addDays(todayIso(), -1));
    expect(allText(tree)).toContain('Previous Days');
    expect(allText(tree)).toContain(yesterday);
  });

  test('a day nobody logged says so instead of reading zero', async () => {
    // Wipe the diary: every day is now unlogged, which is not the same as a
    // day of no calories.
    useNutritionStore.setState({ entriesByDate: {} });

    expect(allText(await render())).toContain('Nothing logged');
  });

  test('the pager walks back a day at a time', async () => {
    const tree = await render();
    expect(allText(tree)).toContain(formatLongDate(todayIso()));

    press(tree, 'Previous day');

    expect(allText(tree)).toContain(formatLongDate(addDays(todayIso(), -1)));
  });

  test('a range averages the days that were logged, not the days in it', async () => {
    const tree = await render();

    press(tree, 'Weekly');

    const text = allText(tree);
    expect(text).toContain('This week');
    expect(text).toContain('kcal a day');
    // Seven seeded days out of seven in the window.
    expect(text).toContain('7/7');
  });

  test('the custom range swaps the pager for its own two ends', async () => {
    const tree = await render();

    press(tree, 'Custom');

    const text = allText(tree);
    expect(text).toContain('From');
    expect(text).toContain('To');
    expect(text).toContain('Your own span');
  });

  test('tapping a day in a range opens that day', async () => {
    const tree = await render();
    press(tree, 'Weekly');

    const threeDaysBack = addDays(todayIso(), -3);
    press(tree, dayRowLabel(threeDaysBack));

    // Back on the daily view, on the day that was tapped.
    const text = allText(tree);
    expect(text).toContain('Daily Nutrition Summary');
    expect(text).toContain(formatLongDate(threeDaysBack));
  });

  test('Add Meal opens the logging screen on the day being shown', async () => {
    const tree = await render();
    press(tree, 'Previous day');
    press(tree, 'Add Meal');

    expect(mockNavigate).toHaveBeenCalledWith('AddMeal', {
      date: addDays(todayIso(), -1),
    });
  });

  test('a meal card opens that meal for editing', async () => {
    const tree = await render();

    press(tree, 'Lunch,');

    expect(mockNavigate).toHaveBeenCalledWith('AddMeal', {
      slot: 'lunch',
      date: todayIso(),
    });
  });

  test('the chevron returns to whatever opened the history', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
