/**
 * The step goal screen from the dashboard's "Edit Goal" (D-55): it opens on
 * the goal the account has, shows the server's suggestion and takes it in a
 * tap, keeps every way of changing the goal — the buttons, the slider, a
 * screen reader's swipes — to the server's range and increment, and closes
 * only once the server has kept the goal. A refusal leaves the goal as it
 * was and says why.
 *
 * The goal scale's arithmetic is pinned down here too: the slider's marks
 * are evenly spaced, not by value, which is easy to break unnoticed.
 *
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf as collectText } from './helpers/text';
import { ToastProvider } from '../src/components/feedback/Toast';
import {
  formatStopLabel,
  fractionOfGoal,
  goalAtFraction,
  goalStops,
  recommendationBasis,
  snapGoal,
  StepGoalSlider,
} from '../src/components/goal';
import { clearServerReads } from '../src/hooks/useServerRead';
import { StepGoalScreen } from '../src/screens/main/StepGoalScreen';
import { ApiError } from '../src/services/api/errors';
import { useSettingsStore } from '../src/stores/settingsStore';
import { ThemeProvider } from '../src/theme';
import { moderateScale } from '../src/theme/responsive';
import type { StepGoal, UserSettings } from '../src/types/models';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    goBack: mockGoBack,
    navigate: mockNavigate,
    canGoBack: () => true,
  }),
}));
jest.mock('../src/services/api/endpoints', () => ({
  ...jest.requireActual('../src/services/api/endpoints'),
  activityApi: { goal: jest.fn() },
  settingsApi: { get: jest.fn(), update: jest.fn() },
}));

const api = jest.requireMock('../src/services/api/endpoints') as {
  activityApi: { goal: jest.Mock };
  settingsApi: { get: jest.Mock; update: jest.Mock };
};

const RANGE = { min: 3000, max: 20_000, increment: 500 };

const GOAL: StepGoal = {
  goal: 5000,
  recommended: 7000,
  basedOn: { age: true, bmi: true, recentSteps: true },
  ...RANGE,
  chosenAt: '2026-10-01T08:00:00.000Z',
};

const SETTINGS: UserSettings = {
  units: 'metric',
  dailyStepGoal: 5000,
  dailyWaterGoalMl: 2500,
  restTimerSeconds: 90,
  hapticsEnabled: true,
  workoutRemindersEnabled: true,
  keepAwakeDuringWorkout: true,
};

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  clearServerReads();
  api.activityApi.goal.mockResolvedValue(GOAL);
  api.settingsApi.update.mockImplementation(
    async (patch: Partial<UserSettings>) => ({ ...SETTINGS, ...patch }),
  );
  useSettingsStore.setState({ dailyStepGoal: 5000 });
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
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>
            <StepGoalScreen />
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

const textOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  collectText(tree, Text);

const labelsOf = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll(n => typeof n.props?.accessibilityLabel === 'string')
    .map(n => n.props.accessibilityLabel as string);

/** The innermost node with the label that takes the action — the one a finger reaches. */
const nodeLabelled = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
  handler: string,
) => {
  const node = tree.root
    .findAll(
      n =>
        n.props?.accessibilityLabel === label &&
        typeof n.props[handler] === 'function',
    )
    .pop();
  if (!node) throw new Error(`No node labelled "${label}" with ${handler}`);
  return node;
};

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = nodeLabelled(tree, label, 'onPress');
  await ReactTestRenderer.act(async () => {
    await node.props.onPress();
  });
};

const swipe = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  actionName: 'increment' | 'decrement',
) => {
  const slider = nodeLabelled(tree, 'Daily step goal', 'onAccessibilityAction');
  await ReactTestRenderer.act(async () => {
    slider.props.onAccessibilityAction({ nativeEvent: { actionName } });
  });
};

/** What the stepper shows, as a screen reader hears it. */
const shown = (tree: ReactTestRenderer.ReactTestRenderer) =>
  labelsOf(tree).find(label => label.endsWith('steps a day'));

