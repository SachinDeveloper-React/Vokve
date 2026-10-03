/**
 * The plan is the server's, chosen from the user's preferences and cycled by
 * date, so the checks here are that every day the pager can reach has meals
 * behind it, that the cycle is stable in both directions, that the screen
 * shows what the server planned, and that the four tabs show four genuinely
 * different things. The API is the mock backend's own, served without
 * latency.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { DietPlanScreen } from '../src/screens/main/DietPlanScreen';
import { ThemeProvider } from '../src/theme';
import { useNutritionStore } from '../src/stores/nutritionStore';
import { clearServerReads } from '../src/hooks/useServerRead';
import { mockAuthApi, mockNutritionApi } from '../src/services/api/mockApi';
import { addDays, formatLongDate, todayIso } from '../src/utils/date';

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
      plan: jest.fn((date: string) => api.mockNutritionApi.plan(date)),
      planDays: jest.fn((from: string, to: string) =>
        api.mockNutritionApi.planDays(from, to),
      ),
    },
  };
});

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(async () => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  clearServerReads();
  await mockAuthApi.signOut();
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

const planFor = async (date: string) => (await mockNutritionApi.plan(date)).meals;

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
          <DietPlanScreen />
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
  // A new day or tab can be a new question for the server.
  await settle();
};

describe('the diet plan rotation', () => {
  test('every day the pager can reach has a plan behind it', async () => {
    for (let offset = -10; offset <= 10; offset++) {
      const meals = await planFor(addDays(todayIso(), offset));
      expect(meals.length).toBeGreaterThan(0);
    }
  });

  test('paging forward and back lands on the same plan', async () => {
    const today = todayIso();
    const back = addDays(addDays(today, 3), -3);

    expect(await planFor(back)).toEqual(await planFor(today));
  });
});

describe('DietPlanScreen', () => {
  test('the day states its meals and what they come to', async () => {
    const text = allText(await render());
    const calories = (await planFor(todayIso())).reduce(
      (sum, meal) => sum + meal.calories,
      0,
    );

    expect(text).toContain('Breakfast');
    expect(text).toContain('Dinner');
    expect(text).toContain(String(calories).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  });

  test('the calorie line says how much room the plan has left', async () => {
    // 2,200 is the nutrition goal, and the plan is measured against the same
    // target the day's food is logged against.
    expect(allText(await render())).toContain('kcal remaining');
  });

  test('paging moves the plan to another day of the cycle', async () => {
    const tree = await render();
    const before = allText(tree);

    await press(tree, 'Next day');

    expect(allText(tree)).not.toBe(before);
  });

  test('each tab shows something the others do not', async () => {
    const tree = await render();

    await press(tree, 'Plan');
    expect(allText(tree)).toContain('The week ahead');

    await press(tree, 'Nutrition');
    expect(allText(tree)).toContain('Planned nutrition');

    await press(tree, 'History');
    expect(allText(tree)).toContain('The week behind');

    await press(tree, 'Today');
    expect(allText(tree)).toContain('Add Meal');
  });

  test('picking a day from the week returns to that day of the plan', async () => {
    const tree = await render();
    await press(tree, 'Plan');

    // The rows are the control on this tab: tapping one is how a user gets
    // from "Thursday looks heavy" to the meals that made it heavy.
    const tomorrow = addDays(todayIso(), 1);
    await press(tree, formatLongDate(tomorrow));

    const text = allText(tree);
    expect(text).toContain('Add Meal'); // back on the day itself
    expect(text).toContain(formatLongDate(tomorrow));
  });

  test('Add Meal opens the logging screen on the day being shown', async () => {
    const tree = await render();

    await press(tree, 'Next day');
    await press(tree, 'Add Meal');

    // A screen, not a sheet: logging a meal is several foods with portions and
    // macros, and it opens on the day the plan was showing.
    expect(mockNavigate).toHaveBeenCalledWith('AddMeal', {
      date: addDays(todayIso(), 1),
    });
  });

  test('the chevron returns to whatever opened the plan', async () => {
    await press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
