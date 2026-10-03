/**
 * The history reads the server's diary — the same days the add-meal screen
 * writes into — so the checks here are that a day nobody logged is told apart
 * from a day of nothing, that the ranges are the same days counted
 * differently, and that every list can be walked into. The API is the mock
 * backend's own, served without latency, with a week of meals in it.
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
import { seedFoodEntries } from '../src/constants/seedData';
import { clearServerReads } from '../src/hooks/useServerRead';
import { mockAuthApi, mockNutritionApi } from '../src/services/api/mockApi';
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

// Latency is what makes spinners visible in the app and slow in a test suite.
jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    mockLatencyMs: 0,
  },
}));

jest.mock('../src/services/api/endpoints', () => {
  const api = jest.requireActual('../src/services/api/mockApi');
  return {
    nutritionApi: {
      profile: jest.fn(() => api.mockNutritionApi.profile()),
      day: jest.fn((date: string) => api.mockNutritionApi.day(date)),
      days: jest.fn((from: string, to: string) =>
        api.mockNutritionApi.days(from, to),
      ),
    },
  };
});

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

/** A lunch on the day `back` days before today, at 13:00 local. */
const lunchOn = (back: number) => {
  const at = fromIsoDate(addDays(todayIso(), -back));
  at.setHours(13, 0, 0, 0);
  return {
    id: `past-${back}`,
    slot: 'lunch' as const,
    name: 'Dal and rice',
    portion: '',
    calories: 1500,
    proteinG: 60,
    carbsG: 200,
    fatsG: 40,
    fiberG: 5,
    loggedAt: at.toISOString(),
  };
};

beforeEach(async () => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  clearServerReads();
  // The mock backend's own reset: today's plate, and nothing before it…
  await mockAuthApi.signOut();
  // …so the six days before today get a lunch each.
  for (let back = 1; back <= 6; back++) {
    await mockNutritionApi.log([lunchOn(back)], { idempotencyKey: `l${back}` });
  }
  useNutritionStore.getState().reset();
  useNutritionStore.setState({
    profile: await mockNutritionApi.profile(),
    syncedAt: new Date().toISOString(),
  });
});

/** Lets the server's answers land. */
const settle = () =>
  ReactTestRenderer.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
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
  await settle();
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
  ReactTestRenderer.act(() => node.props.onPress());
  // A new day or range is a new question for the server.
  await settle();
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

    // Yesterday had a lunch, so it has a real figure rather than a blank.
    const yesterday = formatLongDate(addDays(todayIso(), -1));
    expect(allText(tree)).toContain('Previous Days');
    expect(allText(tree)).toContain(yesterday);
  });

  test('a day nobody logged says so instead of reading zero', async () => {
    // Take today's plate away: the day is now unlogged, which is not the
    // same as a day of no calories.
    for (const entry of seedFoodEntries) {
      await mockNutritionApi.remove(entry.id, { idempotencyKey: entry.id });
    }

    expect(allText(await render())).toContain('Nothing logged');
  });

  test('the pager walks back a day at a time', async () => {
    const tree = await render();
    expect(allText(tree)).toContain(formatLongDate(todayIso()));

    await press(tree, 'Previous day');

    expect(allText(tree)).toContain(formatLongDate(addDays(todayIso(), -1)));
  });

  test('a range averages the days that were logged, not the days in it', async () => {
    const tree = await render();

    await press(tree, 'Weekly');

    const text = allText(tree);
    expect(text).toContain('This week');
    expect(text).toContain('kcal a day');
    // Seven logged days out of seven in the window.
    expect(text).toContain('7/7');
  });

  test('the custom range swaps the pager for its own two ends', async () => {
    const tree = await render();

    await press(tree, 'Custom');

    const text = allText(tree);
    expect(text).toContain('From');
    expect(text).toContain('To');
    expect(text).toContain('Your own span');
  });

  test('tapping a day in a range opens that day', async () => {
    const tree = await render();
    await press(tree, 'Weekly');

    const threeDaysBack = addDays(todayIso(), -3);
    await press(tree, dayRowLabel(threeDaysBack));

    // Back on the daily view, on the day that was tapped.
    const text = allText(tree);
    expect(text).toContain('Daily Nutrition Summary');
    expect(text).toContain(formatLongDate(threeDaysBack));
  });

  test('Add Meal opens the logging screen on the day being shown', async () => {
    const tree = await render();
    await press(tree, 'Previous day');
    await press(tree, 'Add Meal');

    expect(mockNavigate).toHaveBeenCalledWith('AddMeal', {
      date: addDays(todayIso(), -1),
    });
  });

  test('a meal card opens that meal for editing', async () => {
    const tree = await render();

    await press(tree, 'Lunch,');

    expect(mockNavigate).toHaveBeenCalledWith('AddMeal', {
      slot: 'lunch',
      date: todayIso(),
    });
  });

  test('the chevron returns to whatever opened the history', async () => {
    await press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
