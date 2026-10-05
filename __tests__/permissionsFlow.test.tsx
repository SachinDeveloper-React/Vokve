/**
 * The set-up after sign-in: the permission screens (D-54) — each asks for
 * one thing and says why first, a permission already granted is not asked
 * again, every screen can be passed with "Not now" — then the daily step
 * goal (D-55) while the account has never chosen one. Through the last of
 * them the account is marked as having been through it on this phone —
 * which is what lets the root navigator move on to Home.
 *
 * The services are replaced: what asking does is `stepsService.test.ts`
 * and `push.test.ts`; the goal screen itself is `stepGoalScreen.test.tsx`.
 *
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { HealthConnectStatus } from 'react-native-step-tracker-pro';
import { textOf as collectText } from './helpers/text';
import { ToastProvider } from '../src/components/feedback/Toast';
import { clearServerReads } from '../src/hooks/useServerRead';
import { PermissionsNavigator } from '../src/navigation/PermissionsNavigator';
import { useAuthStore } from '../src/stores/authStore';
import { useOnboardingStore } from '../src/stores/onboardingStore';
import { useSettingsStore } from '../src/stores/settingsStore';
import { useStepsStore } from '../src/stores/stepsStore';
import { ThemeProvider } from '../src/theme';
import { userSchema, type StepGoal } from '../src/types/models';

jest.mock('../src/services/permissions', () => ({
  pendingPermissionSteps: jest.fn(),
  stepGoalNeedsChoosing: jest.fn(),
}));
jest.mock('../src/services/api/endpoints', () => ({
  ...jest.requireActual('../src/services/api/endpoints'),
  activityApi: { goal: jest.fn() },
  settingsApi: { get: jest.fn(), update: jest.fn() },
}));
jest.mock('../src/services/steps', () => ({
  enableStepCounting: jest.fn().mockResolvedValue('started'),
  connectHealthConnect: jest.fn(),
}));
jest.mock('../src/services/push', () => ({
  enablePushNotifications: jest.fn().mockResolvedValue(true),
}));

const { pendingPermissionSteps, stepGoalNeedsChoosing } = jest.requireMock(
  '../src/services/permissions',
) as { pendingPermissionSteps: jest.Mock; stepGoalNeedsChoosing: jest.Mock };
const api = jest.requireMock('../src/services/api/endpoints') as {
  activityApi: { goal: jest.Mock };
  settingsApi: { update: jest.Mock };
};

const GOAL: StepGoal = {
  goal: 10_000,
  recommended: 7000,
  basedOn: { age: true, bmi: true, recentSteps: false },
  min: 3000,
  max: 20_000,
  increment: 500,
  chosenAt: null,
};
const steps = jest.requireMock('../src/services/steps') as Record<
  string,
  jest.Mock
>;
const push = jest.requireMock('../src/services/push') as Record<
  string,
  jest.Mock
>;

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const status = (overrides: Partial<HealthConnectStatus>) =>
  ({
    available: true,
    availability: 'available',
    installable: false,
    stepsGranted: false,
    canReadSteps: false,
    canRead: false,
    shouldOpenSettings: false,
    grantedPermissions: [],
    missingPermissions: [],
    undeclaredPermissions: [],
    ...overrides,
  } as unknown as HealthConnectStatus);

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  clearServerReads();
  stepGoalNeedsChoosing.mockResolvedValue(false);
  api.activityApi.goal.mockResolvedValue(GOAL);
  useSettingsStore.setState({ dailyStepGoal: 10_000 });
  useOnboardingStore.setState({ permissionsDoneFor: [] });
  useStepsStore.setState({ healthConnect: status({}) });
  useAuthStore.setState({
    status: 'authenticated',
    user: userSchema.parse({
      id: 'usr_1',
      name: 'Rahul Sharma',
      email: 'rahul@example.com',
      profileCompletedAt: '2026-09-03T10:00:00.000Z',
    }),
  });
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
            <NavigationContainer>
              <PermissionsNavigator />
            </NavigationContainer>
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

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = tree.root
    .findAll(
      n =>
        n.props?.accessibilityLabel === label &&
        typeof n.props.onPress === 'function',
    )
    .pop();
  if (!node) throw new Error(`No pressable labelled "${label}"`);
  await ReactTestRenderer.act(async () => {
    await node.props.onPress();
  });
};

const done = () => useOnboardingStore.getState().permissionsDoneFor;

test('asks for each permission in turn, saying why first, then lets the app open', async () => {
  pendingPermissionSteps.mockResolvedValue([
    'activity',
    'notifications',
    'healthConnect',
  ]);
  steps.connectHealthConnect.mockResolvedValue(status({ stepsGranted: true }));
  const tree = await render();

  let text = textOf(tree);
  expect(text).toContain('Step 1 of 3');
  expect(text).toContain('Count your steps');
  expect(text).toContain('Only your steps are counted — never your location');
  await press(tree, 'Allow physical activity');
  expect(steps.enableStepCounting).toHaveBeenCalledTimes(1);

  text = textOf(tree);
  expect(text).toContain('Step 2 of 3');
  expect(text).toContain('Stay on track');
  await press(tree, 'Allow notifications');
  expect(push.enablePushNotifications).toHaveBeenCalledTimes(1);

  text = textOf(tree);
  expect(text).toContain('Step 3 of 3');
  expect(text).toContain('Connect your watch');
  expect(text).toContain('Using Google Fit?');
  expect(done()).toEqual([]);
  await press(tree, 'Connect Health Connect');

  expect(steps.connectHealthConnect).toHaveBeenCalledTimes(1);
  expect(done()).toEqual(['usr_1']);
});

test('a permission already granted is not asked again, and "Not now" moves on', async () => {
  pendingPermissionSteps.mockResolvedValue(['notifications']);
  const tree = await render();

  expect(textOf(tree)).toContain('Step 1 of 1');
  expect(textOf(tree)).not.toContain('Count your steps');
  await press(tree, 'Not now');

  expect(push.enablePushNotifications).not.toHaveBeenCalled();
  expect(done()).toEqual(['usr_1']);
});

test('Health Connect not connected keeps its screen; "Skip" moves on', async () => {
  pendingPermissionSteps.mockResolvedValue(['healthConnect']);
  steps.connectHealthConnect.mockResolvedValue(status({}));
  const tree = await render();

  await press(tree, 'Connect Health Connect');
  expect(textOf(tree)).toContain('Connect your watch');
  expect(done()).toEqual([]);

  await press(tree, 'Skip');
  expect(done()).toEqual(['usr_1']);
});

test('the Health Connect button follows its ladder: installed first where it is missing', async () => {
  pendingPermissionSteps.mockResolvedValue(['healthConnect']);
  useStepsStore.setState({
    healthConnect: status({
      available: false,
      availability: 'not_installed',
      installable: true,
    }),
  });
  const tree = await render();

  expect(textOf(tree)).toContain('Install Health Connect');
});

test('with nothing left to ask, the app opens at once', async () => {
  pendingPermissionSteps.mockResolvedValue([]);
  await render();

  expect(done()).toEqual(['usr_1']);
});

test('then the step goal, starting on the suggestion; saving it opens the app', async () => {
  pendingPermissionSteps.mockResolvedValue(['notifications']);
  stepGoalNeedsChoosing.mockResolvedValue(true);
  api.settingsApi.update.mockImplementation(async patch => ({
    units: 'metric',
    dailyStepGoal: 10_000,
    dailyWaterGoalMl: 2500,
    restTimerSeconds: 90,
    hapticsEnabled: true,
    workoutRemindersEnabled: true,
    keepAwakeDuringWorkout: true,
    ...patch,
  }));
  const tree = await render();

  expect(textOf(tree)).toContain('Step 1 of 1');
  await press(tree, 'Not now');

  const text = textOf(tree);
  expect(text).toContain('Step Goal Setting');
  expect(text).toContain('A healthier you\nis a step closer!');
  expect(text).toContain(
    'Based on your profile (age, BMI and activity level), we recommend',
  );
  expect(labelsOf(tree)).toContain('7,000 steps a day');
  // Nothing behind it to go back to.
  expect(labelsOf(tree)).not.toContain('Back');
  expect(done()).toEqual([]);

  await press(tree, 'Raise the goal by 500 steps');
  await press(tree, 'Save Goal');

  expect(api.settingsApi.update).toHaveBeenCalledWith({ dailyStepGoal: 7500 });
  expect(useSettingsStore.getState().dailyStepGoal).toBe(7500);
  expect(done()).toEqual(['usr_1']);
});

test('with every permission granted, the goal is the whole set-up', async () => {
  pendingPermissionSteps.mockResolvedValue([]);
  stepGoalNeedsChoosing.mockResolvedValue(true);
  const tree = await render();

  expect(textOf(tree)).toContain('Step Goal Setting');
  expect(done()).toEqual([]);
});

test('a goal the account already chose — on any phone — is not asked again', async () => {
  pendingPermissionSteps.mockResolvedValue(['notifications']);
  stepGoalNeedsChoosing.mockResolvedValue(false);
  const tree = await render();

  await press(tree, 'Not now');

  expect(textOf(tree)).not.toContain('Step Goal Setting');
  expect(done()).toEqual(['usr_1']);
});

test('a goal that could not be saved still lets the user into the app', async () => {
  pendingPermissionSteps.mockResolvedValue([]);
  stepGoalNeedsChoosing.mockResolvedValue(true);
  api.settingsApi.update.mockRejectedValue(new Error('offline'));
  const tree = await render();

  await press(tree, 'Save Goal');

  expect(useSettingsStore.getState().dailyStepGoal).toBe(10_000);
  expect(done()).toEqual(['usr_1']);
});
