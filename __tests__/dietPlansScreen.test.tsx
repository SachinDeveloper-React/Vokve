/**
 * The plan library (RULES N10): the plans are the server's, every one is
 * listed with the suiting ones first, a card opens to show the days it
 * actually prescribes, and choosing one writes it to the nutrition profile —
 * so the checks here are that the list is the server's, that opening a card
 * asks for that plan's days, that choosing saves the choice and leaves, and
 * that handing the choice back is offered only once there is one to hand
 * back. The API is the mock backend's own, served without latency.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { ToastProvider } from '../src/components/feedback/Toast';
import { DietPlansScreen } from '../src/screens/main/DietPlansScreen';
import { ThemeProvider } from '../src/theme';
import { useNutritionStore } from '../src/stores/nutritionStore';
import { clearServerReads } from '../src/hooks/useServerRead';
import { mockAuthApi, mockNutritionApi } from '../src/services/api/mockApi';
import { nutritionApi } from '../src/services/api/endpoints';

const updateProfile = nutritionApi.updateProfile as jest.Mock;

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
      profile: jest.fn(() => api.mockNutritionApi.profile()),
      updateProfile: jest.fn((patch: unknown, options: unknown) =>
        api.mockNutritionApi.updateProfile(patch, options),
      ),
      dietPlans: jest.fn(() => api.mockNutritionApi.dietPlans()),
      dietPlan: jest.fn((id: string) => api.mockNutritionApi.dietPlan(id)),
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
  updateProfile.mockClear();
  clearServerReads();
  await mockAuthApi.signOut();
  useNutritionStore.getState().reset();
  useNutritionStore.setState({
    profile: await mockNutritionApi.profile(),
    syncedAt: new Date().toISOString(),
  });
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
            <DietPlansScreen />
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
  await ReactTestRenderer.act(async () => {
    node.props.onPress();
  });
  await settle();
};

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

describe('DietPlansScreen', () => {
  test('lists every plan the server offers, the suiting ones first', async () => {
    const plans = await mockNutritionApi.dietPlans();
    const text = allText(await render());

    for (const plan of plans) {
      expect(text).toContain(plan.name);
    }
    // A vegetarian profile: the veg plan suits and says so, and the one
    // written for someone else is still listed.
    expect(plans[0].suitsPreferences).toBe(true);
    expect(text).toContain('Matches your diet type and meal plan');
    expect(text).toContain('High-Protein Non-Veg');
  });

  test('a card states what a day of the plan comes to, not what the plan does', async () => {
    const [plan] = await mockNutritionApi.dietPlans();
    const text = allText(await render());

    expect(text).toContain(`${plan.dayCount}-day rotation`);
    expect(text).toContain(`${plan.mealsPerDay} meals / day`);
    expect(text).toContain(
      `${String(plan.perDay.calories).replace(
        /\B(?=(\d{3})+(?!\d))/g,
        ',',
      )} kcal / day`,
    );
  });

  test('opening a card shows the days that plan prescribes', async () => {
    const tree = await render();
    const [plan] = await mockNutritionApi.dietPlans();

    // Shut, the card says nothing about individual days.
    expect(allText(tree)).not.toContain('Day 1');

    await press(tree, plan.name);

    const text = allText(tree);
    expect(text).toContain('Day 1');
    expect(text).toContain(`Day ${plan.dayCount}`);
    expect(text).toContain('Breakfast');
    expect(text).toContain('Use this plan');
  });

  test('only one card is open at a time', async () => {
    const tree = await render();
    const [first, second] = await mockNutritionApi.dietPlans();
    const detail = await mockNutritionApi.dietPlan(first.id);

    await press(tree, first.name);
    await press(tree, second.name);

    // The second plan is shorter, so the first plan's last day is the tell.
    expect(detail.days.length).toBeGreaterThan(second.dayCount);
    expect(allText(tree)).not.toContain(`Day ${detail.days.length}`);
  });

  test('choosing a plan saves it to the profile and goes back', async () => {
    const tree = await render();
    const [, nonVeg] = await mockNutritionApi.dietPlans();

    await press(tree, nonVeg.name);
    await pressLabelled(tree, 'Use this plan');

    expect(updateProfile).toHaveBeenCalledWith(
      { selectedPlanId: nonVeg.id },
      expect.anything(),
    );
    expect(useNutritionStore.getState().profile?.selectedPlanId).toBe(
      nonVeg.id,
    );
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('handing the choice back is offered only once there is one', async () => {
    const tree = await render();
    // Before a plan is picked it is already what is happening: an option that
    // changes nothing is not offered.
    expect(allText(tree)).not.toContain('Let VOKVE choose for me');

    const [, nonVeg] = await mockNutritionApi.dietPlans();
    await press(tree, nonVeg.name);
    await pressLabelled(tree, 'Use this plan');

    // The choice is part of what the plan reads follow, so the list says so
    // without the screen being opened again.
    const text = allText(tree);
    expect(text).toContain('Let VOKVE choose for me');
    expect(text).toContain('In use');

    await pressLabelled(tree, 'Let VOKVE choose for me');
    expect(updateProfile).toHaveBeenLastCalledWith(
      { selectedPlanId: null },
      expect.anything(),
    );
    expect(useNutritionStore.getState().profile?.selectedPlanId).toBeNull();
  });

  test('the chevron returns to whatever opened the library', async () => {
    await press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
