/**
 * The plan is a three-day rotation rather than a row per date, so the checks
 * here are that every day the pager can reach has meals behind it, that the
 * cycle is stable in both directions, and that the four tabs show four
 * genuinely different things.
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
import {
  dietPlanForDate,
  totalsOf,
  useDietPlanStore,
} from '../src/stores/dietPlanStore';
import { useNutritionStore } from '../src/stores/nutritionStore';
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

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  useDietPlanStore.getState().reset();
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
          <DietPlanScreen />
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

describe('the diet plan rotation', () => {
  test('every day the pager can reach has a plan behind it', () => {
    for (let offset = -10; offset <= 10; offset++) {
      const meals = dietPlanForDate(addDays(todayIso(), offset));
      expect(meals.length).toBeGreaterThan(0);
    }
  });

  test('paging forward and back lands on the same plan', () => {
    const today = todayIso();
    const there = addDays(today, 3);
    const back = addDays(there, -3);

    expect(dietPlanForDate(back)).toEqual(dietPlanForDate(today));
  });

  test('the cycle repeats every three days', () => {
    const today = todayIso();

    expect(dietPlanForDate(addDays(today, 3))).toEqual(dietPlanForDate(today));
    expect(dietPlanForDate(addDays(today, 1))).not.toEqual(
      dietPlanForDate(today),
    );
  });
});

describe('DietPlanScreen', () => {
  test('the day states its meals and what they come to', async () => {
    const text = allText(await render());
    const { calories } = totalsOf(dietPlanForDate(todayIso()));

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

    press(tree, 'Next day');

    expect(allText(tree)).not.toBe(before);
  });

  test('a meal added to a day joins that day and no other', async () => {
    const tree = await render();

    ReactTestRenderer.act(() =>
      useDietPlanStore.getState().addMeal(todayIso(), {
        slot: 'snack',
        calories: 120,
        items: [{ name: 'Greek yoghurt', quantity: '1 cup' }],
      }),
    );

    expect(allText(tree)).toContain('Greek yoghurt');

    press(tree, 'Next day');
    expect(allText(tree)).not.toContain('Greek yoghurt');
  });

  test('each tab shows something the others do not', async () => {
    const tree = await render();

    press(tree, 'Plan');
    expect(allText(tree)).toContain('The week ahead');

    press(tree, 'Nutrition');
    expect(allText(tree)).toContain('Planned nutrition');

    press(tree, 'History');
    expect(allText(tree)).toContain('The week behind');

    press(tree, 'Today');
    expect(allText(tree)).toContain('Add Meal');
  });

  test('picking a day from the week returns to that day of the plan', async () => {
    const tree = await render();
    press(tree, 'Plan');

    // The rows are the control on this tab: tapping one is how a user gets
    // from "Thursday looks heavy" to the meals that made it heavy.
    const tomorrow = addDays(todayIso(), 1);
    press(tree, formatLongDate(tomorrow));

    const text = allText(tree);
    expect(text).toContain('Add Meal'); // back on the day itself
    expect(text).toContain(formatLongDate(tomorrow));
  });

  test('Add Meal opens the logging screen on the day being shown', async () => {
    const tree = await render();

    press(tree, 'Next day');
    press(tree, 'Add Meal');

    // A screen, not a sheet: logging a meal is several foods with portions and
    // macros, and it opens on the day the plan was showing.
    expect(mockNavigate).toHaveBeenCalledWith('AddMeal', {
      date: addDays(todayIso(), 1),
    });
  });

  test('the chevron returns to whatever opened the plan', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
