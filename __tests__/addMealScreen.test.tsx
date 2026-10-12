/**
 * The whole screen is a draft: foods go on and come off a list, and nothing
 * reaches the diary until Save. The checks here are that the draft adds up,
 * that saving sends it for the day and meal that were chosen, that the
 * library and its search are the server's, and that the verdict under the
 * figures reads the meal rather than praising it either way. The API is the
 * mock backend's own, served without latency.
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
import { useMealDraftStore } from '../src/stores/mealDraftStore';
import { seedFoodEntries } from '../src/constants/seedData';
import { addDays, todayIso } from '../src/utils/date';
import { ApiError } from '../src/services/api/errors';
import { clearServerReads } from '../src/hooks/useServerRead';
import { mockAuthApi } from '../src/services/api/mockApi';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockParams:
  | { slot?: 'breakfast' | 'lunch' | 'snack' | 'dinner'; date?: string }
  | undefined;

/**
 * The screen empties the draft when it leaves the stack, which React
 * Navigation announces as `beforeRemove`. The listeners are held here so a
 * test can fire that event — a pop, a hardware back or a swipe — without a
 * real navigator.
 */
let mockRemoveListeners: (() => void)[] = [];
const fireBeforeRemove = async () => {
  await ReactTestRenderer.act(async () => {
    for (const listener of mockRemoveListeners) listener();
  });
};

// Only the two hooks are replaced: the theme layer imports `DefaultTheme` from
// this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
    addListener: (event: string, listener: () => void) => {
      if (event === 'beforeRemove') mockRemoveListeners.push(listener);
      return () => {
        mockRemoveListeners = mockRemoveListeners.filter(each => each !== listener);
      };
    },
  }),
  useRoute: () => ({ params: mockParams }),
}));

// Latency is what makes spinners visible in the app and slow in a test suite.
jest.mock('../src/constants/config', () => ({
  config: {
    ...jest.requireActual('../src/constants/config').config,
    mockLatencyMs: 0,
  },
}));

// The mock backend's own library and diary, behind spies.
jest.mock('../src/services/api/endpoints', () => {
  const api = jest.requireActual('../src/services/api/mockApi');
  return {
    nutritionApi: {
      searchFoods: jest.fn((query: string) =>
        api.mockNutritionApi.searchFoods(query),
      ),
      quickAddFoods: jest.fn(() => api.mockNutritionApi.quickAddFoods()),
      day: jest.fn((date: string) => api.mockNutritionApi.day(date)),
      remove: jest.fn((id: string, options: unknown) =>
        api.mockNutritionApi.remove(id, options),
      ),
      createCustomFood: jest.fn((input: unknown) =>
        api.mockNutritionApi.createCustomFood(input),
      ),
      log: jest.fn((entries: unknown, options: unknown) =>
        api.mockNutritionApi.log(entries, options),
      ),
    },
  };
});

const { nutritionApi } = jest.requireMock('../src/services/api/endpoints') as {
  nutritionApi: {
    searchFoods: jest.Mock;
    log: jest.Mock;
    day: jest.Mock;
    remove: jest.Mock;
  };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(async () => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  mockParams = undefined;
  clearServerReads();
  await mockAuthApi.signOut();
  nutritionApi.searchFoods.mockClear();
  nutritionApi.log.mockClear();
  nutritionApi.remove.mockClear();
  useNutritionStore.getState().reset();
  useMealDraftStore.getState().clear();
  mockRemoveListeners = [];
});

/** Lets the server's answers land — and the search's pause pass. */
const settle = (ms = 0) =>
  ReactTestRenderer.act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
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
            <AddMealScreen />
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

/**
 * Saving is asynchronous — it waits for the server before it says what
 * happened — so pressing it has to be awaited, or the test ends while the
 * handler is still running and finishes against an unmounted tree.
 */
const pressAsync = async (
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
    await node.props.onPress();
  });
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

