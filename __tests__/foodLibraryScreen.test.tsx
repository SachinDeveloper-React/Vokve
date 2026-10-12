/**
 * What the screen draws and does: the library is the server's, a term starts a
 * fresh list, a picked food lands on the meal rather than in the diary, a
 * second tap adds a second helping, and a food added by hand is sent to the
 * member's own library behind the meal. The paging itself is the hook's
 * contract and is checked in `useFoodLibrary.test.tsx`, where no list
 * virtualisation stands between the test and the pages. The API is the mock
 * backend's own, served without latency.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { FoodLibraryScreen } from '../src/screens/main/FoodLibraryScreen';
import { ToastProvider } from '../src/components/feedback/Toast';
import { ThemeProvider } from '../src/theme';
import { useMealDraftStore } from '../src/stores/mealDraftStore';
import { mockAuthApi, mockNutritionApi } from '../src/services/api/mockApi';
import { nutritionApi } from '../src/services/api/endpoints';

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

jest.mock('../src/services/api/endpoints', () => {
  const api = jest.requireActual('../src/services/api/mockApi');
  return {
    nutritionApi: {
      // Four to a page, so the seeded library needs several of them and the
      // paging is what is under test rather than the page size.
      foodLibrary: jest.fn((query: Record<string, unknown>) =>
        api.mockNutritionApi.foodLibrary({ ...query, limit: PAGE }),
      ),
      createCustomFood: jest.fn((input: unknown) =>
        api.mockNutritionApi.createCustomFood(input),
      ),
    },
  };
});

/** Foods to a page in this suite — read by the module mock above when it is called. */
const PAGE = 4;

const foodLibrary = nutritionApi.foodLibrary as jest.Mock;
const createCustomFood = nutritionApi.createCustomFood as jest.Mock;

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(async () => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  foodLibrary.mockClear();
  createCustomFood.mockClear();
  await mockAuthApi.signOut();
  useMealDraftStore.getState().clear();
});

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
          <ToastProvider>
            <FoodLibraryScreen />
          </ToastProvider>
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

const pressLabelled = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = tree.root
    .findAll(n => n.props?.accessibilityLabel === label)
    .find(n => typeof n.props.onPress === 'function');
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
};

const pressPrefixed = async (
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
  await settle();
};

const typeSearch = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  text: string,
) => {
  const field = tree.root
    .findAll(n => n.props?.accessibilityLabel === 'Search foods')
    .find(n => typeof n.props.onChangeText === 'function');
  if (!field) throw new Error('No search field');
  await ReactTestRenderer.act(async () => {
    field.props.onChangeText(text);
  });
  await settle();
};

describe('FoodLibraryScreen', () => {
  test('draws the library and says how big it is', async () => {
    const whole = await mockNutritionApi.foodLibrary({ limit: 200 });
    const tree = await render();
    const text = allText(tree);

    // The count is the library's, not the page's — "15 foods" over four rows.
    expect(whole.total).toBeGreaterThan(PAGE);
    expect(text).toContain(`${whole.total} foods to choose from`);
    expect(text).toContain(whole.data[0].name);
    expect(text).toContain(whole.data[0].portion);
    // A row states the figures the portion describes, not just a name.
    expect(text).toContain(`${Math.round(whole.data[0].calories)} kcal`);
    expect(foodLibrary.mock.calls[0][0]).toMatchObject({ cursor: undefined });
  });

  test('a search term starts a fresh list', async () => {
    const tree = await render();
    await typeSearch(tree, 'oat');

    const text = allText(tree);
    expect(text).toContain('Oats (Cooked)');
    expect(text).not.toContain('Banana');
    expect(foodLibrary.mock.calls[foodLibrary.mock.calls.length - 1][0]).toMatchObject({
      q: 'oat',
      cursor: undefined,
    });
  });

  test('a picked food lands on the meal, and tapping again adds another', async () => {
    const whole = await mockNutritionApi.foodLibrary({ limit: 200 });
    const first = whole.data[0];
    const tree = await render();

    await pressPrefixed(tree, `Add ${first.name},`);
    expect(useMealDraftStore.getState().foods).toHaveLength(1);
    expect(useMealDraftStore.getState().foods[0]).toMatchObject({
      name: first.name,
      calories: first.calories,
    });
    expect(allText(tree)).toContain('1 food on this meal');

    await pressPrefixed(tree, `Add ${first.name},`);
    expect(useMealDraftStore.getState().foods).toHaveLength(2);
    const text = allText(tree);
    expect(text).toContain('2 foods on this meal');
    expect(text).toContain('×2'); // the row says how many are on the meal
  });

  test('nothing picked here reaches the diary', async () => {
    const whole = await mockNutritionApi.foodLibrary({ limit: 200 });
    const tree = await render();
    await pressPrefixed(tree, `Add ${whole.data[0].name},`);

    // The draft is the only thing that moved: the day is still as it was.
    const day = await mockNutritionApi.day(new Date().toISOString().slice(0, 10));
    expect(day.entries.some(entry => entry.name === whole.data[0].name)).toBe(
      false,
    );
    expect(allText(tree)).toContain('Nothing is saved until you save the meal.');
  });

  test('Done returns to the meal being assembled', async () => {
    const whole = await mockNutritionApi.foodLibrary({ limit: 200 });
    const tree = await render();

    // With nothing picked there is nothing to go back to report.
    expect(allText(tree)).not.toContain('Done');

    await pressPrefixed(tree, `Add ${whole.data[0].name},`);
    await pressLabelled(tree, 'Done');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    // The picks stay on the draft: the Add Meal screen behind is what saves.
    expect(useMealDraftStore.getState().foods).toHaveLength(1);
  });

  test('a food added by hand goes on the meal and into the member’s own foods', async () => {
    const tree = await render();
    await typeSearch(tree, 'Khichdi');
    await pressLabelled(tree, 'Add a food');

    const sheet = tree.root
      .findAll(n => typeof n.props?.onSubmit === 'function')
      .find(n => n.props.initialName === 'Khichdi');
    if (!sheet) throw new Error('No custom food sheet');
    await ReactTestRenderer.act(async () => {
      sheet.props.onSubmit({
        name: 'Khichdi',
        portion: '1 bowl',
        calories: 210,
        proteinG: 8,
        carbsG: 34,
        fatsG: 4,
        fiberG: 3,
      });
    });
    await settle();

    expect(useMealDraftStore.getState().foods[0]).toMatchObject({
      name: 'Khichdi',
      calories: 210,
    });
    // Sent to the library behind the meal, so the next search can find it.
    expect(createCustomFood).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Khichdi', calories: 210 }),
    );
    expect(
      (await mockNutritionApi.searchFoods('khichdi')).map(f => f.name),
    ).toContain('Khichdi');
  });

  test('the chevron returns without picking anything', async () => {
    await pressLabelled(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(useMealDraftStore.getState().foods).toHaveLength(0);
  });
});
