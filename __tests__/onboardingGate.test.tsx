/**
 * The flow this pins down is sign-up → OTP → complete profile → home.
 *
 * The subtle part is the middle: verifying the code *does* sign the user in,
 * so the root navigator has already swapped the auth stack out by the time
 * onboarding is due. What holds the app back is the server's
 * `profileCompletedAt` stamp, not the session — and getting that backwards
 * either strands a verified user on a login form or drops them into a home
 * screen with no name, height or weight.
 *
 * @format
 */

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf as collectText } from './helpers/text';
import { RootNavigator } from '../src/navigation/RootNavigator';
import { ThemeProvider } from '../src/theme';
import { ToastProvider } from '../src/components/feedback';
import {
  AuthorizationStatus,
  hasPermission,
} from '@react-native-firebase/messaging';
import { endStepSession } from '../src/services/steps';
import { useAuthStore } from '../src/stores/authStore';
import { useOnboardingStore } from '../src/stores/onboardingStore';
import { userSchema } from '../src/types/models';

jest.mock('../src/constants/config', () => ({
  config: {
    apiBaseUrl: 'https://example.test/v1',
    requestTimeoutMs: 1000,
    maxRetries: 0,
    retryBaseDelayMs: 1,
    bypassAuthInDev: false,
    useMockApi: false,
    mockLatencyMs: 0,
  },
}));

// The step goal that ends the set-up (D-55) is the server's to know about;
// everything else goes to the unreachable host as before.
jest.mock('../src/services/api/endpoints', () => {
  const actual = jest.requireActual('../src/services/api/endpoints');
  return {
    ...actual,
    activityApi: { ...actual.activityApi, goal: jest.fn() },
    settingsApi: { ...actual.settingsApi, update: jest.fn() },
  };
});

const api = jest.requireMock('../src/services/api/endpoints') as {
  activityApi: { goal: jest.Mock };
  settingsApi: { update: jest.Mock };
};

const goalChosenAt = (chosenAt: string | null) => ({
  goal: 10_000,
  recommended: 8000,
  basedOn: { age: false, bmi: false, recentSteps: false },
  min: 3000,
  max: 20_000,
  increment: 500,
  chosenAt,
});

beforeEach(() => {
  api.activityApi.goal.mockResolvedValue(goalChosenAt(null));
});

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const userWith = (profileCompletedAt: string | null) =>
  userSchema.parse({
    id: 'usr_1',
    name: 'Rahul Sharma',
    email: 'rahul@example.com',
    profileCompletedAt,
  });

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

// Each tree is taken down after its test, and the step session a finished
// profile starts is ended (the root never unmounts in the app, so nothing
// else ends it): a toast, a read or the sync tick still on its way would
// otherwise land after this file's environment is gone — reported against
// whichever test the worker runs next, and keeping the worker alive.
afterEach(async () => {
  const tree = mounted;
  mounted = null;
  if (tree) {
    await ReactTestRenderer.act(() => {
      tree.unmount();
    });
  }
  endStepSession();
});

const render = async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          {/*
            The tab bar mounts every tab, and the Shop reports a redemption
            through the toast — so the gate has to be rendered inside the same
            provider stack App puts around it, or the render fails on a
            missing context rather than on anything this file is testing.
          */}
          <ToastProvider>
            <RootNavigator />
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

/** A partial store update, the way the real actions apply theirs. */
type AuthPatch = Partial<ReturnType<typeof useAuthStore.getState>>;

const settle = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  state: AuthPatch,
) => {
  await ReactTestRenderer.act(async () => {
    useAuthStore.setState(state);
  });
  return tree;
};

test('a verified user with no profile lands on onboarding, not on home', async () => {
  const tree = await render();
  await settle(tree, {
    status: 'authenticated',
    user: userWith(null),
  });

  expect(textOf(tree)).toContain('Complete Your Profile');
});

