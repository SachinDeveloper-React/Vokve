/**
 * Whether a reading is healthy is worked out from the number rather than
 * stored beside it, so the checks here are that the verdict follows the value
 * — including at the edges of each range — and that logging a reading moves
 * the tile and the history together.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { HealthCheckupScreen } from '../src/screens/main/HealthCheckupScreen';
import { statusOf } from '../src/components/health/vitals';
import { ThemeProvider } from '../src/theme';
import { useVitalsStore } from '../src/stores/vitalsStore';
import type { VitalReading } from '../src/types/models';

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

const reading = (
  kind: VitalReading['kind'],
  value: number,
  secondary: number | null = null,
): VitalReading => ({
  id: `${kind}-${value}`,
  kind,
  value,
  secondary,
  recordedAt: new Date().toISOString(),
});

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
          <HealthCheckupScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
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

describe('vital ranges', () => {
  test('a resting pulse is normal between 60 and 100', () => {
    expect(statusOf(reading('heart_rate', 59))).toBe('low');
    expect(statusOf(reading('heart_rate', 60))).toBe('normal');
    expect(statusOf(reading('heart_rate', 100))).toBe('normal');
    // Above the resting range the scale has two steps, and the tile uses the
    // same ones the heart rate screen draws.
    expect(statusOf(reading('heart_rate', 101))).toBe('elevated');
    expect(statusOf(reading('heart_rate', 121))).toBe('high');
  });

  test('either half of a blood pressure can make it high', () => {
    expect(statusOf(reading('blood_pressure', 118, 76))).toBe('normal');
    // The systolic half is fine here; the diastolic one is not, and a reading
    // that only checked the first number would call this normal.
    expect(statusOf(reading('blood_pressure', 118, 84))).toBe('high');
    expect(statusOf(reading('blood_pressure', 134, 76))).toBe('high');
  });

  test('BMI follows the same bands the guide draws', () => {
    expect(statusOf(reading('bmi', 18.4))).toBe('low');
    expect(statusOf(reading('bmi', 22.4))).toBe('normal');
    expect(statusOf(reading('bmi', 25))).toBe('high');
  });

  test('a weight is reported as logged rather than judged', () => {
    // What a healthy weight is depends on height, which the BMI beside it
    // already accounts for.
    expect(statusOf(reading('weight', 65))).toBe('logged');
    expect(statusOf(reading('weight', 120))).toBe('logged');
  });
});

describe('HealthCheckupScreen', () => {
  test('each vital states its figure, its unit and its verdict', async () => {
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('72');
    expect(text).toContain('118 / 76');
    expect(text).toContain('22.4');
    expect(text).toContain('65.0');

    expect(labels(tree)).toEqual(
      expect.arrayContaining([
        'Heart Rate, 72 bpm, Normal',
        'Blood Pressure, 118 / 76 mmHg, Normal',
        'Weight, 65.0 kg, Updated',
      ]),
    );
  });

  test('the score carries the band that goes with it', async () => {
    expect(allText(await render())).toContain('Good');
  });

  test('a new reading replaces the tile and heads the history', async () => {
    useVitalsStore.getState().addReading('heart_rate', 104);
    const tree = await render();

    expect(labels(tree)).toEqual(
      expect.arrayContaining(['Heart Rate, 104 bpm, Elevated']),
    );
    // The old reading is still in the store, just no longer the latest.
    expect(allText(tree)).toContain('104');
  });

  test('the add control opens a sheet instead of logging something', async () => {
    const tree = await render();
    const before = useVitalsStore.getState().readings.length;

    press(tree, 'Add a new reading');

    expect(allText(tree)).toContain('Add a reading');
    expect(useVitalsStore.getState().readings).toHaveLength(before);
  });

  test('the heart rate tile opens its own screen', async () => {
    press(await render(), 'Heart Rate, 72 bpm');

    expect(mockNavigate).toHaveBeenCalledWith('HeartRate');
  });

  test('the chevron returns to whatever opened the screen', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
