/**
 * Blood pressure is two numbers with one verdict, so the checks here are that
 * either half can move the verdict, that the verdict is the same one the
 * checkup tile shows, and that the screen — built from the heart rate screen's
 * parts — still says what it should about a sensor it has not got.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { BloodPressureScreen } from '../src/screens/main/BloodPressureScreen';
import { pressureBandFor, statusOf } from '../src/components/health/vitals';
import { ThemeProvider } from '../src/theme';
import { useVitalsStore } from '../src/stores/vitalsStore';

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

const metrics = {
  frame: { x: 0, y: 0, width: 400, height: 800 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(() => {
  mockNavigate.mockClear();
  mockGoBack.mockClear();
  useVitalsStore.getState().reset();
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
          <BloodPressureScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

const labels = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll(n => typeof n.props?.accessibilityLabel === 'string')
    .map(n => n.props.accessibilityLabel as string);

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

describe('the blood pressure bands', () => {
  test('either half can lift a reading out of normal', () => {
    expect(pressureBandFor(118, 76).label).toBe('Normal');
    expect(pressureBandFor(124, 76).label).toBe('Elevated'); // top creeping
    expect(pressureBandFor(118, 82).label).toBe('High'); // bottom alone
    expect(pressureBandFor(134, 76).label).toBe('High'); // top alone
    expect(pressureBandFor(86, 70).label).toBe('Low');
  });

  test('the tile and the screen give a reading the same verdict', () => {
    for (const [sys, dia] of [
      [118, 76],
      [124, 76],
      [126, 82],
      [86, 58],
    ]) {
      expect(
        statusOf({
          id: 'x',
          kind: 'blood_pressure',
          value: sys,
          secondary: dia,
          recordedAt: new Date().toISOString(),
        }),
      ).toBe(pressureBandFor(sys, dia).status);
    }
  });
});

describe('BloodPressureScreen', () => {
  test('leads with both halves, the verdict and the pulse', async () => {
    const text = allText(await render());

    expect(text).toContain('118/');
    expect(text).toContain('76');
    expect(text).toContain('mmHg');
    expect(text).toContain('Normal');
    expect(text).toContain('72 bpm'); // the latest pulse, beside the pressure
  });

  test('the trend names both lines', async () => {
    const text = allText(await render());

    expect(text).toContain('SYS');
    expect(text).toContain('DIA');
    expect(text).toContain('Blood Pressure Trend');
  });

  test('the live card does not claim a sensor this build has not got', async () => {
    const text = allText(await render());

    expect(text).toContain('Not connected');
    expect(text).not.toContain('Measure using your connected device');
  });

  test('each past reading carries its own verdict', async () => {
    const rows = labels(await render()).filter(label =>
      label.includes('millimetres of mercury'),
    );

    // 126 over 82 is the one seeded reading with a raised diastolic.
    expect(rows.some(label => label.startsWith('126 / 82 millimetres of mercury, High'))).toBe(
      true,
    );
    expect(rows.some(label => label.startsWith('118 / 76 millimetres of mercury, Normal'))).toBe(
      true,
    );
  });

  test('a reading logged here moves the hero', async () => {
    const tree = await render();

    ReactTestRenderer.act(() =>
      useVitalsStore.getState().addReading('blood_pressure', 136, 88),
    );

    const text = allText(tree);
    expect(text).toContain('136/');
    expect(text).toContain('High');
  });

  test('the chevron returns to whatever opened the screen', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