/** What has been handed to the store to send — nothing until Save. */
const sent = () => useNutritionStore.getState().outbox;

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
    expect(sent()).toEqual([]);
    expect(nutritionApi.log).not.toHaveBeenCalled();
  });

  test('a food can be taken off the draft again', async () => {
    const tree = await render();
    press(tree, 'Add Banana');
    expect(allText(tree)).toContain('Added Foods (1)');

    // The seed's breakfast holds a banana of its own, so the two bins on this
    // screen have to be told apart: this one is the draft's.
    press(tree, 'Remove Banana from this meal');

    expect(allText(tree)).toContain('Added Foods (0)');
    expect(nutritionApi.remove).not.toHaveBeenCalled();
  });

  test('search finds a food and adding one clears the term', async () => {
    const tree = await render();

    const field = tree.root
      .findAll(n => n.props?.accessibilityLabel === 'Search food to add')
      .find(n => typeof n.props.onChangeText === 'function');
    ReactTestRenderer.act(() => field?.props.onChangeText('paneer'));
    // The server is asked once typing pauses, and answers.
    await settle(300);
    await settle();

    expect(nutritionApi.searchFoods).toHaveBeenCalledWith('paneer');
    expect(allText(tree)).toContain('Paneer');

    press(tree, 'Add Paneer');
    expect(allText(tree)).toContain('Quick Add'); // the search closed again
  });

  test('saving writes the draft into the chosen meal', async () => {
    mockParams = { slot: 'snack' };
    const tree = await render();

    press(tree, 'Add Banana');
    press(tree, 'Add Boiled Egg');
    await pressAsync(tree, 'Save Meal');
    await settle();

    // One meal, sent together, each food with its own id.
    expect(nutritionApi.log).toHaveBeenCalledTimes(1);
    const [entries] = nutritionApi.log.mock.calls[0] as [
      { id: string; name: string; slot: string }[],
    ];
    expect(entries.map(entry => entry.name)).toEqual(['Banana', 'Boiled Egg']);
    expect(entries.every(entry => entry.slot === 'snack')).toBe(true);
    expect(new Set(entries.map(entry => entry.id)).size).toBe(2);
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

    expect(sent()).toEqual([]);
    expect(nutritionApi.log).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});

describe('the draft across screens (D-69)', () => {
  test('foods picked in the food library survive this screen being rebuilt', async () => {
    const tree = await render();
    press(tree, 'Add Banana');
    expect(allText(tree)).toContain('Added Foods (1)');

    // Pushing the library over this screen can take it off the tree and put
    // it back when the library pops. What was picked must still be there —
    // emptying the draft on the way in is what lost it.
    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
    mounted = null;
    const second = await render();

    expect(allText(second)).toContain('Added Foods (1)');
    expect(allText(second)).toContain('Banana');

    // And it can still be saved, which is what the user was trying to do.
    await pressAsync(second, 'Save Meal');
    await settle();
    expect(nutritionApi.log).toHaveBeenCalledTimes(1);
    const [entries] = nutritionApi.log.mock.calls[0] as [{ name: string }[]];
    expect(entries.map(entry => entry.name)).toEqual(['Banana']);
  });

  test('a food added in the library is on the meal when the screen is built', async () => {
    // What the library screen does: it adds to the same draft.
    useMealDraftStore.getState().add({
      id: 'fl-chapati',
      name: 'Chapati',
      portion: '1 piece (40 g)',
      emoji: '🫓',
      calories: 104,
      proteinG: 3,
      carbsG: 20,
      fatsG: 1.5,
      fiberG: 2,
    });

    mockParams = { slot: 'lunch' };
    const tree = await render();

    expect(allText(tree)).toContain('Added Foods (1)');
    expect(allText(tree)).toContain('Chapati');

    await pressAsync(tree, 'Save Meal');
    await settle();

    const [entries] = nutritionApi.log.mock.calls[0] as [
      { name: string; slot: string }[],
    ];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'Chapati', slot: 'lunch' });
  });

  test('leaving by the chevron throws the meal away', async () => {
    const tree = await render();
    press(tree, 'Add Banana');
    expect(useMealDraftStore.getState().foods).toHaveLength(1);

    press(tree, 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(useMealDraftStore.getState().foods).toEqual([]);
    expect(nutritionApi.log).not.toHaveBeenCalled();
  });

  test('leaving by the hardware back or a swipe throws it away too', async () => {
    const tree = await render();
    press(tree, 'Add Banana');
    expect(useMealDraftStore.getState().foods).toHaveLength(1);

    // No chevron involved: this is the stack telling the screen it is going.
    await fireBeforeRemove();

    expect(useMealDraftStore.getState().foods).toEqual([]);
  });

  test('a saved meal leaves nothing behind for the next one', async () => {
    const tree = await render();
    press(tree, 'Add Banana');
    await pressAsync(tree, 'Save Meal');
    await settle();

    expect(useMealDraftStore.getState().foods).toEqual([]);
  });
});

