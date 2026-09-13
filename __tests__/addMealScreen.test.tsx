/**
 * The whole screen is a draft: foods go on and come off a list, and nothing
 * reaches the diary until Save. The checks here are that the draft adds up,
 * that saving writes it against the day and meal that were chosen, and that
 * the verdict under the figures reads the meal rather than praising it either
 * way.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { AddMealScreen } from '../src/screens/main/AddMealScreen';
import { verdictFor } from '../src/components/meal/MealSummaryCard';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { useNutritionStore } from '../src/stores/nutritionStore';
import { seedFoodEntries } from '../src/constants/seedData';
import { todayIso } from '../src/utils/date';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockParams: { slot?: 'breakfast' | 'lunch' | 'snack' | 'dinner' } | undefined;

// Only the two hooks are replaced: the theme layer imports `DefaultTheme` from
// this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: mockParams }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockParams = undefined;
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
          <ToastProvider>
            <AddMealScreen />
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

const todaysEntries = () =>
  useNutritionStore.getState().entriesByDate[todayIso()] ?? [];

/** What the day started with, so a test can assert nothing was written. */
const SEEDED = seedFoodEntries.length;

describe('the meal verdict', () => {
  test('a meal short on protein is told so, not congratulated', () => {
    const verdict = verdictFor({
      calories: 400,
      proteinG: 4,
      carbsG: 80,
      fatsG: 8,
      fiberG: 3,
    });

    expect(verdict.tone).toBe('warning');
    expect(verdict.message).toContain('protein');
  });

  test('a balanced meal is', () => {
    // 239 kcal with 6g protein is the design's own example — light on protein,
    // which is exactly the case the copy in the mock would have praised.
    expect(
      verdictFor({
        calories: 400,
        proteinG: 25,
        carbsG: 40,
        fatsG: 12,
        fiberG: 6,
      }).tone,
    ).toBe('success');
  });
});

describe('AddMealScreen', () => {
  test('opens on the meal it was asked for', async () => {
    mockParams = { slot: 'dinner' };

    const tree = await render();
    const dinner = tree.root
      .findAll(n => n.props?.accessibilityLabel === 'Dinner')
      .find(n => n.props?.accessibilityState?.selected !== undefined);

    expect(dinner?.props.accessibilityState.selected).toBe(true);
  });

  test('a quick add lands on the draft and moves the summary', async () => {
    const tree = await render();
    expect(allText(tree)).toContain('Added Foods (0)');

    press(tree, 'Add Oats (Cooked)');

    const text = allText(tree);
    expect(text).toContain('Added Foods (1)');
    expect(text).toContain('150 kcal');
    // Nothing has been written yet — the draft is the screen's, not the diary's.
    expect(todaysEntries()).toHaveLength(SEEDED);
  });

  test('a food can be taken off the draft again', async () => {
    const tree = await render();
    press(tree, 'Add Banana');
    expect(allText(tree)).toContain('Added Foods (1)');

    press(tree, 'Remove Banana');

    expect(allText(tree)).toContain('Added Foods (0)');
  });

  test('search finds a food and adding one clears the term', async () => {
    const tree = await render();

    const field = tree.root
      .findAll(n => n.props?.accessibilityLabel === 'Search food to add')
      .find(n => typeof n.props.onChangeText === 'function');
    ReactTestRenderer.act(() => field?.props.onChangeText('paneer'));

    expect(allText(tree)).toContain('Paneer');

    press(tree, 'Add Paneer');
    expect(allText(tree)).toContain('Quick Add'); // the search closed again
  });

  test('saving writes the draft into the chosen meal', async () => {
    mockParams = { slot: 'snack' };
    const tree = await render();

    press(tree, 'Add Banana');
    press(tree, 'Add Boiled Egg');
    press(tree, 'Save Meal');

    // The day already had a snack in it, so what matters is what was added.
    const added = todaysEntries().slice(SEEDED);
    expect(added.map(entry => entry.name)).toEqual(['Banana', 'Boiled Egg']);
    expect(added.every(entry => entry.slot === 'snack')).toBe(true);
    // And it leaves, because the diary is where the result is read.
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('an empty meal cannot be saved', async () => {
    const tree = await render();
    const save = tree.root
      .findAll(n => n.props?.accessibilityLabel === 'Save Meal')
      .find(n => n.props?.accessibilityState?.disabled !== undefined);

    expect(save?.props.accessibilityState.disabled).toBe(true);
  });

  test('the chevron returns without saving anything', async () => {
    const tree = await render();
    press(tree, 'Add Banana');

    press(tree, 'Back');

    expect(todaysEntries()).toHaveLength(SEEDED);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
