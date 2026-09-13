/**
 * The screen states a clinical figure, so the checks here are about what it
 * claims: that the band follows the number at every boundary, that a reading
 * logged here reaches the same store the checkup tile reads, and that the
 * "live" card does not promise a measurement this build cannot take.
 *
 * @format
 */

import React from 'react';
import { Text as RNText } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { textOf } from './helpers/text';
import { HeartRateScreen } from '../src/screens/main/HeartRateScreen';
import { bandFor, statusOf } from '../src/components/health/vitals';
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
          <HeartRateScreen />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  mounted = tree;
  return tree;
};

const allText = (tree: ReactTestRenderer.ReactTestRenderer) =>
  textOf(tree, RNText);

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

describe('the heart rate bands', () => {
  test('each band starts where the one before it ends', () => {
    expect(bandFor(59).label).toBe('Low');
    expect(bandFor(60).label).toBe('Normal');
    expect(bandFor(100).label).toBe('Normal');
    expect(bandFor(101).label).toBe('Elevated');
    expect(bandFor(120).label).toBe('Elevated');
    expect(bandFor(121).label).toBe('High');
  });

  test('a reading gets the same verdict wherever it is shown', () => {
    // The checkup tile and this screen used to run their own ranges, which
    // had 118 reading "High" on one and "Elevated" on the other.
    for (const bpm of [55, 72, 118, 130]) {
      expect(
        statusOf({
          id: 'x',
          kind: 'heart_rate',
          value: bpm,
          secondary: null,
          recordedAt: new Date().toISOString(),
        }),
      ).toBe(bandFor(bpm).status);
    }
  });
});

describe('HeartRateScreen', () => {
  test('leads with the latest reading and where it sits', async () => {
    const text = allText(await render());

    expect(text).toContain('72'); // the seeded reading
    expect(text).toContain('bpm');
    expect(text).toContain('Normal');
    expect(text).toContain('Your heart rate is in a healthy range');
  });

  test('the scale is drawn with every band named', async () => {
    const text = allText(await render());

    expect(text).toContain('< 60');
    expect(text).toContain('60 - 100');
    expect(text).toContain('101 - 120');
    expect(text).toContain('> 120');
  });

  test('the live card does not claim a sensor this build has not got', async () => {
    const text = allText(await render());

    expect(text).toContain('Not connected');
    expect(text).toContain('Log a reading');
    expect(text).not.toContain('Real-time measurement');
  });

  test('a reading logged here lands in the vitals store', async () => {
    const tree = await render();
    const before = useVitalsStore.getState().readings.length;

    press(tree, 'Log a reading');
    ReactTestRenderer.act(() =>
      useVitalsStore.getState().addReading('heart_rate', 104),
    );

    expect(useVitalsStore.getState().readings).toHaveLength(before + 1);
    // The hero follows the newest reading, verdict and all.
    const text = allText(tree);
    expect(text).toContain('104');
    expect(text).toContain('Elevated');
  });

  test('each past reading carries its own verdict, not the latest one', async () => {
    ReactTestRenderer.act(() =>
      useVitalsStore.getState().addReading('heart_rate', 118),
    );

    const tree = await render();
    const labels = tree.root
      .findAll(n => typeof n.props?.accessibilityLabel === 'string')
      .map(n => n.props.accessibilityLabel as string);

    expect(labels.some(label => label.startsWith('118 beats per minute, Elevated'))).toBe(
      true,
    );
    expect(labels.some(label => label.startsWith('72 beats per minute, Normal'))).toBe(
      true,
    );
  });

  test('the chevron returns to whatever opened the screen', async () => {
    press(await render(), 'Back');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