test('finishing the profile moves the same session on to the app', async () => {
  const tree = await render();
  await settle(tree, { status: 'authenticated', user: userWith(null) });
  expect(textOf(tree)).toContain('Complete Your Profile');

  // Exactly what `completeProfile` does: swaps in the server's user, stamped.
  await settle(tree, { user: userWith('2026-09-03T10:00:00.000Z') });

  expect(textOf(tree)).not.toContain('Complete Your Profile');
});

test('a returning user with a finished profile never sees onboarding', async () => {
  const tree = await render();
  await settle(tree, {
    status: 'authenticated',
    user: userWith('2026-09-03T10:00:00.000Z'),
  });

  expect(textOf(tree)).not.toContain('Complete Your Profile');
});

test('a signed-out user still gets the auth stack, not onboarding', async () => {
  const tree = await render();
  await settle(tree, { status: 'signed_out', user: null });

  expect(textOf(tree)).not.toContain('Complete Your Profile');
});

// ─── The set-up: permission screens (D-54), then the step goal (D-55) ───

/** Text only Home shows: the masthead's standing subtitle. */
const HOME = 'Stay active, stay healthy!';

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
    .pop()!;
  await ReactTestRenderer.act(async () => {
    await node.props.onPress();
  });
};

describe('after the profile, the permission screens', () => {
  beforeEach(() => {
    useOnboardingStore.setState({ permissionsDoneFor: [] });
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
  });

  afterEach(() => {
    (hasPermission as jest.Mock).mockResolvedValue(
      AuthorizationStatus.AUTHORIZED,
    );
  });

  test('come before Home, then the step goal, and Home follows it', async () => {
    // Notifications not yet allowed: the one this test phone can ask for.
    (hasPermission as jest.Mock).mockResolvedValue(
      AuthorizationStatus.NOT_DETERMINED,
    );
    const tree = await render();
    await settle(tree, { status: 'authenticated', user: userWith(null) });
    await settle(tree, { user: userWith('2026-09-03T10:00:00.000Z') });

    expect(textOf(tree)).toContain('Stay on track');
    expect(textOf(tree)).not.toContain(HOME);

    await press(tree, 'Not now');

    expect(textOf(tree)).toContain('Step Goal Setting');
    expect(textOf(tree)).not.toContain(HOME);

    await press(tree, 'Save Goal');

    expect(api.settingsApi.update).toHaveBeenCalledWith({
      dailyStepGoal: 8000,
    });
    expect(textOf(tree)).not.toContain('Stay on track');
    expect(textOf(tree)).not.toContain('Step Goal Setting');
    expect(textOf(tree)).toContain(HOME);
    expect(useOnboardingStore.getState().permissionsDoneFor).toEqual(['usr_1']);
  });

  test('an account that chose its goal already goes from the last of them to Home', async () => {
    api.activityApi.goal.mockResolvedValue(
      goalChosenAt('2026-10-01T08:00:00.000Z'),
    );
    (hasPermission as jest.Mock).mockResolvedValue(
      AuthorizationStatus.NOT_DETERMINED,
    );
    const tree = await render();
    await settle(tree, {
      status: 'authenticated',
      user: userWith('2026-09-03T10:00:00.000Z'),
    });

    await press(tree, 'Not now');

    expect(textOf(tree)).not.toContain('Step Goal Setting');
    expect(textOf(tree)).toContain(HOME);
  });

  test('are not shown again to an account that has been through them on this phone', async () => {
    useOnboardingStore.setState({ permissionsDoneFor: ['usr_1'] });
    (hasPermission as jest.Mock).mockResolvedValue(
      AuthorizationStatus.NOT_DETERMINED,
    );
    const tree = await render();
    await settle(tree, {
      status: 'authenticated',
      user: userWith('2026-09-03T10:00:00.000Z'),
    });

    expect(textOf(tree)).not.toContain('Stay on track');
    expect(textOf(tree)).toContain(HOME);
  });
});
