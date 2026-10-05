/**
 * The step tracking screen is where counting is turned on, so the checks are
 * about consent and honesty: that it says what counting means before it
 * asks, that a refusal leads somewhere, that turning counting off asks
 * first, and that a phone that keeps killing the service is told how to stop
 * it. The service is replaced — what it does is `stepsService.test.ts`.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import StepTracker, {
  type HealthConnectStatus,
} from 'react-native-step-tracker-pro';
import { mockSnapshot } from 'react-native-step-tracker-pro/jest';
import { textOf } from './helpers/text';
import { ToastProvider } from '../src/components/feedback/Toast';
import { StepTrackingScreen } from '../src/screens/main/StepTrackingScreen';
import { useStepsStore } from '../src/stores/stepsStore';
import { ThemeProvider } from '../src/theme';
import { todayIso } from '../src/utils/date';

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

jest.mock('../src/services/steps', () => ({
  allowHealthConnectWrites: jest.fn().mockResolvedValue(null),
  connectHealthConnect: jest.fn().mockResolvedValue(null),
  disconnectHealthConnect: jest.fn().mockResolvedValue(undefined),
  enableStepTracking: jest.fn().mockResolvedValue('started'),
  improveBackgroundCounting: jest.fn().mockResolvedValue('autostart'),
  openHealthConnectSettings: jest.fn().mockResolvedValue(undefined),
  openStepPermissionSettings: jest.fn().mockResolvedValue(undefined),
  pauseStepTracking: jest.fn().mockResolvedValue(undefined),
  refreshStepStatus: jest.fn().mockResolvedValue(undefined),
  resumeStepTracking: jest.fn().mockResolvedValue(undefined),
  stopStepTracking: jest.fn().mockResolvedValue(undefined),
  syncStepsNow: jest.fn().mockResolvedValue(undefined),
}));

const steps = jest.requireMock('../src/services/steps') as Record<
  string,
  jest.Mock
>;

/** Health Connect as the session last read it: not installed yet. */
const NOT_INSTALLED = {
  available: false,
  availability: 'not_installed',
  installable: true,
  granted: false,
  canRead: false,
  canReadSteps: false,
  stepsGranted: false,
  grantedPermissions: [],
  missingPermissions: [],
  undeclaredPermissions: [],
  shouldOpenSettings: false,
} as unknown as HealthConnectStatus;
const CONNECTED = {
  ...NOT_INSTALLED,
  available: true,
  availability: 'available',
  installable: false,
  granted: true,
  canReadSteps: true,
  stepsGranted: true,
} as HealthConnectStatus;

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const INITIAL = useStepsStore.getState();

const counting = (count: number) => ({
  supported: true,
  trackingState: 'running' as const,
  today: mockSnapshot({ state: 'running', steps: count }),
});

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  useStepsStore.setState(INITIAL, true);
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
            <StepTrackingScreen />
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

const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const node = tree.root
    .findAll(
      n =>
        typeof n.props?.accessibilityLabel === 'string' &&
        (n.props.accessibilityLabel as string).startsWith(label),
    )
    .find(n => typeof n.props.onPress === 'function');

  if (!node) throw new Error(`No pressable labelled "${label}…"`);
  await ReactTestRenderer.act(async () => {
    await node.props.onPress();
  });
};