describe('the goal scale', () => {
  test("marks the design's ladder, evenly spaced along the track", () => {
    const stops = goalStops(RANGE);
    expect(stops).toEqual([3000, 5000, 7000, 10_000, 15_000, 20_000]);
    expect(stops.map(formatStopLabel)).toEqual([
      '3K',
      '5K',
      '7K',
      '10K',
      '15K',
      '20K',
    ]);
    expect(stops.map(stop => fractionOfGoal(stop, stops))).toEqual([
      0, 0.2, 0.4, 0.6, 0.8, 1,
    ]);
    expect(fractionOfGoal(8500, stops)).toBeCloseTo(0.5);
    expect(goalAtFraction(0.5, stops)).toBe(8500);
    expect(goalAtFraction(-1, stops)).toBe(3000);
    expect(goalAtFraction(2, stops)).toBe(20_000);
  });

  test('keeps to a narrower range, and every value on the increment', () => {
    expect(goalStops({ min: 4000, max: 12_000, increment: 500 })).toEqual([
      4000, 5000, 7000, 10_000, 12_000,
    ]);
    expect(snapGoal(7240, RANGE)).toBe(7000);
    expect(snapGoal(7250, RANGE)).toBe(7500);
    expect(snapGoal(1200, RANGE)).toBe(3000);
    expect(snapGoal(26_000, RANGE)).toBe(20_000);
    expect(formatStopLabel(7500)).toBe('7.5K');
  });

  test('says what the suggestion came from, and nothing it did not', () => {
    expect(
      recommendationBasis({ age: true, bmi: true, recentSteps: false }),
    ).toBe('Based on your profile (age, BMI and activity level),');
    expect(
      recommendationBasis({ age: false, bmi: true, recentSteps: true }),
    ).toBe('Based on your profile (BMI and activity level),');
    expect(
      recommendationBasis({ age: false, bmi: false, recentSteps: true }),
    ).toBe('Based on your activity level,');
  });
});

describe('StepGoalScreen', () => {
  test('opens on the goal the account has, beside the suggestion and why', async () => {
    const tree = await render();

    const text = textOf(tree);
    expect(text).toContain('Step Goal Setting');
    expect(text).toContain('Current Daily Goal');
    expect(text).toContain('Recommended Goal');
    expect(text).toContain('7,000 steps per day.');
    expect(text).toContain('Choose a goal between 3,000 and 20,000 steps.');
    expect(text).toContain('Potential Benefits');
    expect(text).toContain('Move More. Live Better.');
    expect(shown(tree)).toBe('5,000 steps a day');
    expect(labelsOf(tree)).toContain('Back');
  });

  test('takes the suggestion in a tap, and moves a step at a time inside the range', async () => {
    const tree = await render();

    await press(tree, 'Use the recommended goal, 7,000 steps');
    expect(shown(tree)).toBe('7,000 steps a day');

    await press(tree, 'Raise the goal by 500 steps');
    await swipe(tree, 'increment');
    expect(shown(tree)).toBe('8,000 steps a day');

    await swipe(tree, 'decrement');
    await press(tree, 'Lower the goal by 500 steps');
    expect(shown(tree)).toBe('7,000 steps a day');
  });

  test('stops at the ends of the range', async () => {
    useSettingsStore.setState({ dailyStepGoal: 3500 });
    const tree = await render();

    await press(tree, 'Lower the goal by 500 steps');
    expect(shown(tree)).toBe('3,000 steps a day');
    expect(
      nodeLabelled(tree, 'Lower the goal by 500 steps', 'onPress').props
        .disabled,
    ).toBe(true);
    await swipe(tree, 'decrement');
    expect(shown(tree)).toBe('3,000 steps a day');
  });

  test('saves through the settings and goes back once the server has it', async () => {
    const tree = await render();

    await press(tree, 'Raise the goal by 500 steps');
    await press(tree, 'Save Goal');

    expect(api.settingsApi.update).toHaveBeenCalledWith({
      dailyStepGoal: 5500,
    });
    expect(useSettingsStore.getState().dailyStepGoal).toBe(5500);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(textOf(tree)).toContain('Daily goal saved');
  });

  test('a refusal keeps the goal as it was, says why, and stays', async () => {
    api.settingsApi.update.mockRejectedValue(
      new ApiError('validation', 'Check the highlighted fields.', 422, {
        dailyStepGoal: 'Choose a goal between 3,000 and 15,000 steps.',
      }),
    );
    const tree = await render();

    await press(tree, 'Use the recommended goal, 7,000 steps');
    await press(tree, 'Save Goal');

    expect(useSettingsStore.getState().dailyStepGoal).toBe(5000);
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain(
      'Choose a goal between 3,000 and 15,000 steps.',
    );
  });

  test('works before the server answers: the goal on the phone and the default range', async () => {
    api.activityApi.goal.mockRejectedValue(new Error('offline'));
    const tree = await render();

    expect(shown(tree)).toBe('5,000 steps a day');
    expect(textOf(tree)).toContain(
      'Choose a goal between 3,000 and 20,000 steps.',
    );
    expect(textOf(tree)).not.toContain('we recommend');
    expect(labelsOf(tree)).toContain('Recommended goal, not available yet');
  });
});