describe('what Save says', () => {
  test('a meal the server takes is called saved, and the screen leaves', async () => {
    const tree = await render();
    press(tree, 'Add Banana');
    await pressAsync(tree, 'Save Meal');
    await settle();

    expect(nutritionApi.log).toHaveBeenCalledTimes(1);
    expect(allText(tree)).toContain('Meal saved');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(useMealDraftStore.getState().foods).toEqual([]);
  });

  test('a meal the server refuses keeps the draft and says why', async () => {
    nutritionApi.log.mockRejectedValueOnce(
      new ApiError(
        'validation',
        'Only the last 30 days can be logged.',
        422,
        null,
        'VALIDATION_FAILED',
      ),
    );

    const tree = await render();
    press(tree, 'Add Banana');
    await pressAsync(tree, 'Save Meal');
    await settle();

    // Not "Meal saved": the plate never landed, and saying otherwise is how a
    // food appears in the diary for a second and then vanishes.
    const text = allText(tree);
    expect(text).toContain("This meal wasn't saved");
    expect(text).toContain('Only the last 30 days can be logged.');
    expect(text).not.toContain('Meal saved');
    // The draft stays, so the meal can be fixed rather than retyped.
    expect(useMealDraftStore.getState().foods).toHaveLength(1);
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  test('a 404 on the save is not the meal’s fault: it stays queued', async () => {
    // A stale server or a wrong base URL answers 404. Dropping somebody's
    // dinner for that is the one outcome that cannot be undone, so it waits.
    nutritionApi.log.mockRejectedValueOnce(
      new ApiError('not_found', 'That could not be found.', 404),
    );

    const tree = await render();
    press(tree, 'Add Banana');
    await pressAsync(tree, 'Save Meal');

    expect(allText(tree)).toContain('Meal waiting to sync');
    expect(
      useNutritionStore
        .getState()
        .outbox.some(change => change.kind === 'add'),
    ).toBe(true);
  });

  test('a meal that cannot go yet says it will sync, and still leaves', async () => {
    nutritionApi.log.mockRejectedValueOnce(
      new ApiError('network', 'No connection.'),
    );

    const tree = await render();
    press(tree, 'Add Banana');
    await pressAsync(tree, 'Save Meal');
    await settle();

    const text = allText(tree);
    expect(text).toContain('Meal waiting to sync');
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    // It is still queued, so the diary shows it and the next flush sends it.
    expect(
      useNutritionStore
        .getState()
        .outbox.some(
          change =>
            change.kind === 'add' && change.entries[0].name === 'Banana',
        ),
    ).toBe(true);
  });
});

describe('what the meal already holds', () => {
  test('a meal that already has food says so instead of reading zero', async () => {
    // The seed's own lunch, on the day the screen opens.
    const lunch = seedFoodEntries.filter(entry => entry.slot === 'lunch');
    expect(lunch.length).toBeGreaterThan(0);

    mockParams = { slot: 'lunch' };
    const tree = await render();

    const text = allText(tree);
    expect(text).toContain('Already in Lunch');
    for (const entry of lunch) {
      expect(text).toContain(entry.name);
    }
    // The draft is still its own thing, and still empty.
    expect(text).toContain('Added Foods (0)');
  });

  test('the slot picker moves it to whatever meal is chosen', async () => {
    mockParams = { slot: 'lunch' };
    const tree = await render();
    expect(allText(tree)).toContain('Already in Lunch');

    press(tree, 'Dinner');
    await settle();

    const text = allText(tree);
    expect(text).toContain('Already in Dinner');
    expect(text).not.toContain('Already in Lunch');
  });

  test('a meal with nothing in it shows no such card at all', async () => {
    // A day the diary has nothing on: the card is for what is there, so with
    // nothing there it is not a card reading zero — it is absent.
    mockParams = { slot: 'lunch', date: addDays(todayIso(), -3) };
    const tree = await render();

    const text = allText(tree);
    expect(text).not.toContain('Already in Lunch');
    expect(text).toContain('Added Foods (0)');
  });

  test('the bin on a logged row takes it out of the diary', async () => {
    const lunch = seedFoodEntries.filter(entry => entry.slot === 'lunch');
    const first = lunch[0];

    mockParams = { slot: 'lunch' };
    const tree = await render();

    await pressAsync(tree, `Remove ${first.name} from the diary`);
    await settle();

    // Gone at once, and the server is told under its own id.
    expect(allText(tree)).not.toContain(first.name);
    expect(nutritionApi.remove).toHaveBeenCalledWith(
      first.id,
      expect.anything(),
    );
    // The draft was never involved.
    expect(useMealDraftStore.getState().foods).toEqual([]);
    expect(nutritionApi.log).not.toHaveBeenCalled();
  });
});
