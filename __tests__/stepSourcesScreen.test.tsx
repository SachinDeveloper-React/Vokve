/**
 * The step sources page shows the server's account of a day and nothing of
 * its own making: these checks are that it asks for the day shown, draws
 * every phone and every Health Connect app with what became of it, shows
 * the server's own words for how the day was decided, and keeps the fraud
 * layers off the page when the server leaves them out.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { clearServerReads } from '../src/hooks/useServerRead';
import { StepSourcesScreen } from '../src/screens/main/StepSourcesScreen';
import { ThemeProvider } from '../src/theme';
import { todayIso } from '../src/utils/date';
import type { StepSourcesReport } from '../src/types/models';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
}));

const mockSources = jest.fn();

jest.mock('../src/services/api/endpoints', () => ({
  activityApi: { sources: (date: string) => mockSources(date) },
}));

jest.mock('../src/services/steps', () => ({
  syncStepsNow: jest.fn().mockResolvedValue(undefined),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const REPORT: StepSourcesReport = {
  date: todayIso(),
  scoredAt: new Date().toISOString(),
  day: {
    date: todayIso(),
    steps: 8500,
    verifiedSteps: 8500,
    distanceKm: 6.4,
    activeMinutes: 70,
    caloriesBurned: 300,
    workoutsCompleted: 0,
    source: 'health_connect',
    verified: true,
  },
  explanation: [
    'Google Pixel 8 counted 7,000 steps with its own sensor.',
    'Fitbit recorded 9,500 (1,000 typed in by hand, left out): 8,500 that count — more than the phone, so Fitbit answers for the day.',
    'The day passed the checks: 8,500 steps are verified.',
  ],
  devices: [
    {
      deviceId: 'dev_1',
      name: 'Google Pixel 8',
      isCurrent: true,
      answeredForDay: true,
      syncedAt: new Date().toISOString(),
      phone: { counted: 7000, recovered: 300, flagged: 0, clean: 6700 },
      counted: 8500,
      source: 'health_connect',
      verified: true,
      sourcesNote: null,
      sources: [
        {
          packageName: 'com.sec.android.app.shealth',
          appName: 'Samsung Health',
          kind: 'watch',
          isWearable: true,
          isPlatform: false,
          steps: 30000,
          manualSteps: 0,
          countable: 30000,
          ratioToPhone: 4.29,
          status: 'not_counted',
          note: 'More than 2 times what the phone itself saw, so it does not count.',
        },
        {
          packageName: 'com.fitbit.FitbitMobile',
          appName: 'Fitbit',
          kind: 'watch',
          isWearable: true,
          isPlatform: false,
          steps: 9500,
          manualSteps: 1000,
          countable: 8500,
          ratioToPhone: 1.21,
          status: 'used',
          note: 'Counted the most, 1,000 of them typed in by hand — this app answers for the day.',
        },
      ],
      proof: { keyAttested: true, bootVerified: true, playIntegrity: 'pass' },
    },
  ],
  records: [
    {
      packageName: 'com.fitbit.FitbitMobile',
      appName: 'Fitbit',
      records: 12,
      steps: 9500,
      manualSteps: 1000,
      unknownMethodSteps: 0,
    },
  ],
  uploads: [
    {
      at: new Date().toISOString(),
      deviceName: 'Google Pixel 8',
      phoneSteps: 7000,
      shownSteps: 8500,
      playIntegrity: 'pass',
    },
  ],
  checks: {
    plausibility: 92,
    layers: [{ key: 'L0', name: 'Device integrity', score: 100 }],
    flags: [
      {
        kind: 'manual_entries',
        layer: 'L1',
        severity: 'soft',
        message: 'Some steps were typed in by hand; they were left out.',
      },
    ],
  },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  // Each test asks afresh: the screen otherwise paints the last answer.
  clearServerReads();
  mockSources.mockReset();
  mockSources.mockResolvedValue(REPORT);
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
          <StepSourcesScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

describe('StepSourcesScreen', () => {
  test('asks the server about today, and shows its answer and its reasons', async () => {
    const text = textOf(await render(), RNText);

    expect(mockSources).toHaveBeenCalledWith(todayIso());
    expect(text).toContain('8,500 steps');
    expect(text).toContain('Verified');
    expect(text).toContain('Fitbit answers for the day');
  });

  test('draws each phone with its own count, and every app with what became of it', async () => {
    const text = textOf(await render(), RNText);

    expect(text).toContain('Google Pixel 8 (this phone)');
    expect(text).toContain('Used for the day');
    expect(text).toContain('Counted by the phone');
    expect(text).toContain('− 300');
    expect(text).toContain('6,700');
    expect(text).toContain('Samsung Health');
    expect(text).toContain('Not counted');
    expect(text).toContain('Used');
    expect(text).toContain('1,000 typed in');
    expect(text).toContain('12 records');
    expect(text).toContain('7,000 on the phone');
  });

  test('shows the fraud layers only when the server sends them', async () => {
    expect(textOf(await render(), RNText)).toContain('Score 92 of 100');

    mockSources.mockResolvedValue({ ...REPORT, checks: null });
    const tree = await (async () => {
      const current = mounted!;
      await ReactTestRenderer.act(() => current.unmount());
      mounted = null;
      return render();
    })();
    expect(textOf(tree, RNText)).not.toContain('Score 92 of 100');
  });

  test('a failed read says so and offers to try again', async () => {
    mockSources.mockRejectedValue(new Error('offline'));
    const tree = await render();

    const text = textOf(tree, RNText);
    expect(text).toContain("Couldn't load the sources");

    mockSources.mockResolvedValue(REPORT);
    const retry = tree.root
      .findAll(n => n.props?.accessibilityLabel === 'Try again')
      .find(n => typeof n.props.onPress === 'function');
    await ReactTestRenderer.act(async () => {
      retry!.props.onPress();
    });
    expect(textOf(tree, RNText)).toContain('Fitbit answers for the day');
  });
});
