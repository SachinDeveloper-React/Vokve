/**
 * Home is where the rest of the app is reached from, so what is checked here
 * is the wiring: that the shortcut row and the bell lead to the screens they
 * name rather than to a tab that happens to contain something similar.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text as RNText } from 'react-native';
import { mockSnapshot } from 'react-native-step-tracker-pro/jest';
import { HomeScreen } from '../src/screens/main/HomeScreen';
import { useStepsStore } from '../src/stores/stepsStore';
import { useStreakStore } from '../src/stores/streakStore';
import { ThemeProvider } from '../src/theme';
import { textOf } from './helpers/text';
import { addDays, todayIso } from '../src/utils/date';

const mockNavigate = jest.fn();

// Only `useNavigation` is replaced: the theme layer imports `DefaultTheme`
// from this same module, and a blanket mock takes that down with it.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// The day's motivation line is the server's; these tests are about the
// wiring, so it is left on its way rather than fetched for real.
jest.mock('../src/services/api/endpoints', () => ({
  ...jest.requireActual('../src/services/api/endpoints'),
  contentApi: { tip: jest.fn(() => new Promise(() => {})) },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

const INITIAL_STEPS = useStepsStore.getState();

beforeEach(() => {
  mockNavigate.mockClear();
  useStepsStore.setState(INITIAL_STEPS, true);
  useStreakStore.getState().reset();
});

const labelsOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll(n => typeof n.props?.accessibilityLabel === 'string')
    .map(n => n.props.accessibilityLabel as string);

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
          <HomeScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
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

describe('HomeScreen', () => {
  test('the challenges shortcut opens the board as a route of its own', async () => {
    press(await render(), 'Challenges &');

    expect(mockNavigate).toHaveBeenCalledWith('Challenges');
  });

  test('the hydration card opens the hydration screen', async () => {
    press(await render(), 'Hydration,');

    expect(mockNavigate).toHaveBeenCalledWith('Hydration');
  });

  test("the step card's Edit Goal opens the step goal screen", async () => {
    press(await render(), 'Edit daily step goal');

    expect(mockNavigate).toHaveBeenCalledWith('StepGoal');
  });

  test('the analysis tile opens the steps analytics', async () => {
    press(await render(), 'Analysis');

    expect(mockNavigate).toHaveBeenCalledWith('Analytics');
  });

  test('the health shortcut opens the checkup', async () => {
    press(await render(), 'Health check up');

    expect(mockNavigate).toHaveBeenCalledWith('HealthCheckup');
  });

  test('the nutrition shortcut opens the nutrition screen', async () => {
    press(await render(), 'Nutrition &');

    expect(mockNavigate).toHaveBeenCalledWith('Nutrition');
  });

  test('the bell opens the notification centre', async () => {
    press(await render(), 'Notifications');

    expect(mockNavigate).toHaveBeenCalledWith('Notifications');
  });

  test('the streak shortcut opens the streak as a route of its own', async () => {
    press(await render(), 'Streaks');

    expect(mockNavigate).toHaveBeenCalledWith('Streak');
  });

  test("the streak shortcut carries the server's run, and a dash before it has said", async () => {
    expect(labelsOf(await render())).toContain('Streaks —');

    useStreakStore.setState({
      summary: {
        today: todayIso(),
        currentStreak: 12,
        longestStreak: {
          length: 12,
          start: addDays(todayIso(), -11),
          end: todayIso(),
        },
        completedDays: [],
        protectedDays: [],
        freezesAvailable: 1,
        maxFreezes: 3,
        todayCovered: true,
        todayFrozen: false,
        canRestore: false,
        restoreGap: [],
        restoreCostCoins: 50,
        restoreWindowDays: 7,
        milestones: [],
        nextMilestone: null,
        howToEarn: 'Walk 10,000 steps in a day.',
      },
      syncedAt: new Date().toISOString(),
    });
    expect(labelsOf(await render())).toContain('Streaks 12 Days');
  });

  test('a phone not counting yet is asked to, and the prompt opens step tracking', async () => {
    useStepsStore.setState({ supported: true, trackingState: 'idle' });

    press(await render(), 'Start counting your steps');

    expect(mockNavigate).toHaveBeenCalledWith('StepTracking');
  });

  test('the step cards show the server’s figures, not the phone’s own count', async () => {
    useStepsStore.setState({
      supported: true,
      trackingState: 'running',
      // The phone has counted further than the server has heard about yet.
      today: mockSnapshot({ state: 'running', steps: 9999 }),
      serverWeek: [
        {
          date: addDays(todayIso(), -1),
          steps: 8765,
          verifiedSteps: 8765,
          distanceKm: 6,
          activeMinutes: 60,
          caloriesBurned: 300,
          workoutsCompleted: 0,
          source: 'device',
          verified: true,
        },
        {
          date: todayIso(),
          steps: 4321,
          verifiedSteps: 4000,
          distanceKm: 3.1,
          activeMinutes: 37,
          caloriesBurned: 180,
          workoutsCompleted: 0,
          source: 'device',
          verified: true,
        },
      ],
    });

    const text = textOf(await render(), RNText);

    expect(text).toContain('4,321');
    expect(text).not.toContain('9,999');
    expect(text).toContain('3.1 km');
    expect(text).toContain('37 min');
    expect(text).toContain('180 kcal');
    expect(text).toContain('8,765');
    expect(text).not.toContain('Start counting your steps');
  });

  test('a phone without step counting gets no prompt to turn it on', async () => {
    useStepsStore.setState({ supported: false });

    expect(textOf(await render(), RNText)).not.toContain(
      'Start counting your steps',
    );
  });
});
