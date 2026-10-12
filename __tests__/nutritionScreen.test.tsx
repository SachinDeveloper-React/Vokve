/**
 * Every figure on the nutrition screen is counted from one list of food — the
 * server's day with any meal still on its way laid over it — so the checks
 * here are that the sums hold: the summary, the macro bars and the four meal
 * rows all have to move together when an item is logged, before the server
 * has answered, and the verdict at the foot has to turn when the goal is
 * passed. The API is the mock backend's own, served without latency.
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
import { clearServerReads } from '../src/hooks/useServerRead';
import { mockAuthApi, mockNutritionApi } from '../src/services/api/mockApi';
import {
  addDays,
  formatLongDate,
  fromIsoDate,
  todayIso,
} from '../src/utils/date';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

// The mock backend's own diary, profile and tips, behind spies.
jest.mock('../src/services/api/endpoints', () => {
  const api = jest.requireActual('../src/services/api/mockApi');
  return {
    nutritionApi: {
      profile: jest.fn(() => api.mockNutritionApi.profile()),
      updateProfile: jest.fn((patch: unknown, options: unknown) =>
        api.mockNutritionApi.updateProfile(patch, options),
      ),
      day: jest.fn((date: string) => api.mockNutritionApi.day(date)),
      days: jest.fn((from: string, to: string) =>
        api.mockNutritionApi.days(from, to),
      ),
      log: jest.fn((entries: unknown, options: unknown) =>
        api.mockNutritionApi.log(entries, options),
      ),
      remove: jest.fn((id: string, options: unknown) =>
        api.mockNutritionApi.remove(id, options),
      ),
    },
    activityApi: {
      day: jest.fn(async (date: string) => ({
        date,
        steps: 0,
        verifiedSteps: 0,
        distanceKm: 0,
        activeMinutes: 0,
        caloriesBurned: 320,
        workoutsCompleted: 0,
        source: null,
        verified: false,
      })),
    },
    contentApi: { tip: jest.fn((topic: string) => api.mockContentApi.tip(topic)) },
  };
});

const { nutritionApi } = jest.requireMock('../src/services/api/endpoints') as {
  nutritionApi: { log: jest.Mock; updateProfile: jest.Mock; days: jest.Mock };
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(async () => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  clearServerReads();
  // Signing out is the mock backend's own reset: today's plate is back.
  await mockAuthApi.signOut();
  nutritionApi.log.mockClear();
  nutritionApi.updateProfile.mockClear();
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
          <NutritionScreen />
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

/** Presses and then lets whatever the press asked the server for land. */
const pressAndSettle = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  prefix: string,
) => {
  press(tree, prefix);
  await settle();
};