describe('StepTrackingScreen', () => {
  test('says what counting means before it asks to turn it on', async () => {
    useStepsStore.setState({ supported: true, trackingState: 'idle' });
    const tree = await render();

    const text = allText(tree);
    expect(text).toContain("phone's own motion sensor");
    expect(text).toContain('even when the app is closed');

    await press(tree, 'Turn on step counting');

    expect(steps.enableStepTracking).toHaveBeenCalledTimes(1);
    expect(allText(tree)).toContain('Step counting is on');
  });

  test('a refused permission leads to the settings that can grant it', async () => {
    useStepsStore.setState({ supported: true, trackingState: 'idle' });
    steps.enableStepTracking.mockResolvedValueOnce('permission_denied');
    const tree = await render();

    await press(tree, 'Turn on step counting');
    expect(allText(tree)).toContain('Physical activity permission');

    await press(tree, 'Open settings');
    expect(steps.openStepPermissionSettings).toHaveBeenCalledTimes(1);
  });

  test('counting shows the day so far and asks before it is turned off', async () => {
    useStepsStore.setState(counting(4321));
    const tree = await render();

    expect(allText(tree)).toContain('4,321 steps today, counted by this phone');

    await press(tree, 'Turn off');
    expect(allText(tree)).toContain('Turn off step counting?');
    expect(steps.stopStepTracking).not.toHaveBeenCalled();

    await press(tree, 'Turn off step counting');
    expect(steps.stopStepTracking).toHaveBeenCalledTimes(1);
  });

  test('the day so far includes the other phones, and says which part is this phone’s', async () => {
    // The tracker shows 72 counted here and 629 from the other phone.
    useStepsStore.setState({
      supported: true,
      trackingState: 'running',
      today: mockSnapshot({
        state: 'running',
        steps: 701,
        otherDevicesSteps: 629,
      }),
    });
    const tree = await render();

    expect(allText(tree)).toContain(
      '701 steps today — 72 counted by this phone, 629 by your other phones',
    );
  });

  test('a phone that keeps killing the service is told how to stop it', async () => {
    useStepsStore.setState({
      ...counting(900),
      trackingHealth: {
        serviceAlive: true,
        shouldBeRunning: true,
        lastHeartbeatAt: 0,
        heartbeatAgeMs: 0,
        lastSensorEventAt: 0,
        lastRecoveryAt: 0,
        lastRecoveryReason: 'watchdog',
        recoveryCount: 3,
        looksDead: false,
        batteryOptimizationEnabled: false,
        aggressiveOem: true,
        manufacturer: 'xiaomi',
      },
      background: {
        manufacturer: 'xiaomi',
        brand: 'redmi',
        aggressiveOem: true,
        batteryOptimizationEnabled: false,
        directPromptAvailable: false,
        autoStartSettingsAvailable: true,
        autoStartTarget: null,
        backgroundStartNeedsExemption: true,
      },
    });
    const tree = await render();

    const text = allText(tree);
    expect(text).toContain('Keep counting in the background');
    expect(text).toContain('Your Xiaomi phone');

    await press(tree, 'Open settings');
    expect(steps.improveBackgroundCounting).toHaveBeenCalledTimes(1);
  });

  test('the sync says what the server verified and why it last stopped', async () => {
    useStepsStore.setState({
      ...counting(5000),
      lastSyncedAt: Date.now(),
      syncError: 'Step sync is coming soon.',
      serverDays: {
        [todayIso()]: {
          date: todayIso(),
          steps: 5000,
          verifiedSteps: 4800,
          distanceKm: 0,
          activeMinutes: 0,
          caloriesBurned: 0,
          workoutsCompleted: 0,
          source: 'device',
          verified: true,
        },
      },
    });
    const tree = await render();

    const text = allText(tree);
    expect(text).toContain('Server: 5,000 steps today, 4,800 verified');
    expect(text).toContain('Step sync is coming soon.');

    await press(tree, 'Sync now');
    expect(steps.syncStepsNow).toHaveBeenCalledTimes(1);
  });

  test('Health Connect is optional, and offered as an install when missing', async () => {
    useStepsStore.setState({ ...counting(10), healthConnect: NOT_INSTALLED });
    const tree = await render();

    expect(allText(tree)).toContain('Optional');
    await press(tree, 'Install Health Connect');

    expect(steps.connectHealthConnect).toHaveBeenCalledTimes(1);
  });

  test('connected on Android 14+, the way out is Health Connect’s own settings', async () => {
    // Android 14+'s self-revocation only lands when the app is next closed,
    // and undoes any grant made before then — so no in-app disconnect.
    useStepsStore.setState({ ...counting(10), healthConnect: CONNECTED });
    const tree = await render();

    const text = allText(tree);
    expect(text).toContain('Connected');
    expect(text).toContain("turn off Vokve in Health Connect's app");
    expect(text).not.toContain('Disconnect');

    await press(tree, 'Manage access');
    expect(steps.openHealthConnectSettings).toHaveBeenCalledTimes(1);
  });

  test('connected before Vokve wrote there, it offers to add this phone’s steps (D-57)', async () => {
    useStepsStore.setState({ ...counting(10), healthConnect: CONNECTED });
    const tree = await render();

    expect(allText(tree)).toContain(
      'Let it add the steps this phone counts too, so your other fitness apps see them.',
    );
    await press(tree, 'Add my steps to Health Connect');
    expect(steps.allowHealthConnectWrites).toHaveBeenCalledTimes(1);
  });

  test('with writing allowed, it says what goes in — and from when', async () => {
    useStepsStore.setState({
      ...counting(10),
      healthConnect: {
        ...CONNECTED,
        canWriteSteps: true,
      } as HealthConnectStatus,
    });
    const text = allText(await render());

    expect(text).toContain('Reading your watch, adding your phone');
    expect(text).toContain('Only what you walk while signed in is added.');
    expect(text).not.toContain('Add my steps to Health Connect');
  });

  test('a build that does not declare writing only reads, and says so', async () => {
    useStepsStore.setState({
      ...counting(10),
      healthConnect: {
        ...CONNECTED,
        undeclaredPermissions: ['android.permission.health.WRITE_STEPS'],
      } as HealthConnectStatus,
    });
    const text = allText(await render());

    expect(text).toContain(
      'Vokve only reads. It never writes to Health Connect.',
    );
    expect(text).not.toContain('Add my steps to Health Connect');
  });

  test('Health Connect is read from the session, not asked again by the screen', async () => {
    useStepsStore.setState({ ...counting(10), healthConnect: CONNECTED });
    await render();

    // The screen's own re-read of everything, once on opening — and nothing
    // that reads every app's steps out of Health Connect for a list it
    // never shows.
    expect(steps.refreshStepStatus).toHaveBeenCalledTimes(1);
    expect(StepTracker.getStepSources).not.toHaveBeenCalled();
    expect(StepTracker.getHealthConnectStatus).not.toHaveBeenCalled();
  });

  test('the step sources page is one tap away', async () => {
    useStepsStore.setState(counting(10));
    await press(await render(), 'Step sources');

    expect(mockNavigate).toHaveBeenCalledWith('StepSources');
  });

  test('a phone that cannot count gets no switch to turn on', async () => {
    useStepsStore.setState({ supported: false });
    const text = allText(await render());

    expect(text).toContain('Not available on this phone yet');
    expect(text).not.toContain('Turn on step counting');
    expect(text).not.toContain('Health Connect');
  });

  test('the chevron returns to whatever opened the screen', async () => {
    await press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
