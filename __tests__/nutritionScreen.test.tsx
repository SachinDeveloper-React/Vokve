/**
 * Every figure on the nutrition screen is counted from one list of food, so
 * the checks here are that the sums hold: the summary, the macro bars and the
 * four meal rows all have to move together when an item is logged, and the
 * verdict at the foot has to turn when the goal is passed.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { NutritionScreen } from '../src/screens/main/NutritionScreen';
import { ThemeProvider } from '../src/theme';
import { useNutritionStore } from '../src/stores/nutritionStore';
import { seedFoodEntries } from '../src/constants/seedData';
import { todayIso } from '../src/utils/date';

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
          <NutritionScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

const labels = (tree: ReactTestRenderer.ReactTestRenderer) => {
  const seen = new Set<string>();
  return tree.root
    .findAll(n => typeof n.props?.accessibilityLabel === 'string')
    .map(n => n.props.accessibilityLabel as string)
    .filter(label => !seen.has(label) && seen.add(label));
};

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

/** The food the store holds for today, whatever day the tests run on. */
const todaysEntries = () =>
  useNutritionStore.getState().entriesByDate[todayIso()] ?? [];

describe('NutritionScreen', () => {
  test("the day's calories are the sum of what is on the plate", async () => {
    const plate = seedFoodEntries.reduce(
      (sum, entry) => sum + entry.calories,
      0,
    );
    expect(plate).toBe(1650);

    expect(allText(await render())).toContain('1,650');
  });

  test('each macro bar states the grams behind it', async () => {
    expect(labels(await render())).toEqual(
      expect.arrayContaining([
        'Carbs, 205 of 300 grams',
        'Protein, 85 of 120 grams',
        'Fats, 45 of 70 grams',
      ]),
    );
  });

  test('a meal row counts its own items and calories', async () => {
    const text = allText(await render());

    expect(text).toContain('Breakfast');
    expect(text).toContain('4 items'); // lunch
    expect(text).toContain('650 kcal');
  });

  test('logging food moves the meal, the total and the macros together', async () => {
    const tree = await render();

    ReactTestRenderer.act(() =>
      useNutritionStore.getState().addEntry({
        slot: 'dinner',
        name: 'Grilled paneer',
        calories: 200,
        proteinG: 14,
        carbsG: 6,
        fatsG: 12,
      }),
    );

    const text = allText(tree);
    expect(text).toContain('1,850'); // 1,650 + 200
    expect(text).toContain('550 kcal'); // dinner, 350 + 200
    expect(labels(tree)).toEqual(
      expect.arrayContaining(['Protein, 99 of 120 grams']),
    );
  });

  test('the verdict turns once the goal is passed', async () => {
    const tree = await render();
    expect(allText(tree)).toContain("within your daily calorie goal");

    ReactTestRenderer.act(() =>
      useNutritionStore.getState().addEntry({
        slot: 'dinner',
        name: 'Late night biryani',
        calories: 900,
        proteinG: 20,
        carbsG: 90,
        fatsG: 30,
      }),
    );

    expect(allText(tree)).toContain('350 kcal over');
  });

  test('the plus opens the add-meal screen for the meal it belongs to', async () => {
    const tree = await render();
    const before = todaysEntries().length;

    press(tree, 'Add food to Evening Snack');

    // A screen rather than a sheet: a meal is several foods, each with a
    // portion and four macros.
    expect(mockNavigate).toHaveBeenCalledWith('AddMeal', { slot: 'snack' });
    expect(todaysEntries()).toHaveLength(before);
  });

  test('a preference can be changed from its own tile', async () => {
    const tree = await render();
    expect(allText(tree)).toContain('Vegetarian');

    press(tree, 'Diet Type, Vegetarian');
    press(tree, 'Vegan');

    expect(useNutritionStore.getState().preferences.dietType).toBe('vegan');
    expect(allText(tree)).toContain('Vegan');
  });

  test('Manage opens the diet plan behind the preferences', async () => {
    press(await render(), 'Manage meal plan and preferences');

    expect(mockNavigate).toHaveBeenCalledWith('DietPlan');
  });

  test('View All opens the nutrition history', async () => {
    press(await render(), 'View all meals');

    expect(mockNavigate).toHaveBeenCalledWith('NutritionHistory');
  });

  test('the chevron returns to whatever opened the screen', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