describe('NutritionScreen', () => {
  test('before the targets arrive it says so, and invents no goal', async () => {
    useNutritionStore.getState().reset();
    const text = allText(await render());

    expect(text).not.toContain('of 300 grams');
  });

  test("the day's tip and calories burned are the server's", async () => {
    const text = allText(await render());

    expect(text).toContain('Add more protein to your dinner');
    expect(text).toContain('320');
  });

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

    ReactTestRenderer.act(() => {
      useNutritionStore.getState().addEntries([
        {
          slot: 'dinner',
          name: 'Grilled paneer',
          calories: 200,
          proteinG: 14,
          carbsG: 6,
          fatsG: 12,
        },
      ]);
    });

    // At once, before the server has answered.
    const text = allText(tree);
    expect(text).toContain('1,850'); // 1,650 + 200
    expect(text).toContain('550 kcal'); // dinner, 350 + 200
    expect(labels(tree)).toEqual(
      expect.arrayContaining(['Protein, 99 of 120 grams']),
    );

    await settle();
    expect(nutritionApi.log).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'Grilled paneer', slot: 'dinner' })],
      { idempotencyKey: expect.stringMatching(/^meal:/) },
    );
    expect(allText(tree)).toContain('1,850');
  });

  test('the verdict turns once the goal is passed', async () => {
    const tree = await render();
    expect(allText(tree)).toContain("within your daily calorie goal");

    ReactTestRenderer.act(() => {
      useNutritionStore.getState().addEntries([
        {
          slot: 'dinner',
          name: 'Late night biryani',
          calories: 900,
          proteinG: 20,
          carbsG: 90,
          fatsG: 30,
        },
      ]);
    });

    expect(allText(tree)).toContain('350 kcal over');
  });

  test('the plus opens the add-meal screen for the meal it belongs to', async () => {
    const tree = await render();

    press(tree, 'Add food to Evening Snack');

    // A screen rather than a sheet: a meal is several foods, each with a
    // portion and four macros.
    expect(mockNavigate).toHaveBeenCalledWith('AddMeal', { slot: 'snack' });
    expect(useNutritionStore.getState().outbox).toEqual([]);
  });

  test('a preference can be changed from its own tile', async () => {
    const tree = await render();
    expect(allText(tree)).toContain('Vegetarian');

    press(tree, 'Diet Type, Vegetarian');
    press(tree, 'Vegan');

    expect(useNutritionStore.getState().profile?.preferences.dietType).toBe(
      'vegan',
    );
    expect(allText(tree)).toContain('Vegan');
    expect(nutritionApi.updateProfile).toHaveBeenCalledWith(
      { preferences: { dietType: 'vegan' } },
      { idempotencyKey: expect.any(String) },
    );
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

describe('the period chips', () => {
  test('Week averages the days rather than adding them up', async () => {
    const tree = await render();
    expect(allText(tree)).toContain('Calorie Summary'); // the day's own ring

    await pressAndSettle(tree, 'Week');

    const text = allText(tree);
    expect(text).toContain('The last 7 days');
    expect(text).toContain('Day by day');
    // Averaged, not totalled: the daily goal is what the figures are read
    // against, so a week's sum would be measured against nothing. The total
    // is still there, a step down, for anyone who wants it.
    expect(text).toContain('kcal a day');
    expect(text).toContain('kcal in total');
    expect(text).toContain('days within goal');
    expect(text).not.toContain('Calorie Summary');
    // Seven days, ending on the day the chip sits beside.
    expect(nutritionApi.days).toHaveBeenCalled();
    const [from, to] = nutritionApi.days.mock.calls[
      nutritionApi.days.mock.calls.length - 1
    ];
    expect(to).toBe(todayIso());
    expect(from).toBe(addDays(todayIso(), -6));
  });

  test('Month asks for thirty days, and Day goes back to the one day', async () => {
    const tree = await render();

    await pressAndSettle(tree, 'Month');
    const [from, to] = nutritionApi.days.mock.calls[
      nutritionApi.days.mock.calls.length - 1
    ];
    expect(from).toBe(addDays(todayIso(), -29));
    expect(to).toBe(todayIso());
    expect(allText(tree)).toContain('The last 30 days');

    await pressAndSettle(tree, 'Day');
    const text = allText(tree);
    expect(text).toContain('Calorie Summary');
    expect(text).toContain("Today's Meals");
    expect(text).not.toContain('The last 30 days');
  });

  test('a day in the list brings the day view back to it', async () => {
    const tree = await render();
    await pressAndSettle(tree, 'Week');

    // The rows are labelled "Sat, 10 October 2026" — weekday first.
    const yesterday = addDays(todayIso(), -1);
    const weekday = WEEKDAYS[fromIsoDate(yesterday).getDay()];
    await pressAndSettle(tree, `${weekday}, ${formatLongDate(yesterday)}`);

    const text = allText(tree);
    expect(text).toContain('Calorie Summary'); // back on a single day
    expect(text).toContain(formatLongDate(yesterday));
  });
});

describe('the daily goal', () => {
  test('Edit saves a new target to the server and shows it at once', async () => {
    const tree = await render();
    expect(allText(tree)).toContain('2,200');

    press(tree, 'Edit');

    const sheet = tree.root
      .findAll(n => typeof n.props?.onSubmit === 'function')
      .find(n => n.props?.goals !== undefined);
    if (!sheet) throw new Error('No goal editor');
    expect(sheet.props.goals).toMatchObject({ calories: 2200 });

    await ReactTestRenderer.act(async () => {
      sheet.props.onSubmit({
        calories: 1900,
        proteinG: 130,
        carbsG: 210,
        fatsG: 60,
      });
    });
    await settle();

    expect(nutritionApi.updateProfile).toHaveBeenCalledWith(
      { goals: { calories: 1900, proteinG: 130, carbsG: 210, fatsG: 60 } },
      expect.anything(),
    );
    expect(useNutritionStore.getState().profile?.goals).toMatchObject({
      calories: 1900,
      proteinG: 130,
    });
    expect(allText(tree)).toContain('1,900');
  });
});

describe('a meal that did not save', () => {
  test('says so, with the reason, instead of losing it quietly', async () => {
    const tree = await render();
    expect(allText(tree)).not.toContain("A meal didn't save");

    // What the store does when the server refuses a change outright: it drops
    // it from the outbox, so the only trace left is this.
    await ReactTestRenderer.act(async () => {
      useNutritionStore.setState({ syncError: 'Only the last 30 days can be logged.' });
    });

    const text = allText(tree);
    expect(text).toContain("A meal didn't save");
    expect(text).toContain('Only the last 30 days can be logged.');
    expect(text).toContain('Try again');
  });

  test('Try again asks the server once more and clears the notice', async () => {
    const tree = await render();
    await ReactTestRenderer.act(async () => {
      useNutritionStore.setState({ syncError: 'Network unavailable.' });
    });

    press(tree, 'Try again');
    await settle();

    expect(useNutritionStore.getState().syncError).toBeNull();
    expect(allText(tree)).not.toContain("A meal didn't save");
  });
});