describe('StepGoalSlider', () => {
  /** The thumb's width: the track starts half of it in from each edge. */
  const THUMB = moderateScale(22);
  const TRACK = 300;

  /** One finger's history as the responder system hands it over. */
  const finger = (pageX: number, previousPageX: number, at: number) => ({
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: at,
      touchBank: [
        {
          touchActive: true,
          startPageX: 100,
          startPageY: 0,
          startTimeStamp: 1,
          currentPageX: pageX,
          currentPageY: 0,
          currentTimeStamp: at,
          previousPageX,
          previousPageY: 0,
          previousTimeStamp: at - 1,
        },
      ],
    },
  });

  const renderSlider = async (onChange: jest.Mock) => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <StepGoalSlider value={5000} range={RANGE} onChange={onChange} />
        </ThemeProvider>,
      );
    });
    mounted = tree;
    const area = nodeLabelled(tree, 'Daily step goal', 'onResponderGrant');
    await ReactTestRenderer.act(async () => {
      area.props.onLayout({
        nativeEvent: { layout: { width: TRACK + THUMB } },
      });
    });
    // Handlers read the laid-out width, so the node is looked up again.
    return nodeLabelled(tree, 'Daily step goal', 'onResponderGrant');
  };

  /** A touch-down at a share of the track. */
  const grant = (share: number) => ({
    nativeEvent: { locationX: THUMB / 2 + share * TRACK },
    ...finger(100, 100, 1),
  });

  test('a tap sets the goal where it lands, on the increment', async () => {
    const onChange = jest.fn();
    const area = await renderSlider(onChange);

    await ReactTestRenderer.act(async () => {
      area.props.onResponderGrant(grant(0.4));
    });
    expect(onChange).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => {
      area.props.onResponderRelease({
        nativeEvent: {},
        ...finger(100, 100, 2),
      });
    });

    expect(onChange).toHaveBeenLastCalledWith(7000);
  });

  test('a drag follows the finger along the marks', async () => {
    const onChange = jest.fn();
    const area = await renderSlider(onChange);

    await ReactTestRenderer.act(async () => {
      area.props.onResponderGrant(grant(0.4));
      area.props.onResponderMove({ nativeEvent: {}, ...finger(160, 100, 2) });
    });
    expect(onChange).toHaveBeenLastCalledWith(10_000);

    await ReactTestRenderer.act(async () => {
      area.props.onResponderMove({ nativeEvent: {}, ...finger(400, 160, 3) });
    });
    expect(onChange).toHaveBeenLastCalledWith(20_000);
  });

  test('a touch the page takes for a scroll sets nothing', async () => {
    const onChange = jest.fn();
    const area = await renderSlider(onChange);

    await ReactTestRenderer.act(async () => {
      area.props.onResponderGrant(grant(0.9));
      area.props.onResponderMove({ nativeEvent: {}, ...finger(102, 100, 2) });
      area.props.onResponderTerminate({
        nativeEvent: {},
        ...finger(102, 102, 3),
      });
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
